"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { aiTransform, type AiAction } from "@/lib/note-actions";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Image from "@tiptap/extension-image";

type ChatImage = { mediaType: string; data: string };

/**
 * Downscale a pasted/dropped image before embedding it base64 in the note.
 * Big photos otherwise bloat the doc, slow every autosave (the whole image is
 * re-sent on each save), and can blow past request-size limits. Small images
 * are kept byte-for-byte; large ones are re-encoded to a max dimension as JPEG.
 * Pure client-side (canvas); falls back to the original bytes on any error.
 */
async function fileToEmbedSrc(file: File, maxDim = 1920): Promise<string> {
  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  // Already small — keep the original bytes for best fidelity.
  if (file.size < 500_000) return dataUrl;
  try {
    const img = document.createElement("img");
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("decode failed"));
      img.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", 0.85);
    return out.length < dataUrl.length ? out : dataUrl; // only if it actually helped
  } catch {
    return dataUrl;
  }
}

/* ---- "AI glow": a pulsing violet decoration over the text Claude is working
   on, while an inline AI action runs. Driven by a tiny ProseMirror plugin so it
   never touches the document — set a range via meta to glow, {clear:true} to
   stop. Styled by `.ai-glow` in globals.css. ---- */
const aiGlowKey = new PluginKey("aiGlow");

/**
 * Glow as a Tiptap Extension so the plugin is in the editor's plugin list from
 * frame 0 — registering it dynamically via `registerPlugin` later reconfigures
 * an already-loaded editor and was causing a one-frame content blink that
 * looked like images "wanting to be there" and then vanishing.
 */
const AiGlowExtension = Extension.create({
  name: "aiGlow",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiGlowKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(aiGlowKey) as
              | { from?: number; to?: number; clear?: boolean }
              | undefined;
            if (meta?.clear) return DecorationSet.empty;
            if (meta && typeof meta.from === "number" && typeof meta.to === "number") {
              if (meta.to <= meta.from) return DecorationSet.empty;
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.from, meta.to, { class: "ai-glow" }),
              ]);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return aiGlowKey.getState(state);
          },
        },
      }),
    ];
  },
});

function setGlow(editor: Editor, range: { from: number; to: number } | "clear") {
  try {
    const meta = range === "clear" ? { clear: true } : range;
    editor.view.dispatch(editor.state.tr.setMeta(aiGlowKey, meta));
  } catch {
    /* glow is cosmetic — never let it break an AI action */
  }
}

/**
 * The Notes rich-text editor (Tiptap v3). StarterKit already brings headings,
 * bold/italic/underline/strike/code, lists, blockquote, code blocks, links,
 * and undo/redo; we layer on task lists, highlight, text alignment, color,
 * sub/superscript, smart typography, and a placeholder.
 *
 * Zen mode (ported from the legacy notepad): when `zen` is on we render an
 * edge-to-edge, chrome-free writing canvas as a full-screen overlay. The only
 * persistent UI is a tiny "Static · Cling" corner label that slowly fades to
 * nothing (total blank for meditation) and returns on mouse movement; clicking
 * it pops out a menu of the most-used note commands. A draggable formatting bar
 * can be summoned and anchored anywhere on the page. Esc exits; Ctrl+Shift+M
 * toggles. The parent (NotesUI) owns the `zen` flag so it survives reloads.
 */
