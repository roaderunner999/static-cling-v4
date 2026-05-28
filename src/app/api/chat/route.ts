import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { db } from "@/db";
import { conversation, message } from "@/db/schema";
import { getConversation, getMessages, type ChatMessage } from "@/lib/chat-queries";
import { getAnthropic } from "@/lib/anthropic";
import {
  recordUsage,
  monthlyMessageCount,
  userMessagesSince,
  globalMessagesSince,
} from "@/lib/usage";
import { resolveModel, isKnownModel } from "@/lib/models";
import { classifyRoute } from "@/lib/auto-route";
import { monthlyMessageLimit } from "@/lib/billing";
import { chatEnabled, env } from "@/env";

/**
 * Streaming chat (Stage 3). The one Claude call path, server-side.
 *
 * Routes at the exact path /api/chat (golive: `location = /api/chat`, SSE-safe,
 * 30m body limit). The loop: auth → free-cap gate → persist the user turn →
 * (Auto mode: classify which model to use) → stream Claude (web search + vision)
 * → persist the assistant turn → write the usage ledger.
 *
 * `model` may be a concrete id (manual) or "auto" — Auto-Claude picks the model
 * per message via a cheap Haiku classifier and reports its choice to the UI.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = [
  "You are the assistant inside Static Cling, a fast, personal chat app by Lyons Software.",
  "Be helpful, direct, and concise. Use Markdown when it aids clarity (code blocks, lists).",
  "You have web_search and web_fetch tools for live internet access. When the user asks about current events, weather, news, prices, sports, recent releases, or anything that may have changed since your training — or whenever you're not sure of a fact — use web_search to look it up instead of saying you can't access the web. Cite your sources when you do.",
  "When the user attaches an image, look at it and answer about what's actually in it.",
].join(" ");

const MAX_TOKENS = 8192;
const MAX_IMAGES = 5;
const MAX_IMAGE_CHARS = 7_000_000; // ~5MB of binary as base64
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

type Attachment = { mediaType: string; data: string; name?: string };
type MsgBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;

const enc = new TextEncoder();

function frame(obj: unknown): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function jsonError(message: string, status: number, extra: object = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

/** Build the Anthropic content blocks for one stored message (images then text). */
function toContentBlocks(
  m: Pick<ChatMessage, "content" | "attachments">,
): MsgBlock[] {
  const blocks: MsgBlock[] = [];
  for (const att of m.attachments ?? []) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: att.mediaType as "image/png",
        data: att.data,
      },
    });
  }
  if (m.content) blocks.push({ type: "text", text: m.content });
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });
  return blocks;
}

