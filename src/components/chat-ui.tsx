"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ConversationSummary } from "@/lib/chat-queries";
import type { ModelInfo, ModelId, TtsModelId } from "@/lib/models";
import { TTS_MODELS } from "@/lib/models";
import {
  loadConversation,
  deleteConversation,
  searchChatContent,
  type LoadedMessage,
} from "@/lib/chat-actions";
import { Markdown } from "@/components/markdown";
import { SidebarSearch, useContentSearch, Highlight } from "@/components/sidebar-search";
import { useDictation, useSpeech, type VoiceMode } from "@/lib/use-voice";

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
  startNew = false,
  initialModel = "auto",
  voice = { premiumAvailable: false },
}: {
  conversations: ConversationSummary[];
  models: ModelInfo[];
  enabled: boolean;
  pro: boolean;
  usage: { used: number; limit: number };
  requestedId?: string;
  /** `/chat?new=1` — open a blank new chat instead of resuming the last one. */
  startNew?: boolean;
  /** The user's preferred default model for new chats (from /settings). */
  initialModel?: ChatModel;
  /** Voice capabilities resolved on the server (premium = ElevenLabs keyed). */
  voice?: { premiumAvailable: boolean };
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
  const [convoQuery, setConvoQuery] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Voice: dictation (input) + speech (output). Both degrade gracefully —
  // dictation needs the browser's Web Speech API, premium speech needs the
  // server's ElevenLabs key; everything still works without either.
  const dictation = useDictation();
  const speech = useSpeech(voice.premiumAvailable);
  // Holds the streaming assistant text so we can auto-read it aloud once the
  // reply finishes (when a voice output mode is active).
  const speakBuffer = useRef("");

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
  // On a phone the conversation list and the thread can't share the width, so
  // opening a chat (or starting one) drops the list and shows the thread full-
  // screen. On desktop (md+) both panes coexist, so the sidebar stays put.
  const isMobile = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

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
    // `/chat?new=1` (the dashboard's "Start a new chat") forces a blank chat —
    // skip the resume so we don't just reopen the conversation already on screen.
    // An explicit `?id=` still wins (you asked for a specific thread).
    if (conversations.length > 0 && !(startNew && !requestedId)) {
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
      if (hasPrefill || (startNew && !requestedId)) inputRef.current?.focus();
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
    // Tear the mic down on send. On phones the recognition session ends after a
    // pause; left "listening", the button stayed lit but captured nothing until
    // a full page refresh. Stopping here means each turn gets a fresh session —
    // tap the mic again to dictate the next message.
    if (dictation.listening) dictation.stop();
    speech.stop(); // a new turn cuts off any reply still being read aloud
    speakBuffer.current = "";
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
        speakBuffer.current += text;
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
        // Read the finished reply aloud if a voice output mode is on. Pass the
        // message id so that reply's own ⏹ button reflects/stops the playback.
        if (speech.mode !== "off" && speakBuffer.current.trim()) {
          speech.speak(speakBuffer.current, undefined, assistantTmpId);
        }
        break;
      }
      case "error":
        setError((evt.message as string) ?? "Something went wrong.");
        break;
    }
  }

  const remaining = Math.max(0, usage.limit - used);
  // Filter the sidebar list. Title matches are instant (local); message-body
  // matches come from the debounced server search (convoHits, id → snippet).
  const { hits: convoHits } = useContentSearch(convoQuery, searchChatContent);
  const convoNeedle = convoQuery.trim().toLowerCase();
  const visibleConvos = convoNeedle
    ? convos.filter(
        (c) =>
          (c.title || "").toLowerCase().includes(convoNeedle) || convoHits?.has(c.id),
      )
    : convos;
  const canSend =
    enabled && !limitReached && !streaming && (input.trim().length > 0 || pending.length > 0);
  const labelFor = (id?: string) =>
    id ? (models.find((mm) => mm.id === id)?.label ?? id) : null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Sidebar (collapsible) */}
      {sidebarOpen ? (
      <aside className="flex w-full shrink-0 flex-col border-r border-zinc-200 md:w-64 dark:border-zinc-800">
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
          onClick={() => {
            newChat();
            if (isMobile()) toggleSidebar(false);
          }}
          className="mx-3 mb-2 mt-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          + New chat
        </button>
        {convos.length > 0 && (
          <SidebarSearch
            value={convoQuery}
            onChange={setConvoQuery}
            placeholder="Search chats"
          />
        )}
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {convos.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-400">No conversations yet.</p>
          ) : visibleConvos.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-400">No chats match “{convoQuery}”.</p>
          ) : (
            visibleConvos.map((c) => (
              <div
                key={c.id}
                className={`group flex items-start gap-1 rounded-md px-2 py-1.5 text-sm ${
                  c.id === activeId
                    ? "bg-zinc-100 dark:bg-zinc-900"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                }`}
              >
                <button
                  onClick={() => {
                    openConversation(c.id);
                    if (isMobile()) toggleSidebar(false);
                  }}
                  className="min-w-0 flex-1 text-left"
                  title={c.title}
                >
                  <div className="truncate">{c.title}</div>
                  {convoHits?.has(c.id) && (
                    <div className="truncate text-xs text-zinc-400">
                      <Highlight text={convoHits.get(c.id)!} needle={convoQuery} />
                    </div>
                  )}
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

      {/* Main — also the drop target. On a phone it's hidden while the list is
          open so the two panes never fight over the narrow width; md+ shows both. */}
      <main
        className={`relative ${sidebarOpen ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col`}
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
                  {m.role === "assistant" && (m.model || m.content) && (
                    <div className="mt-1 flex items-center gap-1.5 px-1">
                      {m.model && (
                        <span className="font-mono text-[10px] text-zinc-400">
                          {m.auto ? "✦ Auto → " : ""}
                          {labelFor(m.model)}
                          {m.reason ? ` · ${m.reason}` : ""}
                        </span>
                      )}
                      {m.content && (() => {
                        const playingThis = speech.speakingId === m.id;
                        return (
                          <button
                            onClick={() =>
                              playingThis
                                ? speech.stop()
                                : speech.speak(
                                    m.content,
                                    speech.mode === "off" ? "native" : undefined,
                                    m.id,
                                  )
                            }
                            title={playingThis ? "Stop" : "Read aloud"}
                            aria-label={playingThis ? "Stop reading" : "Read aloud"}
                            className="text-[11px] leading-none text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
                          >
                            {playingThis ? "⏹" : "🔊"}
                          </button>
                        );
                      })()}
                    </div>
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
            {speech.error && (
              <p
                className="mb-2 flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400"
                role="alert"
              >
                <span>🔇 {speech.error}</span>
                <button
                  onClick={speech.clearError}
                  className="shrink-0 underline"
                  aria-label="Dismiss"
                >
                  dismiss
                </button>
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              {/* Controls wrap onto their own line on a phone so they never shove
                  the textarea/Send off-screen; inline with everything on sm+. */}
              <div className="flex items-center gap-2">
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

              {dictation.supported && (
                <button
                  onClick={() =>
                    dictation.toggle((phrase) =>
                      setInput((t) => (t ? `${t} ${phrase}` : phrase)),
                    )
                  }
                  disabled={!enabled || limitReached}
                  title={dictation.listening ? "Stop dictation" : "Dictate (speak your message)"}
                  aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
                  className={`rounded-md border px-2.5 py-2 text-sm transition disabled:opacity-40 ${
                    dictation.listening
                      ? "animate-pulse border-red-400 bg-red-50 dark:border-red-500 dark:bg-red-950"
                      : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {dictation.listening ? "🔴" : "🎤"}
                </button>
              )}

              <button
                onClick={() => {
                  const order: VoiceMode[] = voice.premiumAvailable
                    ? ["off", "native", "premium"]
                    : ["off", "native"];
                  const next = order[(order.indexOf(speech.mode) + 1) % order.length];
                  if (next === "off") speech.stop();
                  speech.setVoiceMode(next);
                }}
                title={
                  speech.mode === "off"
                    ? "Voice replies: off — click to read replies aloud"
                    : speech.mode === "native"
                      ? "Voice replies: native (free, built-in)"
                      : "Voice replies: premium (ElevenLabs)"
                }
                aria-label="Toggle spoken replies"
                className={`shrink-0 rounded-md border px-2.5 py-2 text-sm transition ${
                  speech.mode === "off"
                    ? "border-zinc-300 text-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    : "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-950 dark:text-violet-300"
                }`}
              >
                {speech.mode === "off" ? "🔇" : speech.mode === "native" ? "🔈" : "✨"}
              </button>

              {/* Premium-only: pick the ElevenLabs voice model. Turbo is the
                  snappy/cheaper default; v3 is richest but ~2× the credits.
                  Only meaningful while premium is the active mode. */}
              {voice.premiumAvailable && speech.mode === "premium" && (
                <select
                  value={speech.ttsModel}
                  onChange={(e) => speech.setTtsModel(e.target.value as TtsModelId)}
                  title="Premium voice model — Turbo (fast, ~half the cost) or v3 (richest, pricier)"
                  aria-label="Premium voice model"
                  className="shrink-0 rounded-md border border-violet-400 bg-violet-50 px-1.5 py-2 text-xs text-violet-700 outline-none dark:border-violet-500 dark:bg-violet-950 dark:text-violet-300"
                >
                  {TTS_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
              </div>

              <div className="flex min-w-0 flex-1 items-end gap-2">
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
                className="no-scrollbar min-h-[48px] min-w-0 flex-1 resize-none overflow-y-auto rounded-md border border-zinc-300 bg-transparent px-3 py-2.5 text-[15px] outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
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
