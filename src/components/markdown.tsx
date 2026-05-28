"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders an assistant message as Markdown. The key behavior (the thing that
 * fixes "code just scrolls forever"): fenced code blocks render as a contained,
 * scrollable card with Copy + Download — like claude.ai's artifacts — so a long
 * snippet stays in its own box instead of stretching the whole chat.
 *
 * `pre` is passed through so our block renders without a wrapping <pre>; `code`
 * branches on the language class to tell block code from inline code.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className || "");
            const text = String(children).replace(/\n$/, "");
            if (match || text.includes("\n")) {
              return <CodeCard lang={match?.[1] ?? ""} code={text} />;
            }
            return <code className="md-inline-code">{children}</code>;
          },
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

const EXT: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  tsx: "tsx",
  jsx: "jsx",
  python: "py",
  bash: "sh",
  shell: "sh",
  sql: "sql",
  json: "json",
  html: "html",
  css: "css",
  go: "go",
  rust: "rs",
  java: "java",
};

function CodeCard({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const download = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snippet.${EXT[lang] ?? "txt"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100 px-3 py-1 dark:border-zinc-800 dark:bg-zinc-800/60">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          {lang || "code"}
        </span>
        <div className="flex items-center gap-3 text-[11px]">
          <button onClick={copy} className="text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100">
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button onClick={download} className="text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100">
            Download
          </button>
        </div>
      </div>
      <pre className="max-h-[440px] overflow-auto bg-zinc-50 p-3 dark:bg-zinc-950">
        <code className="font-mono text-xs leading-relaxed">{code}</code>
      </pre>
    </div>
  );
}
