/** One source-text owner per browser document. Enhancement adopts, never copies. */
import { recordIdFromHash } from '../../shared/record-route-identity';
let owner: { recordId: string; element: HTMLElement; adopted: boolean } | undefined;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export function subscribePublisherOwner(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publisherTextAwaitingAdoption() {
  return Boolean(owner && owner.recordId === recordIdFromHash(window.location.hash) && !owner.adopted && owner.element.isConnected);
}
export function publisherReaderOwnsFields(recordId: string) {
  return hasPublisherText(recordId) && owner?.element.dataset.publisherFieldsOwned === 'true';
}

export function installPublisherText(recordId: string, element: HTMLElement) {
  owner = { recordId, element, adopted: false };
  notify();
}

export function hasPublisherText(recordId: string) {
  return owner?.recordId === recordId && owner.element.isConnected;
}

export function adoptPublisherText(recordId: string, host: HTMLElement) {
  if (!owner || owner.recordId !== recordId || !owner.element.isConnected) return false;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  const endpoints = range && owner.element.contains(range.commonAncestorContainer)
    ? { start: range.startContainer, startOffset: range.startOffset, end: range.endContainer, endOffset: range.endOffset } : undefined;
  const focused = owner.element.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const nativeMain = owner.element.closest<HTMLElement>('[data-publisher-reader]');
  if (nativeMain) nativeMain.hidden = true;
  host.append(owner.element);
  if (endpoints && selection) {
    const retained = document.createRange();
    retained.setStart(endpoints.start, endpoints.startOffset);
    retained.setEnd(endpoints.end, endpoints.endOffset);
    selection.removeAllRanges();
    selection.addRange(retained);
  }
  owner.adopted = true;
  notify();
  if (focused) {
    // React reveals its main after this layout effect. Restore only the focus
    // that the move displaced, without stealing a subsequent user choice.
    window.requestAnimationFrame(() => {
      if (focused.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
    });
  }
  return true;
}

export function clearPublisherText(recordId?: string) {
  if (owner && (!recordId || owner.recordId !== recordId)) {
    if (!owner.adopted) {
      const nativeMain = owner.element.closest<HTMLElement>('[data-publisher-reader]');
      if (nativeMain) {
        nativeMain.replaceChildren(); nativeMain.hidden = true;
        nativeMain.closest('[data-static-route]')?.querySelector<HTMLElement>('.page-header')?.removeAttribute('hidden');
      } else owner.element.remove();
    }
    owner = undefined;
    notify();
  }
}

// Routing must retire stale source even after React has claimed the shell or
// failed to enhance. Its bootstrap flag cannot own publisher-text lifecycle.
export function retireStalePublisherText() {
  clearPublisherText(recordIdFromHash(window.location.hash) || undefined);
}
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', retireStalePublisherText);
  window.addEventListener('popstate', retireStalePublisherText);
}
