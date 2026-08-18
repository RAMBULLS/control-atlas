import {
  BRAND_ROTATION_INTERVAL_MS,
  BRAND_ROTATION_TRANSITION_MS,
  BRAND_WORDS,
} from './shared/brand-rotation';
import {
  beginRouteTransition,
  completeRouteTransition,
  requestSearchOverlayOpen,
  ROUTE_COMMITTED_EVENT,
  ROUTE_TRANSITION_END_EVENT,
  SEARCH_RESULTS_FOCUS_EVENT,
} from './shared/navigation-events';
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/surfaces.css';
import '../styles/tailwind.css';
import '../styles/orbital.css';

// Anti-framing guard (TRUST-002): GitHub Pages cannot send response headers,
// so frame-ancestors/X-Frame-Options are unavailable. Break out of hostile
// frames before doing any other work; a cross-origin top throws on access,
// in which case hide the document instead.
if (window.top !== null && window.self !== window.top) {
  try {
    window.top.location.replace(window.self.location.href);
  } catch {
    document.documentElement.hidden = true;
  }
}

const rootElement = document.getElementById('root');
const reactRootElement = rootElement?.querySelector<HTMLElement>('[data-react-root]');

if (!rootElement || !reactRootElement) {
  throw new Error('Control Atlas root elements are missing.');
}

let brandRotationInterval = 0;
let brandRotationTransition = 0;
let reactBoot: Promise<boolean> | null = null;
let reactModules: Promise<
  [
    typeof import('react'),
    typeof import('react-dom/client'),
    typeof import('./ui/App'),
  ]
> | null = null;
let brandMotionMedia: MediaQueryList | null = null;

function isPlainPrimaryNavigation(event: Event) {
  if (!(event instanceof MouseEvent)) return false;
  const target = event.currentTarget as HTMLAnchorElement | null;
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    target?.target !== '_blank' &&
    !target?.hasAttribute('download')
  );
}

