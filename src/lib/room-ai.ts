import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/anthropic";
import { recordUsage } from "@/lib/usage";
import { resolveModel } from "@/lib/models";
import { postMessage, transcriptWindow, type RoomMsg, type RoomKind } from "@/lib/rooms";
import type { RoomAttachment } from "@/lib/rooms-shared";

/**
 * Claude + Claudette — the AI participants in a room. They reply ONLY to human
 * messages (the /send route calls runAiTurn after persisting a human turn); AI
 * turns are inserted directly and never re-trigger the AI, so there's no
 * runaway AI-to-AI loop or cost spiral. Cheap + snappy on Haiku, short replies,
 * bounded transcript — a chat room, not an essay generator.
 *
 * Two personas so a room feels populated: Claude (level, helpful) and Claudette
 * (warm, witty). Claude always answers a human turn; Claudette chimes in when
 * named, when the room is quiet, or to riff — kept brief. This is the seed of
 * the Porsche-room dream (image-ID + read-aloud come next).
 */

const MODEL = "claude-haiku-4-5"; // cheap + fast — right for chatty room banter
const MAX_TOKENS = 220; // keep turns short and conversational
const WINDOW = 16; // how much recent room history each persona sees
// Real web access — the SAME server-side web_search tool /chat gives this model,
// so the personas can actually look things up (weather, prices, listings) instead
// of guessing. Anthropic runs the search server-side within the create() call.
const WEB_TOOLS = resolveModel(MODEL).webTools as Anthropic.MessageCreateParams["tools"];

// How many recent shared images to actually SHOW the model per turn — bounds the
// vision token cost (most turns have none, so most turns pay nothing extra).
const MAX_VISION_IMAGES = 3;
const VISION_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type VisionType = (typeof VISION_TYPES)[number];

/** Turn a room image attachment (a data: URI) into a Claude vision block, or null
 *  if it isn't a base64 image of a type Claude accepts. */
function imageBlock(att: RoomAttachment): Anthropic.ImageBlockParam | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(att.url);
  if (!m) return null;
  const mediaType = m[1];
  if (!VISION_TYPES.includes(mediaType as VisionType)) return null;
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType as VisionType, data: m[2] },
  };
}

type Persona = {
  kind: Extract<RoomKind, "claude" | "claudette">;
  name: string;
  system: string;
};

const CLAUDE: Persona = {
  kind: "claude",
  name: "Claude",
  system: [
    "You are Claude, a participant in a live group chat room inside Static Cling.",
    "You're one voice among several humans (and Claudette, another AI). This is a casual room, not a 1:1 assistant session.",
    "Keep replies SHORT — usually one or two sentences, like a real person in a group chat. No preamble, no 'as an AI'.",
    "Be genuinely helpful and knowledgeable when someone asks something, but match the room's casual energy.",
    "You CAN search the web for current facts — weather, prices, news, listings, anything live. When someone asks for current/real info, actually look it up and answer from what you find. Never claim you can't browse.",
    "When someone shares an image, you can SEE it — identify or describe what's in it, and if it's worth it, search the web for more (e.g. what a car is, what it's worth, where to find one). Never claim you can't view images.",
    "Don't greet everyone or summarize the chat. Just say your next line.",
  ].join(" "),
};

const CLAUDETTE: Persona = {
  kind: "claudette",
  name: "Claudette",
  system: [
    "You are Claudette, a participant in a live group chat room inside Static Cling.",
    "You're warm, witty, and a little playful — the friend who keeps the vibe up. Claude (the other AI) tends to be the straight, factual one; you add color, ask a fun follow-up, or riff.",
    "Keep replies SHORT — one sentence is great, like a real person in a group chat. No preamble, no 'as an AI'.",
    "You are FULLY capable on your own: you can search the web for live info AND see shared images. When you're just riffing alongside Claude, keep it light. But when someone asks YOU directly (says 'Claudette'), handle it yourself for real — actually search the web / look at the image and give the answer. NEVER say you can't browse, can't check a site, or can't see images, and never punt the task to Claude when you were the one asked.",
    "Don't greet everyone or summarize the chat. Just say your next line.",
  ].join(" "),
};

