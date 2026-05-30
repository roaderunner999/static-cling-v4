/**
 * Client-SAFE room types + constants. No DB / server imports live here, so both
 * the browser bundle (rooms-ui) and the server (rooms.ts, room-bus, room-ai) can
 * import it without dragging Postgres into the client. Keep this file pure.
 */

export type RoomKind = "human" | "claude" | "claudette";

/**
 * Live-only metadata on an AI turn — carried on the broadcast, NOT persisted (so
 * it's a real-time "is Claude actually working" signal, not DB clutter). Drives
 * the thin transparency strip under a room-AI reply.
 */
export type RoomMsgMeta = {
  /** True when the persona actually used web_search this turn (server-confirmed). */
  web?: boolean;
  /** The model id that produced the turn. */
  model?: string;
};

/**
 * A file shared into a room. No object storage yet, so `url` is a `data:` URI
 * (base64) — fine for the playground at the sizes we cap to (images downscaled,
 * other files size-limited). `kind` drives rendering: image → inline thumbnail,
 * file → a download chip.
 */
export type RoomAttachment = {
  name: string;
  mediaType: string;
  kind: "image" | "file";
  url: string;
  size: number;
};

export type RoomMsg = {
  id: string;
  room: string;
  authorId: string | null;
  authorName: string;
  kind: RoomKind;
  body: string;
  attachments?: RoomAttachment[];
  meta?: RoomMsgMeta;
  createdAt: string;
};

/** Per-message attachment caps (shared by client pre-checks + server validation). */
export const ROOM_ATTACH_MAX_FILES = 4;
export const ROOM_ATTACH_MAX_BYTES = 8 * 1024 * 1024; // 8MB per file (images are downscaled first)

export function isImageType(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}

/** Curated starter rooms shown in the lobby. Any slug also works (typed/shared). */
export const SUGGESTED_ROOMS = [
  { slug: "general", label: "General", blurb: "The main hangout" },
  { slug: "porsche", label: "Porsche", blurb: "Enthusiasts — drop pics, talk builds" },
  { slug: "random", label: "Random", blurb: "Anything goes" },
] as const;

/** Room slugs: tame letters/numbers/dashes so they're safe in URLs + the DB. */
export function slugifyRoom(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
