"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The signed-in home — a calm, centered "start chatting" moment (à la a fresh
 * Claude page) instead of a dense dashboard. Eye lands dead-center on the
 * composer. Type and go, or tap a starter to seed the box. Submitting stashes
 * the text in the chat prefill key and opens a fresh chat (/chat?new=1), where
 * the existing chat UI picks it up — no duplicate chat engine here.
 *
 * (The full Dashboard component still exists for when we wire unread/activity
 * indicators; this just replaces it as the default landing.)
 */

const STARTERS = [
  { icon: "✍️", label: "Write", seed: "Help me write " },
  { icon: "🎓", label: "Learn", seed: "Explain " },
  { icon: "</>", label: "Code", seed: "Write code that " },
  { icon: "💡", label: "Brainstorm", seed: "Let's brainstorm ideas for " },
];

export function HomeLauncher({ name }: { name: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const first = name?.trim().split(/\s+/)[0] || "there";

  function go(message: string) {
    const t = message.trim();
    if (!t) return;
    try {
      sessionStorage.setItem("staticcling_chat_prefill", t);
    } catch {
      /* ignore — chat still opens, just without the prefill */
    }
    router.push("/chat?new=1");
  }

  function seed(s: string) {
    setText(s);
    // Focus + drop the cursor at the end so they keep typing the topic.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
      <div className="w-full max-w-2xl">
        <h1 className="mb-6 text-center text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          <span className="bg-gradient-to-r from-violet-500 to-violet-400 bg-clip-text text-transparent">
            ✦
          </span>{" "}
          Back at it, {first}
        </h1>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(text);
          }}
          className="rounded-2xl border border-zinc-300 bg-white p-2 shadow-sm transition focus-within:border-violet-400 focus-within:shadow-[0_0_0_4px_rgba(124,58,237,0.10)] dark:border-zinc-700 dark:bg-zinc-950"
        >
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                go(text);
              }
            }}
            rows={2}
            autoFocus
            placeholder="How can I help you today?"
            className="no-scrollbar max-h-40 w-full resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-zinc-400"
          />
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[11px] text-zinc-400">Enter to send</span>
            <button
              type="submit"
              disabled={!text.trim()}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
            >
              Start chatting →
            </button>
          </div>
        </form>

        {/* Starters */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {STARTERS.map((s) => (
            <button
              key={s.label}
              onClick={() => seed(s.seed)}
              className="group flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition-all duration-150 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 active:scale-95 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-violet-500/50 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
            >
              <span className="font-mono text-xs opacity-80 transition-transform group-hover:scale-110">
                {s.icon}
              </span>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