export function NoteEditor({
  initialContent,
  onChange,
  onSendToChat,
  onNewNote,
  zen = false,
  onZenChange,
}: {
  initialContent: Record<string, unknown> | null;
  onChange: (doc: Record<string, unknown>, text: string) => void;
  onSendToChat: (text: string, images: ChatImage[]) => void;
  onNewNote?: () => void;
  zen?: boolean;
  onZenChange?: (v: boolean) => void;
}) {
  const router = useRouter();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Start writing…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Typography,
      TextStyle,
      Color,
      Subscript,
      Superscript,
      Image.configure({ inline: false, allowBase64: true }),
      AiGlowExtension,
    ],
    content: initialContent ?? "",
    editorProps: { attributes: { class: "tiptap min-h-[60vh]" } },
    onUpdate: ({ editor }) =>
      onChangeRef.current(editor.getJSON() as Record<string, unknown>, editor.getText()),
  });

  // Tiptap v3 doesn't re-render React on every transaction by default; subscribe
  // so the toolbar's active states stay in sync with the selection.
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => bump();
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  /* ---------------------------------------------------------------- Zen UI */
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [cornerVisible, setCornerVisible] = useState(true);
  const [toolPos, setToolPos] = useState({ x: 16, y: 64 });
  const menuOpenRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  function scheduleCornerHide() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (!menuOpenRef.current) setCornerVisible(false);
    }, 3500);
  }
  function revealCorner() {
    setCornerVisible(true); // React bails out if already true (no extra renders)
    scheduleCornerHide();
  }

  // Entering Zen: show the corner, let it drift away, and focus the canvas.
  useEffect(() => {
    if (!zen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCornerVisible(true);
    scheduleCornerHide();
    const t = setTimeout(() => editor?.commands.focus("end"), 80);
    return () => {
      clearTimeout(t);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [zen, editor]);

  // Keyboard: Ctrl/Cmd+Shift+M toggles Zen; Esc closes the menu or exits Zen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        onZenChange?.(!zen);
        return;
      }
      if (!zen) return;
      if (e.key === "Escape") {
        if (menuOpenRef.current) setMenuOpen(false);
        else onZenChange?.(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zen, onZenChange]);

  function toggleTheme() {
    const d = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", d);
    try {
      localStorage.setItem("theme", d ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }

  // Drag the floating formatting widget around the page.
  function onToolDragStart(e: React.PointerEvent) {
    dragOffset.current = { x: e.clientX - toolPos.x, y: e.clientY - toolPos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onToolDragMove(e: React.PointerEvent) {
    if (!dragOffset.current) return;
    setToolPos({
      x: Math.max(0, e.clientX - dragOffset.current.x),
      y: Math.max(0, e.clientY - dragOffset.current.y),
    });
  }
  function onToolDragEnd() {
    dragOffset.current = null;
  }

  if (!editor) {
    return <div className="p-6 text-sm text-zinc-400">Loading editor…</div>;
  }

  // Send to chat off the LIVE editor: a real text highlight if there is one,
  // otherwise the whole note. (Reading the live editor — not a cached string —
  // is what makes this work even for a note you just opened and didn't edit.)
  // Embedded images ride along too: chat shows them and sends them to Claude's
  // vision, just like a drag-drop/paste attachment.
  function sendCurrentToChat() {
    const collect = (sink: string[]) => (node: PMNode) => {
      if (node.type.name === "image" && typeof node.attrs.src === "string") {
        sink.push(node.attrs.src);
      }
    };

    let text = "";
    const srcs: string[] = [];

    // Try the selection. Clicking an image in ProseMirror makes a NodeSelection
    // with from < to but no text content — so we have to ASK whether the range
    // actually has text, not just whether `to > from`. If the selection didn't
    // give us text, fall through to the whole-note path so the message isn't
    // sent as an image with no caption.
    const { from, to } = editor!.state.selection;
    if (to > from) {
      const selText = editor!.state.doc.textBetween(from, to, "\n");
      if (selText.trim()) {
        text = selText;
        editor!.state.doc.nodesBetween(from, to, collect(srcs));
      }
    }
    if (!text.trim()) {
      text = editor!.getText();
      srcs.length = 0; // drop any selection-only images; take the note's
      editor!.state.doc.descendants(collect(srcs));
    }

    const images = srcs
      .map((u): ChatImage | null => {
        const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(u);
        return m ? { mediaType: m[1], data: m[2] } : null;
      })
      .filter((x): x is ChatImage => !!x && x.mediaType.startsWith("image/"))
      .slice(0, 5);

    onSendToChat(text, images);
  }

  // Drop / paste / pick images → downscale, then embed inline as base64 (persisted
  // in the doc). Downscaling keeps the doc small enough to save reliably and fast.
  async function insertImages(files: FileList | File[]) {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const f of imgs) {
      const src = await fileToEmbedSrc(f);
      editor!.chain().focus().setImage({ src }).run();
    }
  }

  return (
    <div
      className={
        zen
          ? "fixed inset-0 z-50 flex flex-col bg-[var(--background)]"
          : "flex h-full flex-col"
      }
      onMouseMove={zen ? revealCorner : undefined}
    >
      {!zen && (
        <Toolbar
          editor={editor}
          onSendToChat={sendCurrentToChat}
          onPickImage={() => fileRef.current?.click()}
          onEnterZen={() => onZenChange?.(true)}
        />
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) insertImages(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Zen: tiny fading corner trigger + pop-out menu */}
      {zen && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
              revealCorner();
            }}
            title="Menu · Esc to exit Zen"
            className={`zen-corner fixed left-3 top-2.5 z-[60] rounded px-2 py-1 font-mono text-[9px] uppercase tracking-[0.3em] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ${
              cornerVisible || menuOpen
                ? "opacity-60 hover:opacity-100"
                : "pointer-events-none opacity-0"
            }`}
          >
            Static · Cling
          </button>

          {menuOpen && (
            <>
              <button
                className="fixed inset-0 z-[59] cursor-default"
                aria-hidden
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="menu"
                className="fixed left-3 top-10 z-[60] flex w-56 flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white p-1.5 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
              >
                <ZenLabel>Note</ZenLabel>
                <ZenItem
                  onClick={() => {
                    onNewNote?.();
                    setMenuOpen(false);
                  }}
                >
                  ⊕ New note
                </ZenItem>
                <ZenItem
                  onClick={() => {
                    setShowTools((s) => !s);
                    setMenuOpen(false);
                  }}
                >
                  ⚒ {showTools ? "Hide" : "Show"} formatting bar
                </ZenItem>
                <ZenItem
                  onClick={() => {
                    sendCurrentToChat();
                    setMenuOpen(false);
                  }}
                >
                  → Send to chat
                </ZenItem>
                <ZenSep />
                <ZenLabel>Go to</ZenLabel>
                <ZenItem onClick={() => router.push("/chat")}>💬 Chat</ZenItem>
                <ZenItem onClick={() => router.push("/tasks")}>✅ Tasks</ZenItem>
                <ZenSep />
                <ZenLabel>View</ZenLabel>
                <ZenItem onClick={toggleTheme}>☼ / ☾ Toggle light / dark</ZenItem>
                <ZenItem onClick={() => onZenChange?.(false)}>
                  ⊠ Exit Zen
                  <span className="ml-auto font-mono text-[10px] text-zinc-400">Esc</span>
                </ZenItem>
              </div>
            </>
          )}
        </>
      )}

      {/* Zen: draggable formatting widget — the pop-out that anchors anywhere */}
      {zen && showTools && (
        <div
          className="fixed z-[58] max-w-[94vw] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: toolPos.x, top: toolPos.y }}
        >
          <div
            onPointerDown={onToolDragStart}
            onPointerMove={onToolDragMove}
            onPointerUp={onToolDragEnd}
            className="flex cursor-move touch-none items-center justify-between gap-3 border-b border-zinc-200 px-2 py-1 dark:border-zinc-700"
          >
            <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-400">
              ⠿ Tools — drag me
            </span>
            <button
              onClick={() => setShowTools(false)}
              aria-label="Hide tools"
              className="px-1 text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              ×
            </button>
          </div>
          <Toolbar
            editor={editor}
            onSendToChat={sendCurrentToChat}
            onPickImage={() => fileRef.current?.click()}
          />
        </div>
      )}

      <div
        className={zen ? "no-scrollbar flex-1 overflow-y-auto" : "flex-1 overflow-y-auto"}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            insertImages(e.dataTransfer.files);
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            insertImages(files);
          }
        }}
      >
        <div className={zen ? "zen-canvas w-full px-[7vw] py-16" : "w-full px-6 py-6 sm:px-10"}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Toolbar */

function Toolbar({
  editor,
  onSendToChat,
  onPickImage,
  onEnterZen,
}: {
  editor: Editor;
  onSendToChat: () => void;
  onPickImage: () => void;
  onEnterZen?: () => void;
}) {
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <Btn onClick={() => editor.chain().focus().undo().run()} label="Undo">↶</Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} label="Redo">↷</Btn>
      <Sep />
      <Btn
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        label="Heading 1"
      >
        H1
      </Btn>
      <Btn
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Heading 2"
      >
        H2
      </Btn>
      <Btn
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        label="Heading 3"
      >
        H3
      </Btn>
      <Sep />
      <Btn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label="Bold">
        <b>B</b>
      </Btn>
      <Btn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="Italic">
        <i>I</i>
      </Btn>
      <Btn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} label="Underline">
        <u>U</u>
      </Btn>
      <Btn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} label="Strikethrough">
        <s>S</s>
      </Btn>
      <Btn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} label="Inline code">
        {"</>"}
      </Btn>
      <Btn active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()} label="Highlight">
        🖍
      </Btn>
      <label
        className="ml-0.5 flex h-7 cursor-pointer items-center rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title="Text color"
      >
        <span className="text-xs">A</span>
        <input
          type="color"
          className="ml-0.5 h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        />
      </label>
      <Sep />
      <Btn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Bullet list">
        •
      </Btn>
      <Btn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Numbered list">
        1.
      </Btn>
      <Btn active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} label="Checklist">
        ☑
      </Btn>
      <Btn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="Quote">
        ❝
      </Btn>
      <Btn active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} label="Code block">
        {"{ }"}
      </Btn>
      <Btn active={editor.isActive("link")} onClick={setLink} label="Link">
        🔗
      </Btn>
      <Sep />
      <Btn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} label="Align left">
        ⬅
      </Btn>
      <Btn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} label="Align center">
        ⬌
      </Btn>
      <Btn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} label="Align right">
        ➡
      </Btn>
      <Btn active={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()} label="Subscript">
        x₂
      </Btn>
      <Btn active={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()} label="Superscript">
        x²
      </Btn>
      <Btn onClick={onPickImage} label="Insert image (or drag/paste one in)">
        🖼
      </Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} label="Divider">
        ―
      </Btn>
      <Btn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} label="Clear formatting">
        ⌫
      </Btn>

      <div className="ml-auto flex items-center gap-2">
        {onEnterZen && (
          <button
            onClick={onEnterZen}
            title="Zen mode — blank, distraction-free canvas (Ctrl+Shift+M)"
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            ⬚ Zen
          </button>
        )}
        <AiMenu editor={editor} />
        <button
          onClick={onSendToChat}
          title="Send this note's text to chat"
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          ✦ Send to chat
        </button>
      </div>
    </div>
  );
}

