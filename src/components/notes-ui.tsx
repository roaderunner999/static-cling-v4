"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { NoteSummary } from "@/lib/note-queries";
import { createNote, saveNote, deleteNote, loadNote } from "@/lib/note-actions";
import { NoteEditor } from "@/components/note-editor";

type Doc = Record<string, unknown>;

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean)
      ?.slice(0, 60) ?? ""
  );
}

export function NotesUI({
  notes: initialNotes,
  requestedId,
}: {
  notes: NoteSummary[];
  requestedId?: string;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteSummary[]>(initialNotes);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [initialDoc, setInitialDoc] = useState<Doc | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Sidebar collapsed by default for more canvas; choice is remembered.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Zen (distraction-free) mode lives here so it can survive a reload — see the
  // restore effect below. NoteEditor renders the actual full-screen canvas.
  const [zen, setZenState] = useState(false);

  function toggleSidebar(open: boolean) {
    setSidebarOpen(open);
    try {
      localStorage.setItem("staticcling_notes_sidebar", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  function setZen(v: boolean) {
    setZenState(v);
    try {
      localStorage.setItem("staticcling_notes_zen", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  // On mount: restore the remembered sidebar, then resume where you left off —
  // reopen the last note worked on (falls back to the most recent) so you don't
  // land on a blank "go find your note" screen. If the user left in Zen, drop
  // straight back into the blank canvas too. (Default for now; a per-user
  // "open to…" setting can override this later.)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarOpen(localStorage.getItem("staticcling_notes_sidebar") === "1");
    } catch {
      /* ignore */
    }
    if (initialNotes.length === 0) return;
    let lastId: string | null = null;
    let wantZen = false;
    try {
      lastId = localStorage.getItem("staticcling_notes_last");
      wantZen = localStorage.getItem("staticcling_notes_zen") === "1";
    } catch {
      /* ignore */
    }
    // An explicit `?id=` from a dashboard link wins over the "resume last" default
    // — otherwise clicking a specific note from the dashboard would always land
    // on the last-opened note instead of the one you actually clicked.
    const explicit = requestedId
      ? initialNotes.find((n) => n.id === requestedId)
      : undefined;
    const target =
      explicit ?? initialNotes.find((n) => n.id === lastId) ?? initialNotes[0];
    void open(target.id).then(() => {
      if (wantZen) setZenState(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember which note was last open, so Zen restore lands on the right one.
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem("staticcling_notes_last", activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  // Latest editor content for the active note, plus the debounce + flush plumbing.
  const content = useRef<{ doc: Doc; text: string }>({ doc: {}, text: "" });
  const titleRef = useRef("");
  const pendingSave = useRef<{ id: string; doc: Doc; text: string; title: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only one save in flight at a time — if a newer save is requested while one
  // is mid-network, mark it pending instead of racing two writes to the same row
  // (the slower one would otherwise land last and silently overwrite the newer
  // doc, which is how an image could vanish after a quick paste-then-Send-to-chat).
  const inFlight = useRef(false);
  const needsAnother = useRef(false);

  async function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) {
      // A save is already running — let it finish; we'll fire one more with the
      // latest `pendingSave.current` when it completes.
      needsAnother.current = true;
      return;
    }
    const s = pendingSave.current;
    if (!s) return;
    pendingSave.current = null;
    inFlight.current = true;
    try {
      const finalTitle = s.title.trim() || firstLine(s.text) || "Untitled";
      await saveNote(s.id, {
        title: finalTitle,
        docJson: JSON.stringify(s.doc),
        plainText: s.text,
      });
      setStatus("saved");
      setNotes((ns) =>
        ns.map((n) =>
          n.id === s.id
            ? {
                ...n,
                title: finalTitle,
                preview: s.text.replace(/\s+/g, " ").slice(0, 100),
                updatedAt: new Date(),
              }
            : n,
        ),
      );
    } catch {
      // Don't fail silently — a rejected save (e.g. an over-limit payload) used
      // to vanish without a trace. Surface it so the user knows the note didn't
      // persist. Re-queue the snapshot (unless a newer edit already queued one)
      // so the next edit retries it.
      if (!pendingSave.current) pendingSave.current = s;
      setStatus("error");
    } finally {
      inFlight.current = false;
      if (needsAnother.current) {
        needsAnother.current = false;
        // Tail-call flush again with whatever is now in pendingSave.current.
        void flush();
      }
    }
  }

  function scheduleSave() {
    if (!activeId) return;
    pendingSave.current = {
      id: activeId,
      doc: content.current.doc,
      text: content.current.text,
      title: titleRef.current,
    };
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  }

  async function open(id: string) {
    if (id === activeId) return;
    await flush(); // persist the outgoing note before switching
    const n = await loadNote(id);
    if (!n) return;
    const cleanTitle = n.title === "Untitled" ? "" : n.title;
    setActiveId(id);
    setTitle(cleanTitle);
    titleRef.current = cleanTitle;
    setInitialDoc(n.doc && Object.keys(n.doc).length ? n.doc : null);
    content.current = { doc: n.doc ?? {}, text: "" };
    setStatus("idle");
  }

  async function create() {
    await flush();
    const { id } = await createNote();
    setNotes((ns) => [
      { id, title: "Untitled", preview: "", updatedAt: new Date() },
      ...ns,
    ]);
    setActiveId(id);
    setTitle("");
    titleRef.current = "";
    setInitialDoc(null);
    content.current = { doc: {}, text: "" };
    setStatus("idle");
  }

  async function remove(id: string) {
    if (id === activeId && timer.current) clearTimeout(timer.current);
    setNotes((ns) => ns.filter((n) => n.id !== id));
    if (id === activeId) {
      pendingSave.current = null;
      setActiveId(null);
      setInitialDoc(null);
      setTitle("");
      setZen(false); // no editor to be zen about anymore
    }
    await deleteNote(id);
  }

  function onEditorChange(doc: Doc, text: string) {
    content.current = { doc, text };
    scheduleSave();
  }

  function onTitleChange(v: string) {
    setTitle(v);
    titleRef.current = v;
    scheduleSave();
  }

  async function sendToChat(
    text: string,
    images: { mediaType: string; data: string }[],
  ) {
    // CRITICAL: persist the latest doc (including a just-pasted image) BEFORE we
    // navigate away. Without this, a pending 700ms autosave timer could race
    // with the navigation — the save still fires from the closure after unmount,
    // but a slower in-flight earlier save can land last and overwrite the new
    // image-bearing doc. (The `inFlight` ref above also guards this, but
    // flushing here makes the contract obvious.)
    try {
      await flush();
    } catch {
      /* save failed — still hand off to chat so the user isn't blocked */
    }

    const t = (text ?? "").trim();
    // Text and images are stashed separately so a large-image quota error never
    // loses the text. Chat reads both on mount.
    try {
      if (t) sessionStorage.setItem("staticcling_chat_prefill", t);
      else sessionStorage.removeItem("staticcling_chat_prefill");
    } catch {
      /* ignore */
    }
    try {
      if (images?.length)
        sessionStorage.setItem("staticcling_chat_prefill_images", JSON.stringify(images));
      else sessionStorage.removeItem("staticcling_chat_prefill_images");
    } catch {
      /* sessionStorage quota (very large images) — text still rides */
    }
    router.push("/chat");
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Sidebar (collapsible) */}
      {sidebarOpen ? (
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            Notes
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
          onClick={create}
          className="mx-3 mb-2 mt-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          + New note
        </button>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {notes.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-400">No notes yet.</p>
          ) : (
            notes.map((n) => (
              <div
                key={n.id}
                className={`group flex items-start gap-1 rounded-md px-2 py-2 text-sm ${
                  n.id === activeId
                    ? "bg-zinc-100 dark:bg-zinc-900"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                }`}
              >
                <button onClick={() => open(n.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate font-medium">{n.title || "Untitled"}</div>
                  {n.preview && (
                    <div className="truncate text-xs text-zinc-400">{n.preview}</div>
                  )}
                </button>
                <button
                  onClick={() => remove(n.id)}
                  className="opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                  title="Delete note"
                  aria-label="Delete note"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </nav>
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

      {/* Editor */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {activeId ? (
          <>
            <div className="flex items-center gap-3 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
              <input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Untitled"
                className="min-w-0 flex-1 bg-transparent text-lg font-semibold tracking-tight outline-none placeholder:text-zinc-400"
              />
              <span
                className={`shrink-0 font-mono text-xs ${
                  status === "error" ? "text-red-500" : "text-zinc-400"
                }`}
              >
                {status === "saving"
                  ? "Saving…"
                  : status === "saved"
                    ? "Saved"
                    : status === "error"
                      ? "Save failed — retry by editing"
                      : ""}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <NoteEditor
                key={activeId}
                initialContent={initialDoc}
                onChange={onEditorChange}
                onSendToChat={sendToChat}
                onNewNote={create}
                zen={zen}
                onZenChange={setZen}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Notes
            </h1>
            <p className="max-w-xs text-sm text-zinc-500">
              A rich editor for your thinking — formatting, checklists, and a one-click
              hand-off to chat.
            </p>
            <button
              onClick={create}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
            >
              + New note
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
