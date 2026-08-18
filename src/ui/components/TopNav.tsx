import { useEffect, useRef, useState } from "react";
import { IconDots, IconMenu2, IconSearch, IconX } from "@tabler/icons-react";
import { Button } from "./lsm";
import { AppLink } from "./AppLink";

import { BrandFlourish, BrandMark } from "./BrandLockup";
import {
  activeNavForState,
  MOBILE_NAV_SECTIONS,
  OVERFLOW_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
} from "../lib/navigation";

import type { ViewState } from "../lib/viewState";
import { CLOSE_OVERLAYS_EVENT } from "../../shared/navigation-events";

type TopNavProps = {
  viewState: ViewState;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>, reset?: boolean) => void;
  onOpenSearch: () => void;
};

function useMediaMatch(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function TopNav(props: TopNavProps) {
  const {
    viewState,
    onNavigate,
    onOpenSearch,
  } = props;

  const activeView = activeNavForState(viewState);
  // Kept in sync with styles/orbital.css's desktop/mobile contract. Primary
  // product navigation remains visible at ordinary desktop widths.
  // see that rule's comment for the width budget this threshold is based on.
  // Six task destinations plus Search require more room than the former
  // three-link header. Switch before controls compete at tablet widths.
  const compactHeader = useMediaMatch("(max-width: 1199px)");
  const compactNavigation = compactHeader;
  const [navigationMenuOpen, setNavigationMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const mobileMenuToggleRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  // One persistent header on every route, Home included: global navigation is
  // never hidden.
  useEffect(() => {
    const header = headerRef.current;
    const root = document.documentElement;
    if (!header) return;

    let lastHeight = 0;
    const publishHeaderHeight = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      if (height !== lastHeight) {
        lastHeight = height;
        root.style.setProperty("--ca-header-height", `${height}px`);
      }
    };

    publishHeaderHeight();
    const observer = new ResizeObserver(publishHeaderHeight);
    observer.observe(header);
    window.addEventListener("resize", publishHeaderHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publishHeaderHeight);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setNavigationMenuOpen(false);
    window.addEventListener(CLOSE_OVERLAYS_EVENT, closeMenu);
    return () => window.removeEventListener(CLOSE_OVERLAYS_EVENT, closeMenu);
  }, []);

  useEffect(() => {
    if (!navigationMenuOpen) return;

    const priorOverflow = document.body.style.overflow;
    if (compactNavigation) document.body.style.overflow = "hidden";
    const sheet = mobileMenuRef.current;
    const firstLink = sheet?.querySelector<HTMLAnchorElement>("nav a[href]");
    window.requestAnimationFrame(() => firstLink?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setNavigationMenuOpen(false);
        window.requestAnimationFrame(() => mobileMenuToggleRef.current?.focus());
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      if (compactNavigation) document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [compactNavigation, navigationMenuOpen]);

  const menuId = compactNavigation ? "mobile-nav-sheet" : "overflow-nav-menu";

  return (
    <header className="site-header" ref={headerRef}>
      <AppLink
        aria-label="Control Atlas — home"
        className="brand"
        onNavigate={onNavigate}
        view="home"
      >
        <BrandMark />
        <span className="brand-lockup">
          <span className="brand-name">Control Atlas</span>
          <BrandFlourish />
        </span>
      </AppLink>

      {!compactNavigation ? (
        <nav aria-label="Primary navigation" className="primary-nav ml-[16px] self-end mb-[-1px]">
          <div className="border-b-0 h-full gap-[2px]">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <AppLink
                aria-current={activeView === item.view ? "page" : undefined}
                className={activeView === item.view ? "nav-active" : undefined}
                key={item.view}
                onNavigate={onNavigate}
                patch={item.patch}
                view={item.view}
              >
                {item.label}
              </AppLink>
            ))}
          </div>
        </nav>
      ) : null}

      <div className="header-actions">
        <div className="header-search-trigger-wrap">
          <Button
            aria-label="Open search"
            variant="secondary"
            className="!min-h-[36px] !border-transparent hover:!border-[var(--ca-border-strong)] header-search-trigger"
            onClick={onOpenSearch}
          >
            <IconSearch aria-hidden="true" size={16} stroke={2} />
            <span>Search</span>
          </Button>
        </div>
        <button
          aria-controls={menuId}
          aria-expanded={navigationMenuOpen}
          aria-label={navigationMenuOpen
            ? compactNavigation
              ? "Close navigation menu"
              : "Close more pages"
            : compactNavigation
              ? "Open navigation menu"
              : "Open more pages"}
          className={compactNavigation
            ? "navigation-menu-toggle mobile-nav-toggle"
            : "navigation-menu-toggle overflow-nav-toggle"}
          onClick={() => setNavigationMenuOpen((current) => !current)}
          ref={mobileMenuToggleRef}
          type="button"
        >
          {navigationMenuOpen ? (
            <IconX aria-hidden="true" size={20} stroke={1.8} />
          ) : compactNavigation ? (
            <IconMenu2 aria-hidden="true" size={20} stroke={1.8} />
          ) : (
            <IconDots aria-hidden="true" size={20} stroke={1.8} />
          )}
        </button>
      </div>

      {navigationMenuOpen ? (
        <div
          className={compactNavigation ? "mobile-nav-sheet" : "overflow-nav-menu"}
          id={menuId}
          ref={mobileMenuRef}
        >
          {compactNavigation ? (
            <nav aria-label="Primary navigation (mobile)">
              {MOBILE_NAV_SECTIONS.map((section) => (
                <div className="mobile-nav-sheet-group" key={section.label}>
                  <span className="mobile-nav-sheet-group-label">
                    {section.label}
                  </span>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <AppLink
                        aria-current={activeView === item.view ? "page" : undefined}
                        className={activeView === item.view ? "active" : ""}
                        key={item.label}
                        onClick={() => setNavigationMenuOpen(false)}
                        onNavigate={onNavigate}
                        patch={item.patch}
                        view={item.view}
                      >
                        <Icon aria-hidden="true" size={18} stroke={1.8} />
                        <span>{item.label}</span>
                      </AppLink>
                    );
                  })}
                </div>
              ))}
            </nav>
          ) : (
            <nav aria-label="More pages">
              {OVERFLOW_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <AppLink
                    aria-current={activeView === item.view ? "page" : undefined}
                    className={activeView === item.view ? "active" : ""}
                    key={item.label}
                    onClick={() => setNavigationMenuOpen(false)}
                    onNavigate={onNavigate}
                    patch={item.patch}
                    view={item.view}
                  >
                    <Icon aria-hidden="true" size={18} stroke={1.8} />
                    <span>{item.label}</span>
                  </AppLink>
                );
              })}
            </nav>
          )}
        </div>
      ) : null}
    </header>
  );
}