function isHomeHash() {
  const route = window.location.hash.replace(/^#/, '');
  return route === '' || route === '/' || route.startsWith('/?');
}

function isSearchHash() {
  return window.location.hash.replace(/^#/, '').startsWith('/library');
}

function staticSearchQuery() {
  const hash = window.location.hash.replace(/^#/, '');
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return '';
  return new URLSearchParams(hash.slice(queryIndex + 1)).get('q') || '';
}

type StaticRouteIdentity = {
  eyebrow: string;
  kind: string;
  summary: string;
  title: string;
};

declare global {
  interface Window {
    controlAtlasProgressiveRouteIdentity?: () => StaticRouteIdentity | null;
    controlAtlasSyncFirstPaintShell?: () => void;
  }
}

function progressiveRouteIdentity(): StaticRouteIdentity | null {
  return window.controlAtlasProgressiveRouteIdentity?.() ?? null;
}

function syncStaticRouteShell() {
  const shell = rootElement.querySelector<HTMLElement>('[data-static-route]');
  if (!shell) return;
  const identity = progressiveRouteIdentity();
  if (identity) {
    rootElement.dataset.staticRouteKind = identity.kind;
    const eyebrow = shell.querySelector<HTMLElement>('[data-static-route-eyebrow]');
    const title = shell.querySelector<HTMLElement>('[data-static-route-title]');
    const summary = shell.querySelector<HTMLElement>('[data-static-route-summary]');
    if (eyebrow && eyebrow.textContent !== identity.eyebrow) {
      eyebrow.textContent = identity.eyebrow;
    }
    if (title && title.textContent !== identity.title) {
      title.textContent = identity.title;
    }
    if (summary && summary.textContent !== identity.summary) {
      summary.textContent = identity.summary;
    }
  } else {
    delete rootElement.dataset.staticRouteKind;
  }
  const active =
    (Boolean(identity) || rootElement.dataset.routeHydrated !== 'true') &&
    !isHomeHash() &&
    !isSearchHash() &&
    rootElement.dataset.routeHydrated !== 'true';
  shell.toggleAttribute('hidden', !active);
  if (!active) {
    delete rootElement.dataset.staticRouteActive;
    return;
  }
  rootElement.dataset.staticRouteActive = 'true';
  shell.removeAttribute('aria-hidden');
  shell.removeAttribute('inert');
  shell.setAttribute('role', 'status');
}

function observeRouteHydration() {
  let settleTimer = 0;
  const reactRouteOwnsSurface = (app: HTMLElement) =>
    ['true', 'partial', 'error'].includes(app.dataset.appReady || '');
  const markHydrated = () => {
    const app = reactRootElement.querySelector<HTMLElement>('#app');
    if (!app || !reactRouteOwnsSurface(app)) return false;
    if (
      app.dataset.appReady !== 'error' &&
      app.dataset.view === 'atlas-map' &&
      app.dataset.hasSubject === 'true' &&
      !reactRootElement.querySelector('[data-route-content-ready="true"]')
    ) {
      return false;
    }
    rootElement.dataset.routeHydrated = 'true';
    delete rootElement.dataset.staticRouteActive;
    const shell = rootElement.querySelector<HTMLElement>('[data-static-route]');
    shell?.setAttribute('aria-hidden', 'true');
    shell?.setAttribute('inert', '');
    shell?.removeAttribute('role');
    shell?.setAttribute('hidden', '');
    return true;
  };
  const scheduleHydration = () => {
    const app = reactRootElement.querySelector<HTMLElement>('#app');
    if (!app || !reactRouteOwnsSurface(app)) return;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      if (markHydrated()) observer.disconnect();
    }, 200);
  };
  const observer = new MutationObserver(() => {
    scheduleHydration();
  });
  observer.observe(reactRootElement, {
    attributes: true,
    attributeFilter: ['data-app-ready'],
    childList: true,
    subtree: true,
  });
  scheduleHydration();
  window.setTimeout(() => {
    window.clearTimeout(settleTimer);
    markHydrated();
    observer.disconnect();
  }, 15_000);
}

function stopBrandRotation() {
  window.clearInterval(brandRotationInterval);
  window.clearTimeout(brandRotationTransition);
  brandMotionMedia?.removeEventListener('change', onBrandMotionChange);
  brandMotionMedia = null;
}

function startBrandRotation() {
  const wordElement = rootElement.querySelector<HTMLElement>('[data-brand-word]');
  if (!wordElement) {
    return;
  }

  brandMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  brandMotionMedia.addEventListener('change', onBrandMotionChange);
  if (brandMotionMedia.matches) return;

  let wordIndex = 0;
  brandRotationInterval = window.setInterval(() => {
    wordElement.classList.remove('word-enter');
    wordElement.classList.add('word-exit');
    brandRotationTransition = window.setTimeout(() => {
      wordIndex = (wordIndex + 1) % BRAND_WORDS.length;
      wordElement.textContent = BRAND_WORDS[wordIndex];
      wordElement.classList.remove('word-exit');
      wordElement.classList.add('word-enter');
    }, BRAND_ROTATION_TRANSITION_MS);
  }, BRAND_ROTATION_INTERVAL_MS);
}

function onBrandMotionChange() {
  const wordElement = rootElement.querySelector<HTMLElement>('[data-brand-word]');
  if (!wordElement) return;
  stopBrandRotation();
  wordElement.textContent = BRAND_WORDS[0];
  wordElement.classList.remove('word-exit');
  wordElement.classList.add('word-enter');
  startBrandRotation();
}

function navigateFromStaticHome(target: string) {
  if (!beginRouteTransition("Opening Control Atlas", target)) return;
  if (window.location.hash !== target) {
    window.location.hash = target.slice(1);
  }
  void bootReactApp();
}

function focusSearchResultsWhenReady() {
  let observer: MutationObserver | null = null;
  let timeout = 0;

  const cleanup = () => {
    observer?.disconnect();
    window.removeEventListener(ROUTE_TRANSITION_END_EVENT, focusResults);
    window.clearTimeout(timeout);
  };
  const focusResults = () => {
    const results = reactRootElement.querySelector<HTMLElement>('#library-results');
    if (!results || results.closest('[inert]')) return false;
    results.focus();
    if (document.activeElement !== results) return false;
    cleanup();
    return true;
  };
  if (focusResults()) return;

  observer = new MutationObserver(() => {
    focusResults();
  });
  observer.observe(reactRootElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  window.addEventListener(ROUTE_TRANSITION_END_EVENT, focusResults);
  timeout = window.setTimeout(cleanup, 15_000);
}

function connectStaticSearch() {
  rootElement
    .querySelector<HTMLElement>('[data-static-search-catalog]')
    ?.addEventListener('click', () => navigateFromStaticHome('#/library'));
  rootElement
    .querySelector<HTMLFormElement>('[data-static-search-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = rootElement.querySelector<HTMLInputElement>(
        '[data-static-search-input]',
      );
      const query = input?.value.trim() || '';
      const target = `#/library${query ? `?q=${encodeURIComponent(query)}` : ''}`;
      focusSearchResultsWhenReady();
      navigateFromStaticHome(target);
    });
}

