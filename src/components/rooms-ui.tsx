"use client";

import { useEffect, useRef, useState } from "react";
import {
  SUGGESTED_ROOMS,
  slugifyRoom,
  ROOM_ATTACH_MAX_FILES,
  ROOM_ATTACH_MAX_BYTES,
  type RoomAttachment,
  type RoomMsgMeta,
} from "@/lib/rooms-shared";
import { labelForModel } from "@/lib/models";

/**
 * Self-hosted group chat — the "rooms" feature. A single-column room (selector +
 * presence + message stream + composer) so it's clean on phone and desktop alike.
 * Realtime is an EventSource on /api/rooms/stream (backfill → live message/presence);
 * sending is a POST to /api/rooms/send. Claude (violet) and Claudette (rose) reply
 * to human turns and stream in like real participants — no LiveKit, no per-minute cost.
 */

type Kind = "human" | "claude" | "claudette";
type Msg = {
  id: string;
  room: string;
  authorId: string | null;
  authorName: string;
  kind: Kind;
  body: string;
  attachments?: RoomAttachment[];
  meta?: RoomMsgMeta;
  createdAt: string;
};
type Who = { id: string; name: string };

function timeOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/** Downscale a photo to a sane size (max 1280px, JPEG) so base64-in-DB stays
 *  reasonable; small images are kept as-is to preserve PNG/transparency. */
async function downscaleImage(file: File): Promise<string> {
  const dataUrl = await readAsDataURL(file);
  if (file.size <= 500 * 1024) return dataUrl;
  try {
    const img = document.createElement("img");
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("img"));
      img.src = dataUrl;
    });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return dataUrl;
  }
}

function mediaTypeOf(dataUrl: string, fallback: string): string {
  const m = /^data:([^;,]+)/.exec(dataUrl);
  return m ? m[1] : fallback;
}

/** Turn a dropped/picked File into a RoomAttachment (or null if it can't fit). */
async function fileToAttachment(file: File): Promise<RoomAttachment | null> {
  try {
    if (file.type.startsWith("image/")) {
      const url = await downscaleImage(file);
      return { name: file.name, mediaType: mediaTypeOf(url, "image/jpeg"), kind: "image", url, size: file.size };
    }
    if (file.size > ROOM_ATTACH_MAX_BYTES) return null; // non-images: hard size cap
    const url = await readAsDataURL(file);
    return {
      name: file.name,
      mediaType: file.type || "application/octet-stream",
      kind: "file",
      url,
      size: file.size,
    };
  } catch {
    return null;
  }
}

