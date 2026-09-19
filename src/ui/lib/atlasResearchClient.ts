export type ResearchCommand =
  | { kind: "load"; url: string }
  | { kind: "search"; query: string }
  | { kind: "records"; ids: string[] }
  | { kind: "path"; from: string; to: string; direction: "forward" | "either"; maxHops: number }
  | { kind: "upstream"; from: string; catalogs: string[]; maxHops: number }
  | { kind: "degree"; id: string }
  | { kind: "shared"; pins: string[]; offset: number };

/** Owned by the mounted research view: no graph payload on ordinary Atlas arrival. */
export class AtlasResearchClient {
  private worker = new Worker(new URL("../workers/atlasResearch.worker.ts", import.meta.url), { type: "module" });
  private nextId = 0;
  private disposed = false;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor() {
    this.worker.onmessage = (event) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(event.data.id);
      if (event.data.error) pending.reject(new Error("The research request could not be completed."));
      else pending.resolve(event.data.value);
    };
    this.worker.onerror = () => this.dispose();
    this.worker.onmessageerror = () => this.dispose();
  }
  request<T>(command: ResearchCommand): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("Research session ended."));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(), command.kind === "load" ? 75000 : 15000);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.worker.postMessage({ id, command });
    });
  }
  dispose() {
    this.disposed = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Research session ended.")); }
    this.pending.clear();
  }
}