function syncProgressiveShell() {
  const home = isHomeHash();
  const search = isSearchHash();
  rootElement.dataset.reactActive =
    rootElement.dataset.reactShellReady === 'true' ? 'true' : 'false';
  if (rootElement.dataset.progressiveShellReleased === 'true') {
    delete rootElement.dataset.staticRouteActive;
    delete rootElement.dataset.staticRouteKind;
    delete rootElement.dataset.staticRoutePersistent;
    delete rootElement.dataset.staticSearchActive;
    return;
  }
  if (search) {
    rootElement.dataset.staticSearchActive = 'true';
  } else {
    delete rootElement.dataset.staticSearchActive;
  }

  rootElement
    .querySelector<HTMLElement>('[data-static-search]')
    ?.toggleAttribute('hidden', !search);
  syncStaticRouteShell();
  const input = rootElement.querySelector<HTMLInputElement>(
    '[data-static-search-input]',
  );
  if (input && document.activeElement !== input) {
    input.value = staticSearchQuery();
  }
}

function connectSignalCover() {
  const cover = rootElement.querySelector<HTMLElement>('[data-signal-cover]');
  if (!cover) return;
  let seen: boolean;
  try {
    seen = window.sessionStorage.getItem('ca-cover-seen') === '1';
  } catch {
    seen = false;
  }
  // Automation (navigator.webdriver) and returning-this-session visitors never
  // see the cover, so the e2e/visual suite runs against the real Home.
  if (seen || window.navigator.webdriver) {
    cover.remove();
    return;
  }
  // Lift out of the Home shell's stacking context so the fixed overlay covers
  // the sticky header too — a full Depth-0 takeover.
  document.body.appendChild(cover);
  cover.removeAttribute('hidden');
  const enterButton = cover.querySelector<HTMLButtonElement>('[data-signal-cover-enter]');
  (enterButton || cover).focus();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    try {
      window.sessionStorage.setItem('ca-cover-seen', '1');
    } catch {
      /* sessionStorage unavailable — dismiss anyway */
    }
    window.removeEventListener('keydown', onCoverKey);
    if (reduce) {
      cover.remove();
      return;
    }
    cover.classList.add('signal-cover--exiting');
    window.setTimeout(() => cover.remove(), 460);
  }
  // Dismissal is intentionally narrow: only the Enter key or a direct click on
  // the "Enter the Atlas" button ends the takeover. No click-anywhere, wheel,
  // touchmove, Space, or Escape shortcuts — those let the cover disappear
  // before a visitor has actually read or chosen to enter.
  function onCoverKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      dismiss();
    }
  }
  enterButton?.addEventListener('click', dismiss);
  window.addEventListener('keydown', onCoverKey);
}

function connectStaticHome() {
  connectSignalCover();
  rootElement.querySelector<HTMLElement>('[data-static-home]')?.removeAttribute('hidden');
  rootElement
    .querySelector<HTMLElement>('[data-skip-workspace]')
    ?.addEventListener('click', (event) => {
      event.preventDefault();
      rootElement.querySelector<HTMLElement>('#workspace')?.focus();
    });

  rootElement.querySelectorAll<HTMLElement>('[data-static-home] [data-route]').forEach((control) => {
    control.addEventListener('click', (event) => {
      if (!isPlainPrimaryNavigation(event)) return;
      event.preventDefault();
      const target = control.dataset.route;
      if (target) navigateFromStaticHome(target);
    });
  });

  // Below the compact-header breakpoint the persistent header's primary and
  // utility nav are CSS-hidden in favor of TopNav's real mobile sheet, which
  // only exists once React mounts. The static shell has no equivalent
  // drawer, so a tap here boots React (like the search shortcut below) —
  // the first tap opens the real, fully-interactive menu instead of building
  // a second, throwaway one.
  rootElement
    .querySelector<HTMLFormElement>('[data-home-search]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = new FormData(event.currentTarget as HTMLFormElement).get('query');
      if (typeof query === 'string' && query.trim()) {
        navigateFromStaticHome(`#/library?q=${encodeURIComponent(query.trim())}`);
      }
    });

  startBrandRotation();
  window.addEventListener('keydown', onStaticSearchShortcut);
  rootElement
    .querySelector<HTMLElement>('.app-shell')
    ?.setAttribute('data-app-ready', 'true');
}

