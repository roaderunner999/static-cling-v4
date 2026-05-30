"use client";

import { useRef, useState } from "react";

/**
 * Voice bake-off — an admin /lab panel that plays one line through every TTS
 * engine and times the time-to-first-audio (TTFA) so we pick the fast tier by
 * ear AND by the numbers. The lag complaint that sends Walter back to the native
 * voice is exactly what this measures. Native is timed in-browser (speak() →
 * onstart); the paid engines stream from /api/tts/bench, which also reports a
 * pure server-side TTFA in the `x-ttfa-ms` header.
 *
 * `enabled` says which keys are present on the server, so an unconfigured engine
 * shows an honest "add the key" hint instead of a dead Play button.
 */

type EngineId = "native" | "cartesia" | "eleven_flash" | "eleven_turbo" | "deepgram";
type Needs = "eleven" | "cartesia" | "deepgram" | null;

const ENGINES: { id: EngineId; label: string; sub: string; needs: Needs }[] = [
  { id: "native", label: "Native (browser)", sub: "Free · zero network — the fallback", needs: null },
  { id: "cartesia", label: "Cartesia Sonic", sub: "~90ms target · custom voices", needs: "cartesia" },
  { id: "eleven_flash", label: "ElevenLabs Flash", sub: "Their fast model", needs: "eleven" },
  { id: "eleven_turbo", label: "ElevenLabs Turbo", sub: "Today's premium default", needs: "eleven" },
  { id: "deepgram", label: "Deepgram Aura-2", sub: "Voice-agent TTS", needs: "deepgram" },
];

const DEFAULT_LINE =
  "Hey — this is the same sentence in every voice, so you can hear which one feels instant and which one lags.";

type Result = {
  status: "idle" | "loading" | "playing" | "done" | "error" | "locked";
  ttfaClient?: number; // round-trip to first audio, as the user feels it
  ttfaServer?: number; // pure upstream first-byte (network engines only)
  error?: string;
};

