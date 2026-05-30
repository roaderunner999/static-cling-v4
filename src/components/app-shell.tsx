import { SiteHeader } from "@/components/site-header";
import { SideRail } from "@/components/side-rail";

/**
 * The one true app frame — used by every authenticated page so the chrome and
 * scroll behaviour are identical everywhere.
 *
 * Why this exists: pages used to choose their own wrapper. Some scrolled the
 * whole document with a `sticky` header (scrollbar ran the full window height,
 * appearing to start *at the top of the menu*, and the blurred bar could shift
 * when the body scrollbar came and went); others locked the viewport and
 * scrolled an inner pane (scrollbar started *below* the header). Same app,
 * three different places for the scrollbar.
 *
 * Here the header lives OUTSIDE every scroll container, so it can never move,
 * blur-shift, or wiggle — it's a rock. Below it sits a single content region
 * that always owns the scroll, so the scrollbar always begins in exactly the
 * same spot: immediately under the header, on every page. `scrollbar-gutter:
 * stable` reserves the gutter so content doesn't reflow when the bar toggles.
 *
 * New pages get all of this for free — just wrap your content in <AppShell>.
 *
 * @param scroll  Default `true`: the content region owns the page's vertical
 *   scroll. Pass `false` for self-managed full-height apps (Chat, Notes) that
 *   pin their own input/toolbar and scroll their inner panes instead.
 */
export function AppShell({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SiteHeader />
      {/* Desktop: a collapsed icon rail on the left + the content. Mobile: the
          rail hides (top dropdown nav takes over) and content is full width. */}
      <div className="flex min-h-0 flex-1">
        <SideRail />
        <div
          className={
            scroll
              ? "flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]"
              : "flex min-h-0 flex-1 flex-col overflow-hidden"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
