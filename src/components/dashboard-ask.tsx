"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDictation } from "@/lib/use-voice";

/**
 * A slim "ask anything" bar for the top of the dashboard — the dashboard's nod
 * to chat without a big composer dominating the screen (you're signed in; you
 * know chat exists). Type or tap the mic to speak; submitting opens a fresh chat
 * with your words prefilled. "Responds to your voice" = the dictation hook.
 */
export function DashboardAsk() {
  const router = useRouter();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dictation = useDictation();

  function go(message: string) {
    const t = message.trim();
    if (!t) return;
    if (dictation.listening) dictation.stop(); // tear the mic down on submit
    try {
      sessionStorage.setItem("staticcling_chat_prefill", t);
    } catch {
      /* ignore */
    }
    router.push("/chat?new=1");
  }

  function mic() {
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    dictation.start((phrase) => setText((t) => (t ? `${t} ${phrase}` : phrase)));
    inputRef.current?.focus();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(text);
      }}
      className="flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-2 py-1.5 shadow-sm transition focus-within:border-violet-400 focus-within:shadow-[0_0_0_4px_rgba(124,58,237,0.08)] dark:border-zinc-700 dark:bg-zinc-950"
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask Claude anything…"
        className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-400"
      />
      {dictation.supported && (
        <button
          type="button"
          onClick={mic}
          title={dictation.listening ? "Stop" : "Speak"}
          aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
          className={`rounded-lg border px-2.5 py-1.5 text-sm transition ${
            dictation.listening
              ? "animate-pulse border-red-400 bg-red-50 dark:border-red-500 dark:bg-red-950"
              : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          }`}
        >
          {dictation.listening ? "🔴" : "🎤"}
        </button>
      )}
      <button
        type="submit"
        disabled={!text.trim()}
        className="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
      >
        Ask →
      </button>
    </form>
  );
}
