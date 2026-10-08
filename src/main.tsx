import {
  BRAND_ROTATION_INTERVAL_MS,
  BRAND_ROTATION_TRANSITION_MS,
  createBrandSignalPicker,
} from './shared/brand-rotation';
import {
  beginRouteTransition,
  completeRouteTransition,
  requestSearchOverlayOpen,
  ROUTE_COMMITTED_EVENT,
  ROUTE_TRANSITION_END_EVENT,
  SEARCH_RESULTS_FOCUS_EVENT,
} from './shared/navigation-events';
import { connectHomeDisclosure } from './ui/lib/homeDisclosure';
// Orbital Archive No. 01 is the visual authority, not a copied palette. The
// official release supplies the base recipes, DTCG tokens, and embedded fonts;
// Control Atlas styles below are semantic/product adapters only.
import 'orbital-archive-no-01/css';
import 'orbital-archive-no-01/fonts.css';
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
    shell.querySelector<HTMLElement>('[data-static-resource-companions]')?.toggleAttribute('hidden', identity.kind !== 'resources');
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
    !isHomeHash() && !isSearchHash() &&
    (rootElement.dataset.routeHydrated !== 'true' || identity?.kind === 'resources');
  shell.toggleAttribute('hidden', !active);
  if (!active) {
    delete rootElement.dataset.staticRouteActive;
    return;
  }
  if (rootElement.dataset.routeHydrated !== 'true') rootElement.dataset.staticRouteActive = 'true';
  shell.removeAttribute('aria-hidden');
  shell.removeAttribute('inert');
  if (rootElement.dataset.routeHydrated !== 'true') shell.setAttribute('role', 'status');
  else shell.removeAttribute('role');
}

