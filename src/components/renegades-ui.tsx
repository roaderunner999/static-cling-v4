"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
  formatChatMessageLinks,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";

/**
 * /renegades — the social room. A lobby to pick or create a room, then a full
 * LiveKit session: presence (who's here), text chat, and mic/cam, all from
 * LiveKit's prebuilt VideoConference (video grid + control bar + chat panel).
 *
 * Deliberate defaults:
 *  - You join with mic AND camera OFF. We never blast someone's webcam into a
 *    room on entry — they flip them on from the control bar when ready.
 *  - A room is just a name; an unguessable name IS a private room. Share the
 *    "meet me in…" link (?room=) and a friend lands straight in it.
 *
 * Not yet (next phase): global "who's online across the app" on the dashboard,
 * a friends list, and a Claude agent that can join a room as a participant.
 */

// A few rooms to make the lobby feel alive instead of a blank text box.
const SUGGESTED = ["lobby", "renegades", "music", "late-night", "code"];

type Joined = { token: string; url: string; room: string };

export function RenegadesUI({
  enabled,
  displayName,
}: {
  enabled: boolean;
  displayName: string;
}) {
  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState<Joined | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // We auto-join on landing, so start in the "joining" state — that renders a
  // small loader instead of the room picker, killing the one-frame picker flash
  // before the connection lands. Cleared on error or Leave so the picker returns.
  const [joining, setJoining] = useState(true);
  // Wraps LiveKit's VideoConference so we can reach its chat toggle in the DOM.
  const conferenceRef = useRef<HTMLDivElement>(null);
  // Guard so we only auto-join once per landing.
  const autoJoined = useRef(false);

  const join = useCallback(
    async (name: string) => {
      const target = name.trim();
      if (!target || connecting) return;
      setConnecting(true);
      setJoining(true);
      setError(null);
      try {
        const res = await fetch("/api/renegades/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room: target }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Couldn’t join the room.");
          setJoining(false); // show the picker (with the error), not the loader
          return;
        }
        setJoined({ token: data.token, url: data.url, room: data.room });
      } catch {
        setError("Network error — try again.");
        setJoining(false);
      } finally {
        setConnecting(false);
      }
    },
    [connecting],
  );

  function leave() {
    setJoined(null);
    setJoining(false); // back to the picker — and don't auto-rejoin
  }

  // Drop straight INTO a room on landing (Walter's flow): auto-join "lobby" — or
  // a shared ?room= link — instead of stopping at the picker. Combined with the
  // chat auto-open below, clicking Renegades lands you right in the conversation.
  // Trade-off: this opens a LiveKit connection on every visit (audio/video off,
  // but still a connection); the self-hosted /rooms is the $0 path if we move the
  // lobby there later. After Leave, the picker returns (we don't re-auto-join).
  useEffect(() => {
    if (autoJoined.current || !enabled) return;
    autoJoined.current = true;
    let target = "lobby";
    try {
      const r = new URLSearchParams(window.location.search).get("room");
      if (r && r.trim()) target = r.trim();
    } catch {
      /* ignore */
    }
    setRoom(target);
    void join(target);
  }, [enabled, join]);

  // Drop straight into chat: LiveKit's VideoConference starts with the Messages
  // panel CLOSED and exposes no prop to change that, so once we're in a room we
  // click its chat toggle once to open the panel — land "ready to chat" (Walter's
  // ask). Polls briefly because the control bar mounts a beat after connect.
  useEffect(() => {
    if (!joined) return;
    const tick = () => {
      const root = conferenceRef.current;
      if (!root) return false;
      const panel = root.querySelector<HTMLElement>(".lk-chat");
      if (panel && getComputedStyle(panel).display !== "none") return true; // already open
      const toggle = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.trim() === "Chat",
      );
      if (toggle) {
        toggle.click();
        return true;
      }
      return false;
    };
    // Try right away (the control bar is often already there), then poll tightly.
    if (tick()) return;
    const id = window.setInterval(() => {
      if (tick()) window.clearInterval(id);
    }, 90);
    const stop = window.setTimeout(() => window.clearInterval(id), 4000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [joined]);

  // --- Not configured: honest setup panel (same pattern as the other drop-ins) ---
  if (!enabled) {
    return (
      <div className="mx-auto mt-16 max-w-md px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Renegades
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          The hangout room — group voice, video, and chat. It lights up once a
          LiveKit project is connected on the server.
        </p>
        <div className="mt-5 rounded-lg border border-zinc-200 p-4 text-left text-sm text-zinc-500 dark:border-zinc-800">
          <p className="font-medium text-zinc-700 dark:text-zinc-300">To enable:</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Make a free project at{" "}
              <span className="font-mono text-xs">cloud.livekit.io</span>
            </li>
            <li>
              Set <span className="font-mono text-xs">LIVEKIT_URL</span>,{" "}
              <span className="font-mono text-xs">LIVEKIT_API_KEY</span>,{" "}
              <span className="font-mono text-xs">LIVEKIT_API_SECRET</span> in{" "}
              <span className="font-mono text-xs">.env</span>
            </li>
            <li>Re-run golive (the keys are preserved across deploys)</li>
          </ol>
        </div>
      </div>
    );
  }

  // --- In a room ---
  if (joined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-lk-theme="default">
        <LiveKitRoom
          token={joined.token}
          serverUrl={joined.url}
          // Join muted & camera-off; the control bar lets you go live when ready.
          audio={false}
          video={false}
          connect
          onDisconnected={leave}
          onError={(e) => setError(e.message)}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* RoomBar + its presence/copy-link hooks MUST render INSIDE LiveKitRoom —
              they read the room context. Outside it, useParticipants/useRoomContext
              throw "No room provided" and crash the page. */}
          <RoomBar room={joined.room} onLeave={leave} />
          <div ref={conferenceRef} className="min-h-0 flex-1">
            <VideoConference chatMessageFormatter={formatChatMessageLinks} />
          </div>
        </LiveKitRoom>
      </div>
    );
  }

  // --- Joining (auto-join in flight) — a calm loader instead of a picker flash ---
  if (joining && !error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span
          className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500"
          aria-hidden
        />
        <p className="text-sm text-zinc-500">
          Joining <span className="font-medium text-violet-600 dark:text-violet-400">#{room || "lobby"}</span>…
        </p>
      </div>
    );
  }

  // --- Lobby ---
  return (
    <div className="mx-auto w-full max-w-lg px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Renegades
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Hop into a room to talk, video, and chat — live. Hey {displayName.split(" ")[0]}, who&rsquo;s
        around?
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          join(room);
        }}
        className="mt-6 flex gap-2"
      >
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="Create or join a room…"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={!room.trim() || connecting}
          className="shrink-0 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-50 transition hover:opacity-90 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {connecting ? "Joining…" : "Join"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-6">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Jump into
        </p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((r) => (
            <button
              key={r}
              onClick={() => join(r)}
              disabled={connecting}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              #{r}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-8 text-xs text-zinc-400">
        Tip: a room with an unguessable name is private — share its link
        (<span className="font-mono">?room=your-name</span>) and only people with
        it can find you. &ldquo;Meet me in our chat&rdquo; ✨
      </p>
    </div>
  );
}

/** Top bar inside a room: name, live participant count, copy-link, and Leave. */
function RoomBar({ room, onLeave }: { room: string; onLeave: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          #{room}
        </span>
        <ParticipantCount />
      </div>
      <div className="flex items-center gap-2">
        <CopyLinkButton room={room} />
        <button
          onClick={onLeave}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700"
        >
          Leave
        </button>
      </div>
    </div>
  );
}

/** Live "N here" — presence, straight from the LiveKit room (must be a child of it). */
function ParticipantCount() {
  const participants = useParticipants();
  const n = participants.length;
  return (
    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
      ● {n} here
    </span>
  );
}

/** Copy the shareable "meet me here" link to this exact room. */
function CopyLinkButton({ room }: { room: string }) {
  // Touch the room context so this only renders inside a live room (and could
  // grow to show connection state later).
  useRoomContext();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        try {
          const url = `${window.location.origin}/renegades?room=${encodeURIComponent(room)}`;
          void navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {copied ? "Copied!" : "Copy invite"}
    </button>
  );
}
