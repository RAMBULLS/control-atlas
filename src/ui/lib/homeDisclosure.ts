/**
 * The Home topic list is a native <details>, so it opens and closes with the
 * keyboard and without JavaScript. This adds what <details> does not do on its
 * own: Escape closes it and returns focus to the trigger, and a click outside
 * it or tabbing past its last link closes it. Used by the static first paint
 * (main.tsx) and by React (HomePage.tsx), so both behave the same.
 */
export function connectHomeDisclosure(details: HTMLDetailsElement): () => void {
  const summary = details.querySelector("summary");
  const close = () => {
    details.open = false;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !details.open) return;
    event.stopPropagation();
    close();
    summary?.focus();
  };
  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (details.open && next && !details.contains(next)) close();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (details.open && !details.contains(event.target as Node)) close();
  };
  details.addEventListener("keydown", onKeyDown);
  details.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", onPointerDown);
  return () => {
    details.removeEventListener("keydown", onKeyDown);
    details.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("pointerdown", onPointerDown);
  };
}