const AI_ACTIONS: { action: AiAction; label: string }[] = [
  { action: "improve", label: "Improve writing" },
  { action: "fix", label: "Fix grammar & spelling" },
  { action: "shorten", label: "Make shorter" },
  { action: "lengthen", label: "Make longer" },
  { action: "summarize", label: "Summarize" },
  { action: "continue", label: "Continue writing" },
];

/** ✦ AI dropdown — runs a Claude transform on the selection (or the whole note). */
function AiMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: AiAction) {
    setOpen(false);
    const { from, to } = editor.state.selection;
    const hasSel = to > from;
    const text = hasSel ? editor.state.doc.textBetween(from, to, "\n") : editor.getText();
    if (!text.trim()) return;

    // Glow the worked-on region while Claude thinks (whole note if nothing selected).
    setGlow(editor, {
      from: hasSel ? from : 0,
      to: hasSel ? to : editor.state.doc.content.size,
    });

    setBusy(true);
    try {
      const result = await aiTransform(action, text);
      setGlow(editor, "clear"); // clear before mutating the doc
      if (!result) return;
      const paras = result
        .split(/\n\n+/)
        .map((p) => p.replace(/\n/g, " ").trim())
        .filter(Boolean)
        .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] }));
      if (paras.length === 0) return;

      if (action === "continue") {
        editor.chain().focus().insertContentAt(editor.state.doc.content.size, paras).run();
      } else if (hasSel) {
        editor.chain().focus().insertContentAt({ from, to }, paras).run();
      } else {
        editor.chain().focus().setContent({ type: "doc", content: paras }).run();
      }
    } catch {
      /* surfaced via the busy state clearing; keep the note intact */
    } finally {
      setGlow(editor, "clear"); // also covers the error / empty-result paths
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="AI actions — on your selection, or the whole note"
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {busy ? "✦ Working…" : "✦ AI"}
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden
            tabIndex={-1}
          />
          <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {AI_ACTIONS.map((a) => (
              <button
                key={a.action}
                onClick={() => run(a.action)}
                className="block w-full px-3 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {a.label}
              </button>
            ))}
            <div className="mt-1 border-t border-zinc-100 px-3 pb-1 pt-1.5 text-[10px] text-zinc-400 dark:border-zinc-800">
              Acts on your selection, or the whole note.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Btn({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm transition ${
        active
          ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />;
}

/* -------------------------------------------------------------- Zen menu bits */

function ZenLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-1.5 font-mono text-[9px] uppercase tracking-widest text-zinc-400">
      {children}
    </div>
  );
}

function ZenItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

function ZenSep() {
  return <div className="mx-1.5 my-1 h-px bg-zinc-200 dark:bg-zinc-800" />;
}