function observeRouteHydration() {
  const reactRouteOwnsSurface = (app: HTMLElement) =>
    ['true', 'partial', 'error'].includes(app.dataset.appReady || '');
  const markHydrated = () => {
    const app = reactRootElement.querySelector<HTMLElement>('#app');
    if (!app || !reactRouteOwnsSurface(app)) return false;
    // A static route can be ready before its lazy page has committed. Keep the
    // first-paint identity until real content (or its recovery UI) owns it.
    if (reactRootElement.querySelector('[data-route-suspense-pending="true"]')) {
      return false;
    }
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
    if (rootElement.dataset.staticRouteKind === 'resources') {
      rootElement.dataset.staticRoutePersistent = 'resources';
      shell?.removeAttribute('role');
    }
    else shell?.remove();
    return true;
  };
  const scheduleHydration = () => {
    const app = reactRootElement.querySelector<HTMLElement>('#app');
    if (!app || !reactRouteOwnsSurface(app)) return;
    if (markHydrated()) observer.disconnect();
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
    if (markHydrated()) observer.disconnect();
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

  const pickSignal = createBrandSignalPicker();
  brandMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  brandMotionMedia.addEventListener('change', onBrandMotionChange);
  wordElement.textContent = pickSignal().label;
  if (brandMotionMedia.matches) return;

  brandRotationInterval = window.setInterval(() => {
    wordElement.classList.remove('word-enter');
    wordElement.classList.add('word-exit');
    brandRotationTransition = window.setTimeout(() => {
      wordElement.textContent = pickSignal().label;
      wordElement.classList.remove('word-exit');
      wordElement.classList.add('word-enter');
    }, BRAND_ROTATION_TRANSITION_MS);
  }, BRAND_ROTATION_INTERVAL_MS);
}

function onBrandMotionChange() {
  const wordElement = rootElement.querySelector<HTMLElement>('[data-brand-word]');
  if (!wordElement) return;
  stopBrandRotation();
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
    if (rootElement.dataset.staticRoutePersistent === 'resources') {
      const resourcesActive = progressiveRouteIdentity()?.kind === 'resources';
      rootElement.querySelector<HTMLElement>('[data-static-route]')?.toggleAttribute('hidden', !resourcesActive);
      if (resourcesActive) {
        rootElement.dataset.staticRouteKind = 'resources';
        rootElement.dataset.routeHydrated = 'true';
      } else {
        delete rootElement.dataset.staticRouteKind;
      }
      delete rootElement.dataset.staticSearchActive;
      return;
    }
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
  const enterButton = cover.querySelector<HTMLButtonElement>('[data-signal-cover-enter]');
  const signalWord = cover.querySelector<HTMLElement>('[data-signal-cover-word]');
  const pickSignal = createBrandSignalPicker();
  if (signalWord) signalWord.textContent = pickSignal().label;
  document.body.appendChild(cover);
  cover.removeAttribute('hidden');
  (enterButton || cover).focus();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let signalInterval = 0;
  let signalTransition = 0;
  if (!reduce && signalWord) {
    const advanceSignal = () => {
      signalWord.classList.remove('signal-cover__brand-word--enter');
      signalWord.classList.add('signal-cover__brand-word--exit');
      signalTransition = window.setTimeout(() => {
        signalWord.textContent = pickSignal().label;
        signalWord.classList.remove('signal-cover__brand-word--exit');
        void signalWord.offsetWidth;
        signalWord.classList.add('signal-cover__brand-word--enter');
      }, BRAND_ROTATION_TRANSITION_MS / 2);
    };
    signalInterval = window.setInterval(advanceSignal, BRAND_ROTATION_INTERVAL_MS);
  }
  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    try {
      window.sessionStorage.setItem('ca-cover-seen', '1');
    } catch {
      /* sessionStorage unavailable — dismiss anyway */
    }
    window.clearInterval(signalInterval);
    window.clearTimeout(signalTransition);
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
  const topics = rootElement.querySelector<HTMLDetailsElement>('[data-static-home] [data-home-topics]');
  if (topics) connectHomeDisclosure(topics);

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
        requestSearchOverlayOpen();
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
      requestSearchOverlayOpen();
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

async function warmInteractiveRoute() {
  // Wait only for the data-loader modules, not their network requests. Merely
  // scheduling these imports before React lets the UI request burst overtake
  // the loader and leaves the record shard queued behind unrelated scripts.
  let preloader: [
    typeof import('./ui/lib/hashRoutes'),
    typeof import('./ui/lib/runtimeLoader'),
  ] | undefined;
  try {
    preloader = await Promise.all([
      import('./ui/lib/hashRoutes'),
      import('./ui/lib/runtimeLoader'),
    ]);
  } catch {
    // The interactive loader still owns error and retry presentation.
  }
  // Navigation during that module wait wins. Never start the former record's
  // data or route module after the reader has returned to the static Home.
  if (isHomeHash()) return;
  const hashRoute = window.location.hash.replace(/^#/, '') || '/';
  const routeUrl = new URL(hashRoute, window.location.origin);
  if (preloader) {
    const [routes, runtime] = preloader;
    void runtime.preloadRuntimeArtifacts(
      routes.parseHashLocation(routeUrl.pathname, routeUrl.search),
    ).catch(() => undefined);
  }
  // Data requests have started. Give the cached framework/App imports their
  // place in the queue before the route helper starts its own import burst.
  void loadReactModules().catch(() => undefined);
  switch (routeUrl.pathname.split('/')[1]) {
    case 'search':
      void import('./ui/pages/ExplorePage').catch(() => undefined);
      break;
    case 'atlas':
    case 'explore':
      void import('./ui/pages/AtlasTerritoryPage').catch(() => undefined);
      break;
    case 'catalog':
      void import('./ui/pages/CatalogDetailPage').catch(() => undefined);
      break;
    case 'record':
      void import('./ui/lib/recordRouteModule')
        .then(({ recordRouteModule }) => recordRouteModule.load())
        .catch(() => undefined);
      break;
    case 'resources':
      void import('./ui/pages/CommonsPage').catch(() => undefined);
      break;
  }

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
  // Start the cached data requests before route/framework imports compete for
  // the connection. Data and UI then download together behind that stable shell.
  await warmInteractiveRoute();
  if (isHomeHash() && !reactBoot) {
    connectStaticHome();
    window.addEventListener('hashchange', onLocationChange);
    window.addEventListener('popstate', onLocationChange);
    return;
  }
  void bootReactApp();
}

void start();
