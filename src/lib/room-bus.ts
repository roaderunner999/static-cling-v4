/**
 * In-process realtime bus for the self-hosted group chat (the "rooms" feature).
 *
 * Why in-process: the app runs as a SINGLE Node process (systemd `npm run
 * start`), so a plain in-memory pub/sub fans out new messages and presence to
 * every connected SSE client with ZERO external infrastructure and zero
 * per-minute cost — the whole point vs LiveKit Cloud. Postgres holds the durable
 * history (backfill on join); this bus only carries the live "since you
 * connected" stream. (If we ever run multiple instances, swap this for Postgres
 * LISTEN/NOTIFY or Redis behind the same interface.)
 *
 * Stored on globalThis so Next's dev hot-reload doesn't spawn a second bus and
 * split subscribers across two instances.
 */

import type { RoomMsg } from "@/lib/rooms-shared";

export type RoomEvent =
  | { type: "message"; message: RoomMsg }
  | { type: "presence"; room: string; users: { id: string; name: string }[] };

type Subscriber = {
  room: string;
  connId: string;
  userId: string;
  name: string;
  send: (e: RoomEvent) => void;
};

type Bus = {
  // room -> connId -> subscriber
  rooms: Map<string, Map<string, Subscriber>>;
};

const g = globalThis as unknown as { __roomBus?: Bus };
const bus: Bus = (g.__roomBus ??= { rooms: new Map() });

function roomSubs(room: string): Map<string, Subscriber> {
  let m = bus.rooms.get(room);
  if (!m) {
    m = new Map();
    bus.rooms.set(room, m);
  }
  return m;
}

/** Distinct users currently connected to a room (one user, many tabs = once). */
function presence(room: string): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const s of roomSubs(room).values()) seen.set(s.userId, s.name);
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

function broadcast(room: string, e: RoomEvent) {
  for (const s of roomSubs(room).values()) {
    try {
      s.send(e);
    } catch {
      /* a dead connection is cleaned up on its own close */
    }
  }
}

/** A new message landed (human or AI) — fan it out to everyone in the room. */
export function publishMessage(message: Extract<RoomEvent, { type: "message" }>["message"]) {
  broadcast(message.room, { type: "message", message });
}

/** Register an SSE client. Returns an unsubscribe to call on connection close. */
export function subscribe(sub: Subscriber): () => void {
  const subs = roomSubs(sub.room);
  subs.set(sub.connId, sub);
  // Tell the room (and the joiner) who's here now.
  broadcast(sub.room, { type: "presence", room: sub.room, users: presence(sub.room) });
  return () => {
    subs.delete(sub.connId);
    broadcast(sub.room, { type: "presence", room: sub.room, users: presence(sub.room) });
  };
}
