import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'secondary-quiet' | 'destructive' | 'editorial';

/**
 * Orbital button contract. Variant classes stay token-driven (see
 * styles/components.css and styles/tokens.css). Caller utilities retain their
 * existing important layer, so they override the semantic recipe without a
 * general Tailwind conflict engine on every initial record load.
 */
export function buttonClassName(variant: ButtonVariant = 'primary', className = '') {
  return `ca-button ca-button-${variant}${className ? ` ${className}` : ''}`;
}

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
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