function openReactNavigationMenuWhenReady() {
  const openMenu = () => {
    const toggle = rootElement.querySelector<HTMLElement>(
      '[data-react-root] .navigation-menu-toggle',
    );
    if (!toggle) return false;
    toggle.click();
    return true;
  };
  if (openMenu()) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    const observer = new MutationObserver(() => {
      if (!openMenu()) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(true);
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, 3000);
    observer.observe(reactRootElement, { childList: true, subtree: true });
  });
}

function connectStaticHeader() {
  rootElement
    .querySelectorAll<HTMLElement>('[data-static-header] [data-route]')
    .forEach((control) => {
      control.addEventListener('click', (event) => {
        if (!isPlainPrimaryNavigation(event)) return;
        event.preventDefault();
        const target = control.dataset.route;
        if (target) navigateFromStaticHome(target);
      });
    });
  const staticMenuToggle = rootElement.querySelector<HTMLElement>(
    '[data-static-menu-boot]',
  );
  staticMenuToggle?.setAttribute(
    'aria-label',
    window.matchMedia('(max-width: 1199px)').matches
      ? 'Open navigation menu'
      : 'Open more pages',
  );
  staticMenuToggle?.setAttribute('aria-expanded', 'false');
  staticMenuToggle?.addEventListener('click', () => {
      if (!beginRouteTransition('Opening navigation', 'static:menu')) return;
      void bootReactApp().then(async (booted) => {
        if (!booted) return;
        await openReactNavigationMenuWhenReady();
        completeRouteTransition();
      });
    });
  rootElement
    .querySelector<HTMLElement>('[data-static-search-open]')
    ?.addEventListener('click', () => {
      if (!beginRouteTransition('Opening search', 'static:search')) return;
      void bootReactApp().then((booted) => {
        if (!booted) return;
        completeRouteTransition();
        // SearchOverlay attaches its event listener from a passive React effect.
        // Give that effect the same short settling window as the keyboard path
        // below so a cold Home boot cannot lose the open request.
        window.setTimeout(() => requestSearchOverlayOpen(), 60);
      });
    });
}

// React (and its Ctrl+K listener in App.tsx) does not mount at all while on
// Home, per syncProgressiveShell's reactActive flag below — so the shortcut
// the masthead advertises would otherwise do nothing on the one page whose
// hero prints it. Boot React, then ask it to open the overlay once mounted.
function onStaticSearchShortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    void bootReactApp().then((booted) => {
      if (!booted) return;
      // React's passive effects (which attach the listener this event needs)
      // flush asynchronously after commit, not within this same microtask —
      // a rAF landed before that flush and the event was lost. A short delay
      // clears it reliably; it is imperceptible on a keypress.
      window.setTimeout(() => requestSearchOverlayOpen(), 60);
    });
  }
}

async function bootReactApp() {
  if (reactBoot) return reactBoot;

  document.querySelector('[data-signal-cover]')?.remove();
  window.removeEventListener('keydown', onStaticSearchShortcut);
  stopBrandRotation();
  const staticHome = rootElement.querySelector<HTMLElement>('[data-static-home]');
  staticHome?.remove();
  // React owns the complete route once it boots. Removing the static Home node
  // atomically prevents its landmark from surviving beside the route landmark.
  syncProgressiveShell();
  window.removeEventListener('hashchange', onLocationChange);
  window.removeEventListener('popstate', onLocationChange);

  reactBoot = loadReactModules()
    .then(([react, reactDom, appModule]) => {
      reactDom.createRoot(reactRootElement).render(
        react.createElement(
          react.StrictMode,
          null,
          react.createElement(appModule.App),
        ),
      );
      observeRouteHydration();
      return true;
    })
    .catch((error: unknown) => {
      reactBoot = null;
      reactModules = null;
      const recoveringHome = isHomeHash();
      if (recoveringHome && staticHome && !staticHome.isConnected) {
        rootElement.insertBefore(staticHome, reactRootElement);
      }
      completeRouteTransition();
      if (recoveringHome && staticHome) {
        const homeMain = staticHome.querySelector<HTMLElement>('main');
        let status = staticHome.querySelector<HTMLElement>('[data-home-boot-status]');
        if (!status && homeMain) {
          status = document.createElement('p');
          status.className = 'home-boot-status';
          status.dataset.homeBootStatus = 'true';
          homeMain.append(status);
        }
        if (status) {
          status.textContent =
            'Interactive features did not load. Reload the page to try again.';
          status.setAttribute('role', 'alert');
        }
      }
      if (recoveringHome) {
        staticHome?.removeAttribute('hidden');
        rootElement.dataset.reactActive = 'false';
        window.addEventListener('keydown', onStaticSearchShortcut);
        startBrandRotation();
      }
      rootElement.dataset.reactBootError = "true";
      const routeSummary = rootElement.querySelector<HTMLElement>(
        '[data-static-route-summary]',
      );
      if (routeSummary) {
        routeSummary.textContent =
          'The interactive workspace could not load. Reload this page to try again.';
        routeSummary.setAttribute('role', 'alert');
      }
      return false;
    });

  syncProgressiveShell();
  return reactBoot;
}

