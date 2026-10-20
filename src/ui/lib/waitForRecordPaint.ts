const runtimeTokens = new WeakMap<object, string>();
let nextToken = 0;

export function recordCommitToken(runtime: object): string {
  let token = runtimeTokens.get(runtime);
  if (!token) {
    token = String(++nextToken);
    runtimeTokens.set(runtime, token);
  }
  return token;
}

/** Wait for this visible official runtime and a paint opportunity, not a paint measurement. */
export function waitForRecordPaint(nodeId: string, runtime: object, signal: AbortSignal, timeoutMs = 12_000): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const token = recordCommitToken(runtime);
  const mark = (name: string) => {
    performance.clearMarks(name);
    performance.mark(name, { detail: { nodeId, commitToken: token } });
  };
  return new Promise((resolve, reject) => {
    let frame = 0;
    let idle = 0;
    let settled = false;
    let deadline: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (idle) cancelIdleCallback(idle);
      clearTimeout(deadline);
      signal.removeEventListener("abort", finish);
    };
    const finish = () => { cleanup(); resolve(); };
    const matches = (content: HTMLElement | null | undefined) =>
      content?.dataset.recordContent === nodeId && content.dataset.recordCommit === token &&
      content.getClientRects().length > 0 && getComputedStyle(content).visibility !== "hidden";
    const acknowledge = () => {
      idle = 0;
      if (settled) return;
      const currentWorkspace = document.getElementById("workspace");
      const current = currentWorkspace?.querySelector<HTMLElement>("[data-record-content]");
      if (currentWorkspace?.querySelector("[data-route-render-error]")) check();
      else if (matches(current)) {
        mark("atlas:record-paint-opportunity");
        finish();
      }
    };
    const check = () => {
      if (settled) return;
      const workspace = document.getElementById("workspace");
      if (workspace?.querySelector("[data-route-render-error]")) {
        cleanup();
        reject(new Error("The record renderer could not load."));
        return;
      }
      const content = workspace?.querySelector<HTMLElement>("[data-record-content]");
      if (!matches(content)) return;
      if (frame || idle) return;
      mark("atlas:record-surface-visible");
      // The first frame prepares the committed record; the next lets supporting
      // work begin after its paint opportunity rather than after setState.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          // rAF callbacks run before rendering. Give the browser's rendering
          // and input work priority before starting supplemental source work.
          // The timeout bounds that preference; the renderer deadline remains.
          if (typeof requestIdleCallback === "function") idle = requestIdleCallback(acknowledge, { timeout: 1_000 });
          else acknowledge();
        });
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-record-content", "data-record-commit", "data-route-render-error", "data-static-route-active", "hidden", "class", "style"],
    });
    deadline = setTimeout(() => {
      cleanup();
      reject(new Error("The record renderer took too long to become available."));
    }, timeoutMs);
    signal.addEventListener("abort", finish, { once: true });
    check();
    if (signal.aborted) finish();
  });
}
