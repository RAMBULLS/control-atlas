import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { twMerge } from 'tailwind-merge';
import { BUTTON_BASE, BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../lib/buttonStyles';

export type ButtonVariant = 'primary' | 'secondary' | 'secondary-quiet' | 'destructive' | 'editorial';

/**
 * Orbital button contract. Variant classes stay token-driven (see
 * styles/components.css .ca-button-primary and styles/tokens.css). CVA replaces
 * the previous hand-rolled string map so variants are type-safe and composable;
 * twMerge resolves any caller overrides without duplicate utilities.
 */
const button = cva(
  BUTTON_BASE,
  {
    variants: {
      variant: {
        primary: BUTTON_PRIMARY,
        secondary: BUTTON_SECONDARY,
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

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button className={buttonClassName(variant, className)} {...props} />
  );
}

interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
}

/** For external/navigational links that need button styling — an <a>, never a <button>, so it keeps native link semantics (open-in-new-tab, middle-click, screen-reader "link" role). */
export function ButtonLink({ variant = 'primary', className = '', ...props }: ButtonLinkProps) {
  return (
    <a className={buttonClassName(variant, className)} {...props} />
  );
}