export function RoomsUI({ userId, displayName }: { userId: string; displayName: string }) {
  const [room, setRoom] = useState("general");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [presence, setPresence] = useState<Who[]>([]);
  const [input, setInput] = useState("");
  const [live, setLive] = useState(false);
  const [newRoom, setNewRoom] = useState("");
  // Rooms the user has created/visited beyond the curated SUGGESTED_ROOMS, kept
  // as pills so a new room "sticks" and is reachable again. Persisted locally.
  const [customRooms, setCustomRooms] = useState<string[]>([]);
  const [listen, setListen] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  // Files staged to send with the next message + drag-drop / lightbox state.
  const [pending, setPending] = useState<RoomAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Read inside the SSE closure (which captures first-render values), so the
  // live handler always sees the CURRENT listen state.
  const listenRef = useRef(false);
  // Two distinct native voices so Claude and Claudette sound like two people.
  const claudeVoice = useRef<SpeechSynthesisVoice | null>(null);
  const claudetteVoice = useRef<SpeechSynthesisVoice | null>(null);

  // Native browser TTS — free, no limit, basically no delay. Voices load async,
  // so (re)pick on voiceschanged. Claude takes the first English voice, Claudette
  // a different one; pitch/rate nudges guarantee they differ even on one voice.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const pick = () => {
      const en = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
      if (!en.length) return;
      claudeVoice.current = en[0];
      claudetteVoice.current = en.find((v) => v.name !== en[0].name) ?? en[0];
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  function speakMessage(m: Msg) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(m.body);
    if (m.kind === "claudette") {
      u.voice = claudetteVoice.current;
      u.pitch = 1.15;
      u.rate = 1.03;
    } else {
      u.voice = claudeVoice.current;
      u.pitch = 0.95;
      u.rate = 1.0;
    }
    // Chromium can leave synthesis in a "paused" limbo; resume() before each
    // speak keeps later (network-triggered) reads from silently no-op'ing.
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(u); // the browser queues utterances for us
  }

  function toggleListen() {
    const next = !listen;
    setListen(next);
    listenRef.current = next;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (next) {
      // CRITICAL unlock: speak once INSIDE this click (a real user gesture).
      // Browsers (Brave especially) block speech that isn't kicked off by a
      // gesture — so reads fired later from an SSE event get dropped unless we
      // prime the engine here first. Doubles as an audible "it's working" cue.
      setVoiceMsg(null);
      window.speechSynthesis.cancel();
      const hello = new SpeechSynthesisUtterance("Voice on");
      hello.voice = claudeVoice.current;
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(hello);
      // Diagnose a silent failure: if NO voices exist a beat later, the browser
      // is muting the Web Speech API (Brave's fingerprint protection does this).
      // Tell the user instead of failing silently.
      window.setTimeout(() => {
        if (window.speechSynthesis && window.speechSynthesis.getVoices().length === 0) {
          setVoiceMsg(
            "Your browser is blocking voices (Brave Shields). Lower Shields for this site to hear Claude & Claudette — or ask for server voice.",
          );
        }
      }, 700);
    } else {
      setVoiceMsg(null);
      window.speechSynthesis.cancel();
    }
  }

  // One SSE connection per room. Re-opened whenever the room changes; clearing
  // the old room's state here is the intended reset, not a cascading render.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setMessages([]);
    setPresence([]);
    setLive(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    const es = new EventSource(`/api/rooms/stream?room=${encodeURIComponent(room)}`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (e) => {
      let data: unknown;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      const evt = data as
        | { type: "backfill"; messages: Msg[] }
        | { type: "message"; message: Msg }
        | { type: "presence"; users: Who[] };
      if (evt.type === "backfill") setMessages(evt.messages);
      else if (evt.type === "message") {
        const msg = evt.message;
        // Echo includes our own sent message; dedupe by id keeps it idempotent.
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        // Read AI turns aloud when Listen is on — live messages only, never the
        // backfill (backfill arrives as one bulk event, not per-message).
        if (listenRef.current && msg.kind !== "human") speakMessage(msg);
      } else if (evt.type === "presence") setPresence(evt.users);
    };
    return () => es.close();
  }, [room]);

  // Stick to the bottom as new messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Convert + stage dropped/picked files (capped at ROOM_ATTACH_MAX_FILES total).
  async function addFiles(files: FileList | File[]) {
    setAttachNote(null);
    const list = Array.from(files);
    const room0 = ROOM_ATTACH_MAX_FILES - pending.length;
    if (room0 <= 0) {
      setAttachNote(`Up to ${ROOM_ATTACH_MAX_FILES} files per message.`);
      return;
    }
    const converted = await Promise.all(list.slice(0, room0).map(fileToAttachment));
    const ok = converted.filter((a): a is RoomAttachment => a !== null);
    if (ok.length < list.length) {
      setAttachNote(
        `Some files were skipped — non-images must be under ${prettyBytes(ROOM_ATTACH_MAX_BYTES)}.`,
      );
    }
    if (ok.length) setPending((prev) => [...prev, ...ok].slice(0, ROOM_ATTACH_MAX_FILES));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
  }
  function onDragEnter(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  }
  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  async function send() {
    const body = input.trim();
    const atts = pending;
    if (!body && atts.length === 0) return;
    setInput("");
    setPending([]);
    setAttachNote(null);
    try {
      await fetch("/api/rooms/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room, body, attachments: atts }),
      });
      // The message appears when the SSE stream echoes it back — no optimistic add.
    } catch {
      setInput(body); // restore on failure so nothing is lost
      setPending(atts);
    }
  }

  // Load remembered custom rooms once.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("staticcling_rooms") || "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(saved)) setCustomRooms(saved.filter((s) => typeof s === "string"));
    } catch {
      /* ignore */
    }
  }, []);

  function switchRoom(raw: string) {
    // Slugify the SAME way the server does, so client + server agree on the room
    // (a typed "My Room" → "my-room" on both sides; before, the client kept the
    // raw spaced text and the new room silently never matched / never showed).
    const s = slugifyRoom(raw);
    if (!s) return;
    setRoom(s);
    // Register any non-suggested room as a pill and remember it across reloads.
    const suggested = SUGGESTED_ROOMS.some((r) => r.slug === s);
    if (!suggested) {
      setCustomRooms((prev) => {
        if (prev.includes(s)) return prev;
        const next = [...prev, s];
        try {
          localStorage.setItem("staticcling_rooms", JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }
  }

  return (
    <div
      className="relative flex min-h-0 w-full flex-1 flex-col"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Whole-area drop target overlay */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 m-2 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-violet-400 bg-violet-50/80 backdrop-blur-sm dark:border-violet-500 dark:bg-violet-950/60">
          <span className="text-3xl">📎</span>
          <p className="mt-2 text-sm font-medium text-violet-700 dark:text-violet-300">
            Drop files to share in #{room}
          </p>
          <p className="text-xs text-violet-500/80">Images &amp; PDFs · up to {ROOM_ATTACH_MAX_FILES}</p>
        </div>
      )}

      {/* Lightbox for viewing a shared image full-screen */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}

      {/* Room bar: pick a room + presence */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-1.5">
          {SUGGESTED_ROOMS.map((r) => (
            <button
              key={r.slug}
              onClick={() => switchRoom(r.slug)}
              title={r.blurb}
              className={`rounded-full px-3 py-1 text-sm transition ${
                room === r.slug
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              #{r.slug}
            </button>
          ))}
          {customRooms.map((slug) => (
            <button
              key={slug}
              onClick={() => switchRoom(slug)}
              title="Your room"
              className={`rounded-full px-3 py-1 text-sm transition ${
                room === slug
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              #{slug}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              switchRoom(newRoom);
              setNewRoom("");
            }}
          >
            <input
              value={newRoom}
              onChange={(e) => setNewRoom(e.target.value)}
              placeholder="+ room"
              className="w-20 rounded-full border border-dashed border-zinc-300 bg-transparent px-3 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </form>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleListen}
            title={
              listen
                ? "Listening — Claude & Claudette are read aloud (free native voice)"
                : "Hear it: read Claude & Claudette aloud"
            }
            aria-label="Toggle read-aloud"
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              listen
                ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-950 dark:text-violet-300"
                : "border-zinc-300 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {listen ? "🔊 Listening" : "🔈 Listen"}
          </button>
          <span
            className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
            title={presence.map((p) => p.name).join(", ")}
          >
            ● {presence.length} here
          </span>
          {!live && <span className="text-xs text-zinc-400">connecting…</span>}
        </div>
      </div>

      {voiceMsg && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="flex-1">🔇 {voiceMsg}</span>
          <button
            onClick={() => setVoiceMsg(null)}
            className="shrink-0 rounded px-1 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="mt-16 text-center text-sm text-zinc-400">
            <p className="text-base font-medium text-zinc-500">Welcome to #{room}</p>
            <p className="mt-1">
              Say hi — Claude and Claudette are in the room. Drop a question and they&rsquo;ll
              jump in.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => {
              const mine = m.kind === "human" && m.authorId === userId;
              const accent =
                m.kind === "claude"
                  ? "text-violet-600 dark:text-violet-400"
                  : m.kind === "claudette"
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-zinc-500";
              const bubble =
                m.kind === "claude"
                  ? "bg-violet-50 text-zinc-800 dark:bg-violet-950/40 dark:text-zinc-100"
                  : m.kind === "claudette"
                    ? "bg-rose-50 text-zinc-800 dark:bg-rose-950/40 dark:text-zinc-100"
                    : mine
                      ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100";
              return (
                <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  <div className="mb-0.5 flex items-center gap-1.5 px-1">
                    <span className={`text-xs font-semibold ${accent}`}>
                      {m.authorName}
                      {m.kind !== "human" && " ✨"}
                    </span>
                    <span className="text-[10px] text-zinc-400">{timeOf(m.createdAt)}</span>
                  </div>
                  <div className={`flex max-w-[85%] flex-col gap-2 ${mine ? "items-end" : "items-start"}`}>
                    {m.body && (
                      <div
                        className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${bubble}`}
                      >
                        {m.body}
                      </div>
                    )}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {m.attachments.map((a, i) =>
                          a.kind === "image" ? (
                            <button
                              key={i}
                              onClick={() => setLightbox(a.url)}
                              title={`${a.name} — click to view`}
                              className="overflow-hidden rounded-lg border border-zinc-200 transition hover:opacity-90 dark:border-zinc-700"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={a.url} alt={a.name} className="max-h-44 max-w-[220px] object-cover" />
                            </button>
                          ) : (
                            <a
                              key={i}
                              href={a.url}
                              download={a.name}
                              title={`${a.name} — click to download`}
                              className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                            >
                              <span className="text-lg">📄</span>
                              <span className="min-w-0">
                                <span className="block max-w-[180px] truncate font-medium text-zinc-800 dark:text-zinc-100">
                                  {a.name}
                                </span>
                                <span className="text-xs text-zinc-400">
                                  {prettyBytes(a.size)} · download
                                </span>
                              </span>
                            </a>
                          ),
                        )}
                      </div>
                    )}
                    {/* Thin transparency strip — ONLY when the AI actually hit the
                        web this turn (server-confirmed, not the model's word). */}
                    {m.kind !== "human" && m.meta?.web && (
                      <span className="px-1 text-[10px] text-zinc-400">
                        🌐 searched the web
                        {m.meta.model ? ` · ${labelForModel(m.meta.model)}` : ""}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        {attachNote && (
          <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">{attachNote}</p>
        )}
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 py-1 pl-1 pr-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {a.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.name} className="h-8 w-8 rounded object-cover" />
                ) : (
                  <span className="grid h-8 w-8 place-items-center text-lg">📄</span>
                )}
                <span className="max-w-[120px] truncate text-xs text-zinc-600 dark:text-zinc-300">
                  {a.name}
                </span>
                <button
                  onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remove file"
                  className="text-zinc-400 transition hover:text-red-600"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = ""; // allow re-picking the same file
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files (images, PDFs)"
            aria-label="Attach files"
            className="shrink-0 rounded-md border border-zinc-300 px-3 py-2.5 text-sm text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            📎
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message #${room} as ${displayName.split(" ")[0]}…`}
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          <button
            type="submit"
            disabled={!input.trim() && pending.length === 0}
            className="shrink-0 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
