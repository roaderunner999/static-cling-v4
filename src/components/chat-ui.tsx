"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ConversationSummary } from "@/lib/chat-queries";
import type { ModelInfo, ModelId } from "@/lib/models";
import {
  loadConversation,
  deleteConversation,
  type LoadedMessage,
} from "@/lib/chat-actions";
import { Markdown } from "@/components/markdown";

type Attachment = { mediaType: string; data: string; name?: string };
type ChatModel = ModelId | "auto";
type Msg = {
  id: string;
  role: string;
  content: string;
  attachments?: Attachment[];
  // Transparency: which model answered, and (Auto mode) why.
  model?: string;
  auto?: boolean;
  reason?: string;
};

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function srcOf(a: Attachment) {
  return `data:${a.mediaType};base64,${a.data}`;
}

async function fileToAttachment(file: File): Promise<Attachment> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return { mediaType: file.type, data: dataUrl.split(",")[1] ?? "", name: file.name };
}

export function ChatUI({
  conversations,
  models,
  enabled,
  pro,
  usage,
  requestedId,
  initialModel = "auto",
}: {
  conversations: ConversationSummary[];
  models: ModelInfo[];
  enabled: boolean;
  pro: boolean;
  usage: { used: number; limit: number };
  requestedId?: string;
  /** The user's preferred default model for new chats (from /settings). */
  initialModel?: ChatModel;
}) {
  const [convos, setConvos] = useState<ConversationSummary[]>(conversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [model, setModel] = useState<ChatModel>(initialModel);
  const [streaming, setStreaming] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState(usage.used);
  const [limitReached, setLimitReached] = useState(usage.used >= usage.limit);
  // Sidebar starts collapsed for max real estate (esp. on tablets); we remember
  // the user's last choice so reopening it sticks.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSidebarOpen(localStorage.getItem("staticcling_chat_sidebar") === "1");
  }, []);
  function toggleSidebar(open: boolean) {
    setSidebarOpen(open);
    try {
      localStorage.setItem("staticcling_chat_sidebar", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Stick to bottom only when the user is already near it — so a long streaming
  // reply (or a big code block) doesn't yank them down while they're reading up.
  const stick = useRef(true);

  useEffect(() => {
    if (stick.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // Auto-grow the composer to fit its content (up to a max), so it expands
  // upward as you type instead of showing a scrollbar.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [input]);

  // On mount: resume the last conversation (or the most recent) AND drop in any
  // hand-off from Notes ("Send to chat") as a prefilled message in that same
  // conversation's composer. Walter's preference: capture the content into the
  // ongoing thread instead of a one-off new chat that would vanish on navigation
  // without sending. (sessionStorage is client-only, so this must run post-mount.)
  useEffect(() => {
    const prefill = sessionStorage.getItem("staticcling_chat_prefill");
    const imgsRaw = sessionStorage.getItem("staticcling_chat_prefill_images");
    const hasPrefill = !!(prefill || imgsRaw);

    let targetId: string | undefined;
    if (conversations.length > 0) {
      let lastId: string | null = null;
      try {
        lastId = localStorage.getItem("staticcling_chat_last");
      } catch {
        /* ignore */
      }
      // An explicit `?id=` from a dashboard link wins over the "resume last" default.
      const explicit = requestedId
        ? conversations.find((c) => c.id === requestedId)
        : undefined;
      const target =
        explicit ?? conversations.find((c) => c.id === lastId) ?? conversations[0];
      targetId = target.id;
    }

    (async () => {
      if (targetId) {
        try {
          await openConversation(targetId);
        } catch {
          /* ignore — fall through to prefill in a fresh chat */
        }
      }
      if (prefill) {
        setInput(prefill);
        sessionStorage.removeItem("staticcling_chat_prefill");
      }
      if (imgsRaw) {
        try {
          const imgs = JSON.parse(imgsRaw) as Attachment[];
          if (Array.isArray(imgs) && imgs.length) {
            setPending(
              imgs.filter((a) => a?.mediaType?.startsWith("image/")).slice(0, MAX_IMAGES),
            );
          }
        } catch {
          /* ignore malformed */
        }
        sessionStorage.removeItem("staticcling_chat_prefill_images");
      }
      if (hasPrefill) inputRef.current?.focus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the last conversation worked on, so the next visit resumes it.
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem("staticcling_chat_last", activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  async function addFiles(files: FileList | File[]) {
    const imgs = Array.from(files).filter(
      (f) => f.type.startsWith("image/") && f.size <= MAX_IMAGE_BYTES,
    );
    if (imgs.length === 0) return;
    const atts = await Promise.all(imgs.map(fileToAttachment));
    setPending((p) => [...p, ...atts].slice(0, MAX_IMAGES));
  }

  async function openConversation(id: string) {
    if (streaming) return;
    setActiveId(id);
    setError(null);
    const msgs: LoadedMessage[] = await loadConversation(id);
    setMessages(
      msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments,
        model: m.model ?? undefined,
      })),
    );
    const convoModel = convos.find((c) => c.id === id)?.model;
    if (convoModel === "auto" || models.some((m) => m.id === convoModel)) {
      setModel(convoModel as ChatModel);
    }
  }

  function newChat() {
    if (streaming) return;
    setActiveId(null);
    setMessages([]);
    setPending([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function remove(id: string) {
    if (streaming) return;
    setConvos((cs) => cs.filter((c) => c.id !== id));
    if (activeId === id) newChat();
    await deleteConversation(id);
  }

  async function send() {
    const content = input.trim();
    if ((!content && pending.length === 0) || streaming || !enabled || limitReached)
      return;

    const images = pending;
    setInput("");
    setPending([]);
    setError(null);
    setSearchStatus(null);
    setStreaming(true);
    stick.current = true; // sending: jump to the newest message

    const userMsg: Msg = {
      id: `tmp-u-${Date.now()}`,
      role: "user",
      content,
      attachments: images,
    };
    const assistantMsg: Msg = { id: `tmp-a-${Date.now()}`, role: "assistant", content: "" };
    setMessages((m) => [...m, userMsg, assistantMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeId ?? undefined,
          content,
          model,
          images,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "limit_reached") setLimitReached(true);
        setError(data.error ?? "Request failed.");
        setMessages((m) => m.filter((x) => x.id !== assistantMsg.id));
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          handleEvent(JSON.parse(line.slice(5).trim()), assistantMsg.id, content);
        }
      }
    } catch {
      setError("Connection lost. Try again.");
      setMessages((m) => m.filter((x) => x.id !== assistantMsg.id));
    } finally {
      setStreaming(false);
      setSearchStatus(null);
    }
  }

  function handleEvent(
    evt: Record<string, unknown>,
    assistantTmpId: string,
    firstUserContent: string,
  ) {
    switch (evt.type) {
      case "meta": {
        const id = evt.conversationId as string;
        setActiveId(id);
        if (evt.isNew) {
          setConvos((cs) => [
            {
              id,
              title: (evt.title as string) || firstUserContent.slice(0, 60) || "Image",
              model: evt.model as string,
              updatedAt: new Date(),
            },
            ...cs,
          ]);
        }
        break;
      }
      case "route": {
        const mdl = evt.model as string;
        const auto = Boolean(evt.auto);
        const reason = evt.reason as string | undefined;
        setSearchStatus(null);
        setMessages((m) =>
          m.map((x) =>
            x.id === assistantTmpId ? { ...x, model: mdl, auto, reason } : x,
          ),
        );
        break;
      }
      case "status":
        setSearchStatus((evt.label as string) ?? "Working…");
        break;
      case "delta": {
        setSearchStatus(null);
        const text = evt.text as string;
        setMessages((m) =>
          m.map((x) =>
            x.id === assistantTmpId ? { ...x, content: x.content + text } : x,
          ),
        );
        break;
      }
      case "done": {
        if (typeof evt.used === "number") {
          setUsed(evt.used);
          if (evt.used >= (evt.limit as number)) setLimitReached(true);
        }
        setConvos((cs) => {
          const id = activeId;
          if (!id) return cs;
          const found = cs.find((c) => c.id === id);
          if (!found) return cs;
          return [{ ...found, updatedAt: new Date() }, ...cs.filter((c) => c.id !== id)];
        });
        break;
      }
      case "error":
        setError((evt.message as string) ?? "Something went wrong.");
        break;
    }
  }

  const remaining = Math.max(0, usage.limit - used);
  const canSend =
    enabled && !limitReached && !streaming && (input.trim().length > 0 || pending.length > 0);
  const labelFor = (id?: string) =>
    id ? (models.find((mm) => mm.id === id)?.label ?? id) : null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Sidebar (collapsible) */}
      {sidebarOpen ? (
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            Chats
          </span>
          <button
            onClick={() => toggleSidebar(false)}
            title="Hide sidebar"
            aria-label="Hide sidebar"
            className="rounded px-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900"
          >
            «
          </button>
        </div>
        <button
          onClick={newChat}
          className="mx-3 mb-2 mt-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          + New chat
        </button>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {convos.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-400">No conversations yet.</p>
          ) : (
            convos.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
                  c.id === activeId
                    ? "bg-zinc-100 dark:bg-zinc-900"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                }`}
              >
                <button
                  onClick={() => openConversation(c.id)}
                  className="flex-1 truncate text-left"
                  title={c.title}
                >
                  {c.title}
                </button>
                <button
                  onClick={() => remove(c.id)}
                  className="opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                  title="Delete conversation"
                  aria-label="Delete conversation"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </nav>
        <div className="border-t border-zinc-200 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <span>{pro ? "Pro" : "Free"}</span>
            <span className="font-mono">
              {used} / {usage.limit}
            </span>
          </div>
          {!pro && (
            <Link href="/profile" className="mt-1 inline-block text-zinc-400 hover:underline">
              {remaining} messages left this month →
            </Link>
          )}
        </div>
      </aside>
      ) : (
        <button
          onClick={() => toggleSidebar(true)}
          title="Show sidebar"
          aria-label="Show sidebar"
          className="m-2 h-8 w-8 shrink-0 self-start rounded-md border border-zinc-300 text-zinc-500 transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          »
        </button>
      )}

      {/* Main — also the drop target */}
      <main
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (!enabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (enabled && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-zinc-400 bg-zinc-50/80 text-sm font-medium text-zinc-600 dark:bg-zinc-900/80 dark:text-zinc-300">
            Drop images to attach
          </div>
        )}

        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex w-full flex-col gap-4 px-4 py-6 sm:px-8">
            {messages.length === 0 ? (
              <div className="mt-24 text-center">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  What can I help with?
                </h1>
                <p className="mt-2 text-sm text-zinc-500">
                  {enabled
                    ? "Pick a model, drop in an image, or just start typing. Claude can search the web."
                    : "Chat isn’t configured on this server yet."}
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
                    }`}
                  >
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {m.attachments.map((a, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={srcOf(a)}
                            alt={a.name ?? "attachment"}
                            onClick={() => setLightbox(srcOf(a))}
                            className="h-28 w-28 cursor-zoom-in rounded-lg object-cover"
                          />
                        ))}
                      </div>
                    )}
                    {m.role === "assistant" ? (
                      m.content ? (
                        <Markdown>{m.content}</Markdown>
                      ) : streaming ? (
                        <span>…</span>
                      ) : null
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )}
                  </div>
                  {m.role === "assistant" && m.model && (
                    <span className="mt-1 px-1 font-mono text-[10px] text-zinc-400">
                      {m.auto ? "✦ Auto → " : ""}
                      {labelFor(m.model)}
                      {m.reason ? ` · ${m.reason}` : ""}
                    </span>
                  )}
                </div>
              ))
            )}
            {searchStatus && (
              <p className="flex justify-start text-xs italic text-zinc-400">
                🔎 {searchStatus}
              </p>
            )}
          </div>
        </div>

        {/* Composer — edge-to-edge (wall-to-wall on tablets), minimal gutters */}
        <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800">
          <div className="w-full px-2 py-2">
            {error && (
              <p className="mb-2 text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            {limitReached && (
              <p className="mb-2 text-sm text-amber-600 dark:text-amber-400">
                Monthly limit reached.{" "}
                <Link href="/profile" className="underline">
                  Upgrade to Pro
                </Link>{" "}
                for more.
              </p>
            )}

            {pending.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pending.map((a, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={srcOf(a)}
                      alt={a.name ?? "attachment"}
                      onClick={() => setLightbox(srcOf(a))}
                      className="h-16 w-16 cursor-zoom-in rounded-md object-cover"
                    />
                    <button
                      onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-xs text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                      aria-label="Remove attachment"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as ChatModel)}
                disabled={streaming}
                className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-2.5 text-xs text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                title={
                  model === "auto"
                    ? "Auto picks the best model for each message"
                    : models.find((m) => m.id === model)?.blurb
                }
              >
                <option value="auto" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50">
                  ✦ Auto
                </option>
                {models.map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                    className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
                  >
                    {m.label}
                  </option>
                ))}
              </select>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!enabled || streaming}
                title="Attach images"
                aria-label="Attach images"
                className="rounded-md border border-zinc-300 px-2.5 py-2 text-sm transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                📎
              </button>

              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files);
                  if (files.length) {
                    e.preventDefault();
                    addFiles(files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={enabled ? "Message Static Cling…" : "Chat unavailable"}
                disabled={!enabled || limitReached || streaming}
                className="no-scrollbar min-h-[48px] flex-1 resize-none overflow-y-auto rounded-md border border-zinc-300 bg-transparent px-3 py-2.5 text-[15px] outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
              />
              <button
                onClick={send}
                disabled={!canSend}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
              >
                {streaming ? "…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </main>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
          title="Click to close"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