/** Render the room transcript as a simple labelled script for the persona.
 * Shared files are surfaced as a bracketed note so the personas know which
 * message carried which file by name; the actual image pixels are attached
 * separately in speak() (see imageBlocks) so the model can really SEE them. */
function transcriptText(msgs: RoomMsg[]): string {
  return msgs
    .map((m) => {
      const files = m.attachments?.length
        ? ` [shared ${m.attachments
            .map((a) => `${a.kind === "image" ? "an image" : "a file"} "${a.name}"`)
            .join(", ")}]`
        : "";
      return `${m.authorName}: ${m.body}${files}`;
    })
    .join("\n");
}

async function speak(room: string, persona: Persona, userId: string | null) {
  const window = await transcriptWindow(room, WINDOW);
  if (window.length === 0) return;

  const prompt = [
    `This is the #${room} room. Here's the recent conversation:`,
    "",
    transcriptText(window),
    "",
    `Now write ${persona.name}'s next message. Just the message text, nothing else.`,
  ].join("\n");

  // Actually SHOW the model the most recent shared images so it can see/identify
  // them (the Porsche/Firebird dream), not just know a file was shared. Capped.
  const imageBlocks = window
    .flatMap((m) => (m.attachments ?? []).filter((a) => a.kind === "image"))
    .slice(-MAX_VISION_IMAGES)
    .map(imageBlock)
    .filter((b): b is Anthropic.ImageBlockParam => b !== null);

  const content: Anthropic.MessageParam["content"] =
    imageBlocks.length === 0 ? prompt : [{ type: "text", text: prompt }, ...imageBlocks];

  try {
    const res = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: persona.system,
      tools: WEB_TOOLS,
      messages: [{ role: "user", content }],
    });
    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (!text) return;

    // Did the model ACTUALLY hit the web this turn? Anthropic runs web_search
    // server-side and returns these blocks in the content — server-confirmed, so
    // the transparency strip can't be faked by the model just saying it searched.
    const usedWeb = res.content.some(
      (b) => b.type === "server_tool_use" || b.type === "web_search_tool_result",
    );

    await postMessage({
      room,
      authorId: null,
      authorName: persona.name,
      kind: persona.kind,
      body: text,
      meta: { web: usedWeb, model: MODEL },
    });

    // Bill it to the room's human instigator so /lab + /admin see room AI spend.
    await recordUsage({
      userId: userId ?? "system",
      model: MODEL,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
      meta: { feature: "room-ai", room, persona: persona.kind },
    }).catch(() => {});
  } catch {
    // An AI hiccup must never break the human chat — just stay quiet this turn.
  }
}

/**
 * Run the AI turn after a human message. Claude answers; Claudette follows
 * (seeing Claude's fresh line, so it reads like two people). Sequential on
 * purpose. `triggerText` lets us bias Claudette toward replying when named.
 */
export async function runAiTurn(room: string, instigatorId: string, triggerText: string) {
  // Addressed to Claudette by name? She takes the turn HERSELF (she's fully
  // capable — web + vision) and Claude stays out, so she isn't talked over.
  // Before, Claude always spoke first and "took the reins" even when you asked her.
  if (/claudette/i.test(triggerText)) {
    await speak(room, CLAUDETTE, instigatorId);
    return;
  }

  // Otherwise Claude answers the human turn; Claudette chimes in to keep it lively
  // when there's a question or a meatier message — but not on every single line.
  await speak(room, CLAUDE, instigatorId);
  const asked = /\?/.test(triggerText);
  if (asked || triggerText.length > 40) {
    await speak(room, CLAUDETTE, instigatorId);
  }
}
