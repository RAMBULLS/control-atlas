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
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", finish);
    };
    const finish = () => { cleanup(); resolve(); };
    const check = () => {
      if (settled) return;
      const workspace = document.getElementById("workspace");
      if (workspace?.querySelector("[data-route-render-error]")) {
        cleanup();
        reject(new Error("The record renderer could not load."));
        return;
      }
      const content = workspace?.querySelector<HTMLElement>("[data-record-content]");
      if (content?.dataset.recordContent !== nodeId || content.dataset.recordCommit !== token) return;
      if (frame) return;
      // The first frame prepares the committed record; the next lets supporting
      // work begin after its paint opportunity rather than after setState.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          const currentWorkspace = document.getElementById("workspace");
          const current = currentWorkspace?.querySelector<HTMLElement>("[data-record-content]");
          if (currentWorkspace?.querySelector("[data-route-render-error]")) check();
          else if (current?.dataset.recordContent === nodeId && current.dataset.recordCommit === token) finish();
        });
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-record-content", "data-record-commit", "data-route-render-error"],
    });
    signal.addEventListener("abort", finish, { once: true });
    check();
    if (signal.aborted) finish();
  });
}
