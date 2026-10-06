/** Shared token classes for native reading controls and interactive buttons. */
export const BUTTON_BASE = 'ca-button inline-flex items-center justify-center gap-[8px] min-h-[44px] px-[16px] border rounded-[3px] font-bold uppercase tracking-[0.06em] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ca-primary)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
export const BUTTON_PRIMARY = 'ca-button-primary';
export const BUTTON_SECONDARY = 'bg-transparent text-[var(--ca-text)] border-[var(--ca-border-strong)] hover:bg-[color-mix(in_srgb,var(--ca-primary)_13%,transparent)]';
export function readerButton(variant: 'primary' | 'secondary') {
  // The record header uses these explicit overrides in both renderers.
  return `${BUTTON_BASE.replace('font-bold uppercase tracking-[0.06em]', 'normal-case font-medium tracking-normal')} ${variant === 'primary' ? BUTTON_PRIMARY : BUTTON_SECONDARY}`;
}