function loadReactModules() {
  if (reactModules) return reactModules;
  reactModules = Promise.all([
    import('react'),
    import('react-dom/client'),
    import('./ui/App'),
  ]).catch((error) => {
    reactModules = null;
    throw error;
  });
  return reactModules;
}

function onLocationChange() {
  if (rootElement.dataset.reactActive !== 'true') {
    beginRouteTransition("Opening the selected workspace", window.location.hash);
  }
  if (!isHomeHash()) void bootReactApp();
}

function warmInteractiveRoute() {
  const hashRoute = window.location.hash.replace(/^#/, '') || '/';
  const routeUrl = new URL(hashRoute, window.location.origin);
  switch (routeUrl.pathname.split('/')[1]) {
    case 'search':
      void import('./ui/pages/ExplorePage').catch(() => undefined);
      break;
    case 'explore':
      void import('./ui/pages/AtlasMapPage').catch(() => undefined);
      break;
    case 'catalog':
      void import('./ui/pages/CatalogDetailPage').catch(() => undefined);
      break;
    case 'record':
      void import('./ui/pages/ObjectDetailPage').catch(() => undefined);
      break;
  }
  void Promise.all([
    import('./ui/lib/hashRoutes'),
    import('./ui/lib/runtimeLoader'),
  ])
    .then(([routes, runtime]) =>
      runtime.preloadRuntimeArtifacts(
        routes.parseHashLocation(routeUrl.pathname, routeUrl.search),
      ),
    )
    .catch(() => undefined);
}

async function start() {
  const hasLegacyQuery =
    window.location.search.length > 1 &&
    !window.location.hash.replace(/^#\/?/, '').length;
  if (hasLegacyQuery) {
    const { applyLegacyQueryRedirect } = await import('./ui/lib/hashRoutes');
    applyLegacyQueryRedirect();
  }

  connectStaticSearch();
  connectStaticHeader();
  syncProgressiveShell();
  window.addEventListener('hashchange', syncProgressiveShell);
  window.addEventListener('popstate', syncProgressiveShell);
  window.addEventListener(ROUTE_COMMITTED_EVENT, syncProgressiveShell);
  window.addEventListener(
    SEARCH_RESULTS_FOCUS_EVENT,
    focusSearchResultsWhenReady,
  );

  // Home stays on the static shell until a real interaction (nav click,
  // search submit, Ctrl+K, or the mobile menu button) boots React — that is
  // the whole point of the static shell, and tests/e2e/bootstrap-payload.spec
  // enforces it (exactly one script requested on first paint). The static
  // header carries the persistent nav markup so Home is never without
  // navigation even before that boot (see src/index.html's <header
  // class="site-header">); every other route boots immediately after the
  // initial paint, same as before.
  if (isHomeHash()) {
    connectStaticHome();
    window.addEventListener('hashchange', onLocationChange);
    window.addEventListener('popstate', onLocationChange);
    return;
  }

  // Start fetching the interactive route immediately behind the stable
  // first-paint shell. Waiting for window.load created a full network
  // waterfall: CSS and the entry module finished before the React route and
  // its data even started. Home keeps its one-script static boundary above.
  // The classic progressive shell has already revealed the route identity.
  // Begin fetching the route and framework immediately so network time overlaps
  // that stable first paint and produces the interactive result without an
  // extra task boundary between framework readiness and the initial commit.
  warmInteractiveRoute();
  void bootReactApp();
}

void start();