export async function POST(req: Request) {
  if (!chatEnabled) {
    return jsonError("Chat isn’t configured on this server yet.", 503);
  }

  const session = await getSession();
  if (!session) return jsonError("Sign in to chat.", 401);
  const { user } = session;

  let body: {
    conversationId?: string;
    content?: string;
    model?: string;
    images?: Attachment[];
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid request body.", 400);
  }

  const content = (body.content ?? "").trim();

  const images: Attachment[] = (Array.isArray(body.images) ? body.images : [])
    .filter(
      (a) =>
        a &&
        typeof a.data === "string" &&
        ALLOWED_IMAGE_TYPES.has(a.mediaType) &&
        a.data.length <= MAX_IMAGE_CHARS,
    )
    .slice(0, MAX_IMAGES)
    .map((a) => ({ mediaType: a.mediaType, data: a.data, name: a.name }));

  if (!content && images.length === 0) {
    return jsonError("Message can’t be empty.", 400);
  }

  // Auto mode vs a concrete model selection.
  const isAuto = body.model === "auto";
  const manualModel = isAuto ? null : resolveModel(body.model);
  const storedModel = isAuto
    ? "auto"
    : isKnownModel(body.model ?? "")
      ? body.model!
      : manualModel!.id;

  // --- Free-plan gate before storing anything.
  const limit = monthlyMessageLimit(user);
  const used = await monthlyMessageCount(user.id);
  if (used >= limit) {
    return jsonError(
      `You’ve used all ${limit} messages this month. Upgrade to Pro for more.`,
      402,
      { code: "limit_reached", limit, used },
    );
  }

  // --- Abuse guards (the site is public). ---
  const burst = await userMessagesSince(user.id, new Date(Date.now() - 60_000));
  if (burst >= env.CHAT_RATE_PER_MIN) {
    return jsonError("You’re sending messages too fast — give it a few seconds.", 429, {
      code: "rate_limited",
    });
  }
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  if ((await globalMessagesSince(startOfDay)) >= env.CHAT_DAILY_GLOBAL_CAP) {
    return jsonError(
      "Static Cling is unusually busy right now — please try again shortly.",
      503,
      { code: "busy" },
    );
  }

  // --- Resolve the conversation (owner-checked) or open a new one.
  let convo: { id: string; title: string; model: string } | null = null;
  let isNew = false;

  if (body.conversationId) {
    const existing = await getConversation(body.conversationId, user.id);
    if (!existing) return jsonError("Conversation not found.", 404);
    convo = existing;
    if (existing.model !== storedModel) {
      await db
        .update(conversation)
        .set({ model: storedModel })
        .where(eq(conversation.id, existing.id));
    }
  } else {
    const title = (content || images[0]?.name || "Image")
      .replace(/\s+/g, " ")
      .slice(0, 60);
    const inserted = await db
      .insert(conversation)
      .values({ userId: user.id, title, model: storedModel })
      .returning({
        id: conversation.id,
        title: conversation.title,
        model: conversation.model,
      });
    convo = inserted[0];
    isNew = true;
  }

  // --- Persist the user turn (text + attachments), then build the prompt.
  await db
    .insert(message)
    .values({ conversationId: convo.id, role: "user", content, attachments: images });

  const history = await getMessages(convo.id);
  const apiMessages: Anthropic.MessageParam[] = history.map((m, i) => {
    const blocks = toContentBlocks(m);
    if (i === history.length - 1) {
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        cache_control: { type: "ephemeral" },
      };
    }
    return {
      role: m.role === "assistant" ? "assistant" : "user",
      content: blocks,
    };
  });

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];

  const conversationId = convo.id;
  const conversationTitle = convo.title;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        frame({ type: "meta", conversationId, title: conversationTitle, isNew }),
      );

      let assistantText = "";
      try {
        // Pick the model — Auto classifies once; manual uses the chosen one.
        let chosen = manualModel ?? resolveModel(undefined);
        let reason: string | undefined;
        if (isAuto) {
          controller.enqueue(frame({ type: "status", label: "Choosing the best model…" }));
          const decision = await classifyRoute(user.id, content, images.length > 0);
          chosen = resolveModel(decision.modelId);
          reason = decision.reason;
        }
        const model = chosen.id;
        const tools = chosen.webTools;

        controller.enqueue(
          frame({ type: "route", model, label: chosen.label, auto: isAuto, reason }),
        );

        const anthropic = getAnthropic();
        const claudeStream = anthropic.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages: apiMessages,
          ...(tools.length
            ? { tools: tools as Anthropic.MessageCreateParams["tools"] }
            : {}),
        });

        for await (const event of claudeStream) {
          if (
            event.type === "content_block_start" &&
            event.content_block.type === "server_tool_use"
          ) {
            const label =
              event.content_block.name === "web_fetch"
                ? "Reading a page…"
                : "Searching the web…";
            controller.enqueue(frame({ type: "status", label }));
          }
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            assistantText += event.delta.text;
            controller.enqueue(frame({ type: "delta", text: event.delta.text }));
          }
        }

        const final = await claudeStream.finalMessage();
        const u = final.usage;

        const [assistantRow] = await db
          .insert(message)
          .values({
            conversationId,
            role: "assistant",
            content: assistantText,
            model,
          })
          .returning({ id: message.id });
        await db
          .update(conversation)
          .set({ updatedAt: new Date() })
          .where(eq(conversation.id, conversationId));

        await recordUsage({
          userId: user.id,
          model,
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
          meta: { feature: "chat", conversationId, auto: isAuto },
        });

        controller.enqueue(
          frame({
            type: "done",
            messageId: assistantRow.id,
            usage: {
              inputTokens: u.input_tokens ?? 0,
              outputTokens: u.output_tokens ?? 0,
            },
            used: used + 1,
            limit,
          }),
        );
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : "Something went wrong.";
        controller.enqueue(frame({ type: "error", message: messageText }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
