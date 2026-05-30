"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_TTS_MODEL, isTtsModel, type TtsModelId } from "@/lib/models";

/**
 * Voice for the chat — input (dictation) and output (speech), both with a free
 * native path and an optional premium upgrade.
 *
 *   useDictation()  speech -> text. 100% browser-native (Web Speech API).
 *                   Zero latency, zero cost, no key. Excellent in Chrome/Brave.
 *   useSpeech()     text -> speech. Native by default (free, instant, robotic);
 *                   "premium" routes through /api/tts (ElevenLabs) when the
 *                   server has it configured.
 *
 * The design rule: voice always works out of the box. The premium voice is a
 * toggle on top, never a hard dependency.
 */

// --- Minimal Web Speech API typings (not in the DOM lib by default) ----------
type SpeechRecognitionResult = {
  0: { transcript: string };
  isFinal: boolean;
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResult };
};
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Push-to-talk dictation. start(onFinal) begins listening and fires onFinal
 * with each finalized phrase (the caller appends it to the input). toggle()
 * starts/stops. `supported` is false on browsers without the Web Speech API.
 */
export function useDictation() {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Whether the user still wants to be listening. iOS Safari ends the
  // recognition session after every pause even in "continuous" mode; we use
  // this to auto-restart so it behaves like true continuous dictation there,
  // and to make sure unmount/stop genuinely stops (no zombie restart).
  const wantsRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(getRecognitionCtor() !== null);
    return () => {
      wantsRef.current = false;
      recRef.current?.stop();
    };
  }, []);

  const stop = useCallback(() => {
    wantsRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(
    (onFinal: (text: string) => void) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) return;
      const rec = new Ctor();
      rec.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) onFinal(r[0].transcript.trim());
        }
      };
      rec.onerror = (e) => {
        // Permission/service denial = give up. Transient (no-speech, aborted,
        // network) = leave it to onend, which will resume if still wanted.
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          wantsRef.current = false;
        }
      };
      rec.onend = () => {
        // Still wanted? Transparently restart (the iOS continuous workaround).
        if (wantsRef.current && recRef.current) {
          try {
            recRef.current.start();
            return;
          } catch {
            // fall through to a clean stop
          }
        }
        recRef.current = null;
        setListening(false);
      };
      wantsRef.current = true;
      recRef.current = rec;
      rec.start();
      setListening(true);
    },
    [],
  );

  const toggle = useCallback(
    (onFinal: (text: string) => void) => {
      if (listening) stop();
      else start(onFinal);
    },
    [listening, start, stop],
  );

  return { supported, listening, start, stop, toggle };
}

export type VoiceMode = "off" | "native" | "premium";

/**
 * Speak text aloud. Native uses the browser's speechSynthesis (free/instant);
 * premium streams ElevenLabs audio from /api/tts. `premiumAvailable` comes from
 * the server (ELEVENLABS_API_KEY present). The chosen mode is remembered in
 * localStorage so a user's pick sticks across reloads.
 */
