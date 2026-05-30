/**
 * Helpers shared by the content-search server actions (notes + chats). Kept
 * framework-free so both "use server" action files can import them.
 */

/**
 * Escape a user string for a SQL LIKE/ILIKE pattern. `\`, `%`, and `_` are
 * special; we backslash-escape them (Postgres LIKE's default escape char) so a
 * literal "100%" search doesn't turn into a wildcard.
 */
export function likePattern(needle: string): string {
  const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

/**
 * A short, readable window of `text` centered on the first case-insensitive
 * occurrence of `needle`, with ellipses where it's clipped — the "…where it
 * matched" line under a search result. Falls back to the head of the text if
 * the needle isn't present (shouldn't happen after an ILIKE filter).
 */
export function snippetAround(text: string, needle: string, radius = 40): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const idx = clean.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return clean.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(clean.length, idx + needle.length + radius);
  return `${start > 0 ? "… " : ""}${clean.slice(start, end)}${end < clean.length ? " …" : ""}`;
}
