/**
 * Orbital route-orientation contract (P2-06).
 *
 * Centralizes five route-transition concerns:
 * 1. Scroll-to-top on push navigation
 * 2. Scroll save/restore for back/forward navigation
 * 3. Heading focus after push navigation
 * 4. Document title (handled by routeDocumentTitle — not duplicated here)
 * 5. Transition overlay (handled by navigation-events.ts — not duplicated here)
 */

const scrollPositions = new Map<number, number>();

export function getNavigationKey(): number {
  const key = window.history.state?.caNavKey;
  return typeof key === "number" ? key : 0;
}

export function nextNavigationKey(): number {
  return getNavigationKey() + 1;
}

export function saveScrollPosition(): void {
  scrollPositions.set(getNavigationKey(), window.scrollY);
}

export function restoreScrollPosition(): boolean {
  const key = getNavigationKey();
  const y = scrollPositions.get(key);
  if (y != null) {
    window.requestAnimationFrame(() =>
      window.scrollTo({ top: y, behavior: "auto" }),
    );
    return true;
  }
  return false;
}

export function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function focusRouteHeading(): number {
  return window.requestAnimationFrame(() => {
    const heading = [...document.querySelectorAll<HTMLElement>(
      "#workspace h1, [data-static-route]:not([hidden]) h1, [data-static-search] h1",
    )].find(element => element.getClientRects().length > 0 &&
      window.getComputedStyle(element).visibility !== "hidden");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    } else {
      document.getElementById("workspace")?.focus({ preventScroll: true });
    }
  });
}