/**
 * Resolve the browser's TTS voices, waiting briefly for the async
 * `voiceschanged` event when the list isn't populated yet (Chrome/Brave load
 * voices lazily). Resolves to [] if none ever arrive — which on Linux/Brave
 * means no speech engine is installed, so native voice can't make sound.
 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return resolve([]);
    const now = window.speechSynthesis.getVoices();
    if (now.length) return resolve(now);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    // Cap the wait — if no engine exists, voiceschanged never fires.
    setTimeout(done, 1200);
  });
}

export function useSpeech(premiumAvailable: boolean) {
  const [mode, setMode] = useState<VoiceMode>("off");
  // Which ElevenLabs model premium speaks with. Remembered like the mode so a
  // pick sticks across reloads. The /api/tts route allow-lists this server-side.
  const [ttsModel, setTtsModelState] = useState<TtsModelId>(DEFAULT_TTS_MODEL);
  const [speaking, setSpeaking] = useState(false);
  // Which message is currently speaking (its id), so each reply's play/stop
  // button is independent — a single global boolean made every button show ⏹
  // and clicking one could replay another. null = nothing (or anonymous) playing.
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Every speak()/stop() bumps this. An in-flight request checks it after each
  // await and bails if a newer call has superseded it — so two quick clicks (or
  // clicking an old reply just as a new one auto-speaks) can never overlap.
  const genRef = useRef(0);
  // Lets stop() abort the in-flight /api/tts fetch, not just already-playing audio.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("staticcling_voice_mode") as VoiceMode | null;
    // Don't restore "premium" if the server no longer offers it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "native" || (saved === "premium" && premiumAvailable)) setMode(saved);
  }, [premiumAvailable]);

  useEffect(() => {
    const saved = localStorage.getItem("staticcling_tts_model");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved && isTtsModel(saved)) setTtsModelState(saved);
  }, []);

  const setVoiceMode = useCallback((m: VoiceMode) => {
    setMode(m);
    localStorage.setItem("staticcling_voice_mode", m);
  }, []);

  const setTtsModel = useCallback((m: TtsModelId) => {
    setTtsModelState(m);
    localStorage.setItem("staticcling_tts_model", m);
  }, []);

  const stop = useCallback(() => {
    genRef.current++; // invalidate any in-flight speak() so it won't start playing
    abortRef.current?.abort();
    abortRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setSpeaking(false);
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    async (text: string, forceMode?: Exclude<VoiceMode, "off">, id?: string) => {
      const useMode = forceMode ?? mode;
      const clean = text.trim();
      if (!clean || useMode === "off") return;
      stop();
      const myGen = genRef.current; // this call's generation; stop() just bumped it
      setError(null);
      setSpeaking(true);
      setSpeakingId(id ?? null);

      if (useMode === "premium" && premiumAvailable) {
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: clean, model: ttsModel }),
            signal: controller.signal,
          });
          // A newer speak()/stop() superseded us while the request was in flight.
          if (genRef.current !== myGen) return;
          if (!res.ok) {
            // Surface the real reason instead of silently falling back to
            // native (which on Brave/Linux has no voice and then shows the
            // misleading "switch to Premium" message — while you're already on
            // Premium). The route returns { error, detail } JSON on failure.
            const info = (await res.json().catch(() => null)) as
              | { error?: string; detail?: string }
              | null;
            const reason =
              info?.detail?.trim() || info?.error?.trim() || `HTTP ${res.status}`;
            setSpeaking(false);
            setSpeakingId(null);
            setError(`Premium voice (ElevenLabs) failed: ${reason}`);
            return;
          }
          const blob = await res.blob();
          // Re-check after the second await — a click during download supersedes us.
          if (genRef.current !== myGen) return;
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            setSpeaking(false);
            setSpeakingId(null);
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            setSpeaking(false);
            setSpeakingId(null);
          };
          try {
            await audio.play();
          } catch {
            // play() was interrupted — typically because stop() called pause()
            // while the audio was still buffering. That's expected; bail quietly.
            return;
          }
          // Won the play/pause race: if a stop() landed during buffering, play()
          // can still resolve and start audio that nothing holds a ref to (the
          // "can't turn it off, have to wait it out" bug). Re-pause immediately.
          if (genRef.current !== myGen) {
            audio.pause();
            URL.revokeObjectURL(url);
            return;
          }
          return;
        } catch {
          // Aborted by a newer speak()/stop() — silent, the new call owns playback.
          if (genRef.current !== myGen) return;
          // A true network exception (offline, blocked) — not an API error.
          setSpeaking(false);
          setSpeakingId(null);
          setError("Premium voice couldn’t be reached — check your connection and try again.");
          return;
        }
      }

      // Native path.
      if (typeof window === "undefined" || !window.speechSynthesis) {
        setSpeaking(false);
        setError("This browser has no speech support.");
        return;
      }
      const voices = await loadVoices();
      if (voices.length === 0) {
        // No engine (common on Linux/Brave). Don't fail silently — tell them.
        setSpeaking(false);
        setError(
          premiumAvailable
            ? "No system voice found — switch the voice toggle to Premium (✨) to hear replies."
            : "No system voice is installed in this browser, so native voice is silent here. Premium voice (ElevenLabs) plays real audio and works everywhere — ask to enable it.",
        );
        return;
      }
      const u = new SpeechSynthesisUtterance(clean);
      const lang = typeof navigator !== "undefined" ? navigator.language : "en-US";
      u.voice =
        voices.find((v) => v.lang === lang) ??
        voices.find((v) => v.lang?.startsWith(lang.slice(0, 2))) ??
        voices[0];
      u.onend = () => {
        setSpeaking(false);
        setSpeakingId(null);
      };
      u.onerror = () => {
        setSpeaking(false);
        setSpeakingId(null);
      };
      window.speechSynthesis.speak(u);
    },
    [mode, premiumAvailable, stop, ttsModel],
  );

  useEffect(() => () => stop(), [stop]);

  return { mode, setVoiceMode, ttsModel, setTtsModel, speak, stop, speaking, speakingId, error, clearError: () => setError(null), premiumAvailable };
}
