/**
 * The left-rail label style preference, stored client-side (like the
 * show-theme-toggle-in-header opt-in). Two looks: a small label BOX on hover
 * (default — Walter's pick) or tiny labels UNDER each icon. Changing it from
 * Settings dispatches an event so the already-mounted rail updates live (a
 * same-tab localStorage write fires no native `storage` event).
 */

export const RAIL_LABELS_KEY = "staticcling_rail_labels";
export const RAIL_LABELS_EVENT = "staticcling:rail-labels";

export type RailLabelStyle = "under" | "hover";

export function getRailLabelStyle(): RailLabelStyle {
  if (typeof window === "undefined") return "hover";
  // Default is the hover box (Walter's pick); "under" is the opt-in alternative.
  return localStorage.getItem(RAIL_LABELS_KEY) === "under" ? "under" : "hover";
}

export function setRailLabelStyle(v: RailLabelStyle): void {
  try {
    localStorage.setItem(RAIL_LABELS_KEY, v);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(RAIL_LABELS_EVENT, { detail: v }));
}
