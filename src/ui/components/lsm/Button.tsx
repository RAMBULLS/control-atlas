import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { twMerge } from 'tailwind-merge';

export type ButtonVariant = 'primary' | 'secondary' | 'secondary-quiet' | 'destructive' | 'editorial';

/**
 * Orbital button contract. Variant classes stay token-driven (see
 * styles/components.css .ca-button-primary and styles/tokens.css). CVA replaces
 * the previous hand-rolled string map so variants are type-safe and composable;
 * twMerge resolves any caller overrides without duplicate utilities.
 */
const button = cva(
  "inline-flex items-center justify-center gap-[8px] min-h-[44px] px-[16px] border rounded-[3px] font-bold uppercase tracking-[0.06em] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ca-primary)] focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "ca-button-primary",
        secondary: "bg-transparent text-[var(--ca-text)] border-[var(--ca-border-strong)] hover:bg-[color-mix(in_srgb,var(--ca-primary)_13%,transparent)]",
        // Muted twin of `secondary` for de-emphasized actions (e.g. "view source" beside a primary action).
        "secondary-quiet": "bg-transparent text-[var(--ca-text-muted)] border-[color-mix(in_srgb,var(--ca-border-strong)_60%,transparent)] hover:bg-[color-mix(in_srgb,var(--ca-primary)_10%,transparent)] hover:text-[var(--ca-text)]",
        destructive: "bg-[color-mix(in_srgb,var(--ca-danger)_14%,transparent)] text-[var(--ca-danger)] border-[color-mix(in_srgb,var(--ca-danger)_54%,transparent)] hover:bg-[color-mix(in_srgb,var(--ca-danger)_22%,transparent)]",
        editorial: "bg-[var(--ca-editorial)] text-[var(--ca-surface-deep)] border-[var(--ca-editorial)] hover:bg-[color-mix(in_srgb,var(--ca-editorial)_84%,white)]",
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

export function buttonClassName(variant: ButtonVariant = 'primary', className = '') {
  return twMerge(button({ variant }), className);
}

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  variant?: ButtonVariant;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = 'primary', className = '', ...props }, ref) {
    return (
      <button ref={ref} className={buttonClassName(variant, className)} {...props} />
    );
  }
);

interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
}

/** For external/navigational links that need button styling — an <a>, never a <button>, so it keeps native link semantics (open-in-new-tab, middle-click, screen-reader "link" role). */
export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink({ variant = 'primary', className = '', ...props }, ref) {
    return (
      <a ref={ref} className={buttonClassName(variant, className)} {...props} />
    );
  }
);
