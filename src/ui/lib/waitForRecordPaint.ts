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

/** Release supporting downloads after this official runtime has committed. */
export function waitForRecordPaint(nodeId: string, runtime: object, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const token = recordCommitToken(runtime);
  return new Promise((resolve, reject) => {
    let frame = 0;
    let paintTask: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (paintTask !== undefined) clearTimeout(paintTask);
      signal.removeEventListener("abort", finish);
    };
    const finish = () => { cleanup(); resolve(); };
    const matchingVisibleRecord = () => {
      const content = document.getElementById("workspace")?.querySelector<HTMLElement>("[data-record-content]");
      return content?.dataset.recordContent === nodeId && content.dataset.recordCommit === token
        && content.getClientRects().length > 0 && getComputedStyle(content).visibility !== "hidden";
    };
    const check = () => {
      if (settled) return;
      const workspace = document.getElementById("workspace");
      if (workspace?.querySelector("[data-route-render-error]")) {
        cleanup();
        reject(new Error("The record renderer could not load."));
        return;
      }
      if (!matchingVisibleRecord() || frame || paintTask !== undefined) return;
      // RAF callbacks precede paint. Resume supporting work in a later task,
      // after the matching visible record has had its rendering opportunity.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          paintTask = setTimeout(() => {
            paintTask = undefined;
            if (document.getElementById("workspace")?.querySelector("[data-route-render-error]")) check();
            else if (matchingVisibleRecord()) finish();
          }, 0);
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