function tone(ms?: number) {
  if (ms == null) return "text-zinc-400";
  if (ms < 150) return "text-emerald-600 dark:text-emerald-400";
  if (ms < 350) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function VoiceBench({
  enabled,
}: {
  enabled: { eleven: boolean; cartesia: boolean; deepgram: boolean };
}) {
  const [text, setText] = useState(DEFAULT_LINE);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const isLocked = (needs: Needs) =>
    needs !== null && !enabled[needs as keyof typeof enabled];

  function set(id: EngineId, r: Result) {
    setResults((prev) => ({ ...prev, [id]: r }));
  }

  function cleanupAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }

  // Native browser voice — no network, so we time speak() → onstart and resolve
  // when it finishes so "Play all" can move to the next engine cleanly.
  function playNative(): Promise<void> {
    return new Promise((resolve) => {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const t0 = performance.now();
        set("native", { status: "loading" });
        u.onstart = () =>
          set("native", { status: "playing", ttfaClient: Math.round(performance.now() - t0) });
        u.onend = () => {
          setResults((prev) => ({
            ...prev,
            native: { ...prev.native, status: "done" },
          }));
          resolve();
        };
        u.onerror = () => {
          set("native", { status: "error", error: "Browser speech failed." });
          resolve();
        };
        window.speechSynthesis.speak(u);
      } catch {
        set("native", { status: "error", error: "No speech synthesis in this browser." });
        resolve();
      }
    });
  }

  // Network engines — stream from the bench route, time first byte client-side,
  // read the server's pure TTFA header, then play the assembled clip.
  async function playEngine(id: Exclude<EngineId, "native">): Promise<void> {
    set(id, { status: "loading" });
    const t0 = performance.now();
    try {
      const res = await fetch("/api/tts/bench", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, engine: id }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        set(id, { status: "error", error: j.error ?? `Failed (${res.status}).` });
        return;
      }
      const ttfaServer = Number(res.headers.get("x-ttfa-ms")) || undefined;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let ttfaClient: number | undefined;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          if (ttfaClient == null) ttfaClient = Math.round(performance.now() - t0);
          chunks.push(value);
        }
      }
      set(id, { status: "loading", ttfaClient, ttfaServer });

      cleanupAudio();
      const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise<void>((resolve) => {
        audio.onplay = () =>
          set(id, { status: "playing", ttfaClient, ttfaServer });
        audio.onended = () => {
          set(id, { status: "done", ttfaClient, ttfaServer });
          resolve();
        };
        audio.onerror = () => {
          set(id, { status: "error", ttfaClient, ttfaServer, error: "Playback failed." });
          resolve();
        };
        void audio.play().catch(() => {
          set(id, { status: "error", ttfaClient, ttfaServer, error: "Autoplay blocked — click Play." });
          resolve();
        });
      });
    } catch {
      set(id, { status: "error", error: "Network error." });
    }
  }

  async function playOne(id: EngineId) {
    if (busy) return;
    setBusy(true);
    cleanupAudio();
    window.speechSynthesis?.cancel();
    if (id === "native") await playNative();
    else await playEngine(id);
    setBusy(false);
  }

  async function playAll() {
    if (busy) return;
    setBusy(true);
    for (const e of ENGINES) {
      if (isLocked(e.needs)) {
        set(e.id, { status: "locked" });
        continue;
      }
      cleanupAudio();
      window.speechSynthesis?.cancel();
      if (e.id === "native") await playNative();
      else await playEngine(e.id);
    }
    setBusy(false);
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Voice bake-off
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Same line, every engine — ranked by time-to-first-audio. Lower is snappier.
            Uses real API credits (capped at 400 chars).
          </p>
        </div>
        <button
          onClick={playAll}
          disabled={busy}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {busy ? "Playing…" : "▶ Play all"}
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 400))}
        rows={2}
        className="mb-4 w-full resize-none rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        placeholder="Type a line to hear in every voice…"
      />

      <div className="flex flex-col gap-2">
        {ENGINES.map((e) => {
          const locked = isLocked(e.needs);
          const r: Result = locked ? { status: "locked" } : results[e.id] ?? { status: "idle" };
          const primary = r.ttfaClient;
          const barPct = primary != null ? Math.min(100, Math.round(primary / 10)) : 0;
          return (
            <div
              key={e.id}
              className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
            >
              <button
                onClick={() => playOne(e.id)}
                disabled={busy || locked}
                title={locked ? "Engine not configured" : "Play this engine"}
                className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm transition hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {r.status === "playing" ? "🔊" : "▶"}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{e.label}</span>
                  {r.status === "playing" && (
                    <span className="shrink-0 text-xs text-zinc-400">playing…</span>
                  )}
                </div>
                <div className="truncate text-xs text-zinc-400">
                  {locked ? `🔒 Add the API key in .env to test` : e.sub}
                </div>
                {/* latency bar */}
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={`h-full rounded-full transition-all ${
                      primary == null
                        ? ""
                        : primary < 150
                          ? "bg-emerald-500"
                          : primary < 350
                            ? "bg-amber-500"
                            : "bg-red-500"
                    }`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>

              <div className="shrink-0 text-right">
                {r.status === "error" ? (
                  <span className="text-xs text-red-500">{r.error}</span>
                ) : locked ? (
                  <span className="font-mono text-xs text-zinc-400">—</span>
                ) : (
                  <>
                    <div className={`font-mono text-sm font-semibold ${tone(primary)}`}>
                      {primary != null ? `${primary} ms` : "—"}
                    </div>
                    <div className="font-mono text-[10px] text-zinc-400">
                      {r.ttfaServer != null ? `upstream ${r.ttfaServer}ms` : "first audio"}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-zinc-400">
        <span className="text-emerald-600 dark:text-emerald-400">●</span> &lt;150ms instant ·{" "}
        <span className="text-amber-600 dark:text-amber-400">●</span> &lt;350ms fine ·{" "}
        <span className="text-red-600 dark:text-red-400">●</span> 350ms+ laggy. &ldquo;upstream&rdquo;
        is the provider&rsquo;s own first-byte time; the big number includes our server hop, i.e. what a user feels.
      </p>
    </section>
  );
}
