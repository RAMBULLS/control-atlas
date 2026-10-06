const runtimeTokens = new WeakMap<object, string>();
const observedText = new WeakSet<HTMLElement>();
const PAINT_OBSERVATION_TIMEOUT_MS = 1_000;
let nextToken = 0;

export function recordCommitToken(runtime: object): string {
  let token = runtimeTokens.get(runtime);
  if (!token) {
    token = String(++nextToken);
    runtimeTokens.set(runtime, token);
  }
  return token;
}

/** Release supporting downloads after this official runtime has committed. */
export function waitForRecordPaint(nodeId: string, runtime: object, signal: AbortSignal, sourceElement?: HTMLElement): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const token = recordCommitToken(runtime);
  const recordWorkspace = () => sourceElement?.closest<HTMLElement>('main') ?? document.getElementById('workspace');
  return new Promise((resolve, reject) => {
    let frame = 0;
    let paintTask: ReturnType<typeof setTimeout> | undefined;
    let waitingForFonts = false;
    let nativeDecision = false;
    let nativeTarget: HTMLElement | undefined;
    let nativeObserver: PerformanceObserver | undefined;
    let nativeTimer: ReturnType<typeof setTimeout> | undefined;
    let nativeExpired = false;
    let portableReady = false;
    let priorTiming: string | null = null;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      nativeObserver?.disconnect();
      if (nativeTimer !== undefined) clearTimeout(nativeTimer);
      if (nativeTarget?.getAttribute("elementtiming") === `record-${token}`) {
        if (priorTiming === null) nativeTarget.removeAttribute("elementtiming");
        else nativeTarget.setAttribute("elementtiming", priorTiming);
      }
      cancelAnimationFrame(frame);
      if (paintTask !== undefined) clearTimeout(paintTask);
      signal.removeEventListener("abort", finish);
    };
    const finish = () => { cleanup(); resolve(); };
    const matchingVisibleRecord = () => {
      const workspace = recordWorkspace();
      const content = workspace?.querySelector<HTMLElement>("[data-record-content]");
      return content?.dataset.recordContent === nodeId && content.dataset.recordCommit === token
        && content.getClientRects().length > 0 && getComputedStyle(content).visibility !== "hidden"
        && workspace && getComputedStyle(workspace).visibility !== "hidden";
    };
    const inViewport = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return getComputedStyle(element).visibility !== "hidden" && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
        && rect.top < document.documentElement.clientHeight && rect.left < document.documentElement.clientWidth;
    };
    const observeTextPaint = () => {
      if (nativeDecision) return;
      nativeDecision = true;
      if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("element")) return;
      const content = recordWorkspace()?.querySelector<HTMLElement>("[data-record-content]");
      const target = content?.querySelector<HTMLElement>(".source-text-blocks p");
      // Retained or offscreen text may never emit a fresh paint entry. Those
      // routes use the portable rendering opportunity instead.
      if (!target || observedText.has(target) || !inViewport(target) || !target.textContent?.trim()) return;
      const identifier = `record-${token}`;
      try {
        nativeObserver = new PerformanceObserver((list) => {
          const painted = list.getEntries().some((entry) => {
            const text = entry as PerformanceEntry & { element?: Element | null; identifier?: string; intersectionRect?: DOMRectReadOnly };
            return text.name === "text-paint" && text.element === target && text.identifier === identifier && text.startTime > 0
              && Number(text.intersectionRect?.width) > 0 && Number(text.intersectionRect?.height) > 0;
          });
          const workspace = recordWorkspace();
          if (workspace?.querySelector("[data-route-render-error]")) check();
          else if (painted && target.isConnected && workspace?.querySelector("[data-record-content]")?.contains(target)
            && inViewport(target) && matchingVisibleRecord()) finish();
          else check();
        });
        nativeObserver.observe({ type: "element", buffered: true });
        nativeTarget = target;
        priorTiming = target.getAttribute("elementtiming");
        target.setAttribute("elementtiming", identifier);
        observedText.add(target);
        // Missing browser notifications must not stall supporting content.
        // This deadline falls back to the existing portable path; it does not
        // count as evidence that text painted.
        nativeTimer = setTimeout(() => {
          nativeExpired = true;
          const recordVisible = matchingVisibleRecord();
          if (recordWorkspace()?.querySelector("[data-route-render-error]")) check();
          else if (portableReady && recordVisible && document.fonts?.status !== "loading") finish();
          else check();
        }, PAINT_OBSERVATION_TIMEOUT_MS);
      } catch {
        nativeObserver?.disconnect();
        nativeTarget = undefined;
      }
    };
    const check = () => {
      if (settled) return;
      const workspace = recordWorkspace();
      if (workspace?.querySelector("[data-route-render-error]")) {
        cleanup();
        reject(new Error("The record renderer could not load."));
        return;
      }
      if (!matchingVisibleRecord() || frame || paintTask !== undefined || waitingForFonts) return;
      observeTextPaint();
      // RAF callbacks precede paint. Resume supporting work in a later task,
      // after the matching visible record has had its rendering opportunity.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          // Visible source text can activate another font cycle. Read readiness
          // after its layout, then give those glyphs their own paint opportunity.
          waitingForFonts = true;
          void Promise.resolve(document.fonts?.ready).then(() => {
            waitingForFonts = false;
            if (settled) return;
            frame = requestAnimationFrame(() => {
              frame = 0;
              paintTask = setTimeout(() => {
                paintTask = undefined;
                const recordVisible = matchingVisibleRecord();
                if (recordWorkspace()?.querySelector("[data-route-render-error]")
                  || document.fonts?.status === "loading") check();
                else if (recordVisible) {
                  portableReady = true;
                  if (!nativeTarget || nativeExpired) finish();
                }
              }, 0);
            });
          }, (error: unknown) => {
            if (settled) return;
            cleanup();
            reject(error);
          });
        });
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-record-content", "data-record-commit", "data-route-render-error", "data-route-hydrated"],
    });
    signal.addEventListener("abort", finish, { once: true });
    check();
    if (signal.aborted) finish();
  });
}
