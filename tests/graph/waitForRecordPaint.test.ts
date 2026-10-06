import assert from "node:assert/strict";
import test from "node:test";
import { recordCommitToken, waitForRecordPaint } from "../../src/ui/lib/waitForRecordPaint";

test("native paint requires current text and bounds missing notifications with complete cleanup", async () => {
  const keys = ["document", "MutationObserver", "PerformanceObserver", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "getComputedStyle"];
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let mutation = () => {};
  let emitPaint = (_element: InstanceType<typeof globalThis.Element> | null, _identifier: string, _name = "text-paint", _visible = true) => {};
  let nativeConnected = false;
  let mutationConnected = false;
  let observations = 0;
  let renderError = false;
  let nextId = 0;
  const frames = new Map<number, (time: number) => void>();
  const tasks = new Map<number, { run: () => void; delay: number }>();
  const makeText = (top = 20) => {
    const attributes = new Map<string, string>();
    return {
      textContent: "Published source text", isConnected: true,
      getBoundingClientRect: () => ({ top, bottom: top + 100, left: 20, right: 220, width: 200, height: 100 }),
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      removeAttribute: (name: string) => { attributes.delete(name); },
    };
  };
  let text = makeText();
  const current: Record<string, string> = {};
  const content = { dataset: current, getClientRects: () => [{}], querySelector: () => text, contains: (element: unknown) => element === text };
  const workspace = { querySelector: (selector: string) => selector.includes("render-error") ? (renderError ? {} : null) : content };
  class Mutation { constructor(fn: () => void) { mutation = fn; } observe() { mutationConnected = true; } disconnect() { mutationConnected = false; } }
  class Native {
    static supportedEntryTypes = ["element"];
    constructor(fn: ConstructorParameters<typeof globalThis.PerformanceObserver>[0]) {
      emitPaint = (element, identifier, name = "text-paint", visible = true) => fn({ getEntries: () => [{ name, element, identifier, startTime: 30, intersectionRect: { width: visible ? 200 : 0, height: visible ? 100 : 0 } }] } as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
    }
    observe() { nativeConnected = true; observations += 1; }
    disconnect() { nativeConnected = false; }
  }
  const replacements = {
    document: { body: {}, documentElement: { clientHeight: 1000, clientWidth: 1440 }, fonts: { status: "loaded", ready: Promise.resolve() }, getElementById: () => workspace },
    MutationObserver: Mutation, PerformanceObserver: Native,
    requestAnimationFrame: (fn: (time: number) => void) => { frames.set(++nextId, fn); return nextId; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    setTimeout: (run: () => void, delay = 0) => { tasks.set(++nextId, { run, delay }); return nextId; },
    clearTimeout: (id: number) => { tasks.delete(id); },
    getComputedStyle: () => ({ visibility: "visible" }),
  };
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const tick = async () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(0); await Promise.resolve(); };
  const portable = async () => {
    await tick(); await tick(); await tick();
    for (const [id, task] of [...tasks]) if (task.delay === 0) { tasks.delete(id); task.run(); }
    await Promise.resolve();
  };
  const begin = () => {
    const runtime = {};
    current.recordContent = "AC-2"; current.recordCommit = recordCommitToken(runtime);
    const controller = new AbortController();
    return { controller, pending: waitForRecordPaint("AC-2", runtime, controller.signal) };
  };
  const clean = () => {
    assert.equal(nativeConnected, false); assert.equal(mutationConnected, false);
    assert.equal(frames.size, 0); assert.equal(tasks.size, 0);
    assert.equal(text.getAttribute("elementtiming"), null);
  };
  try {
    let resolved = false;
    const first = begin(); void first.pending.then(() => { resolved = true; });
    await portable(); assert.equal(resolved, false, "a rendering opportunity is not a native paint notification");
    emitPaint(text as unknown as InstanceType<typeof globalThis.Element>, "record-old"); await Promise.resolve(); assert.equal(resolved, false);
    emitPaint(null, `record-${current.recordCommit}`); await Promise.resolve(); assert.equal(resolved, false);
    emitPaint(text as unknown as InstanceType<typeof globalThis.Element>, `record-${current.recordCommit}`, "image-paint"); await Promise.resolve(); assert.equal(resolved, false);
    emitPaint(text as unknown as InstanceType<typeof globalThis.Element>, `record-${current.recordCommit}`, "text-paint", false); await Promise.resolve(); assert.equal(resolved, false);
    current.recordContent = "AC-3";
    emitPaint(text as unknown as InstanceType<typeof globalThis.Element>, `record-${current.recordCommit}`); await Promise.resolve(); assert.equal(resolved, false);
    current.recordContent = "AC-2"; text.isConnected = false;
    emitPaint(text as unknown as InstanceType<typeof globalThis.Element>, `record-${current.recordCommit}`); await Promise.resolve(); assert.equal(resolved, false);
    text.isConnected = true;
    emitPaint(text as unknown as InstanceType<typeof globalThis.Element>, `record-${current.recordCommit}`); await first.pending; clean();

    const retained = begin(); await portable(); await retained.pending;
    assert.equal(observations, 1, "retained text does not wait for a notification it may never repeat"); clean();

    text = makeText(); const missing = begin(); await portable();
    const deadline = [...tasks.values()].find((task) => task.delay === 1000);
    assert.ok(deadline); deadline.run(); await missing.pending; clean();

    text = makeText(); const earlyDeadline = begin(); let earlyResolved = false;
    void earlyDeadline.pending.then(() => { earlyResolved = true; });
    const pendingDeadline = [...tasks.values()].find((task) => task.delay === 1000);
    assert.ok(pendingDeadline); pendingDeadline.run(); await Promise.resolve();
    assert.equal(earlyResolved, false, "a watchdog does not replace the portable rendering opportunity");
    await portable(); await earlyDeadline.pending; clean();

    text = makeText(); const aborted = begin(); await portable(); aborted.controller.abort(); await aborted.pending; clean();
    text = makeText(); const failed = begin(); await portable(); renderError = true; mutation();
    await assert.rejects(failed.pending, /renderer could not load/); renderError = false; clean();
    text = makeText(); const failedAtPaint = begin(); renderError = true;
    emitPaint(text as unknown as InstanceType<typeof globalThis.Element>, `record-${current.recordCommit}`);
    await assert.rejects(failedAtPaint.pending, /renderer could not load/); renderError = false; clean();
    text = makeText(); const failedAtDeadline = begin(); await portable(); renderError = true;
    const failedDeadline = [...tasks.values()].find((task) => task.delay === 1000);
    assert.ok(failedDeadline); failedDeadline.run();
    await assert.rejects(failedAtDeadline.pending, /renderer could not load/); renderError = false; clean();

    const count = observations;
    text = makeText(1200); const offscreen = begin(); await portable(); await offscreen.pending;
    assert.equal(observations, count); clean();
    Native.supportedEntryTypes = []; text = makeText(); const unsupported = begin(); await portable(); await unsupported.pending;
    assert.equal(observations, count); clean();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("paint acknowledgement requires a visible matching runtime and a task after paint, with cancellation/error cleanup", async () => {
  const keys = ["document", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "getComputedStyle"];
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let callback = () => {};
  let connected = false;
  let nextFrame = 0;
  const frames = new Map<number, (time: number) => void>();
  const tasks = new Map<number, () => void>();
  let nextTask = 0;
  let visible = true;
  let renderError = false;
  const current: Record<string, string> = {};
  const workspace = { querySelector: (selector: string) => selector.includes("render-error") ? (renderError ? {} : null) : { dataset: current, getClientRects: () => visible ? [{}] : [] } };
  const fakeDocument: { body: object; getElementById: () => typeof workspace; fonts?: {status: string; ready: Promise<void> } } = {
    body: {}, getElementById: () => workspace, fonts: {status: "loaded", ready: Promise.resolve()},
  };
  class Observer { constructor(fn: () => void) { callback = fn; } observe() { connected = true; } disconnect() { connected = false; } }
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: Observer });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (fn: (time: number) => void) => { frames.set(++nextFrame, fn); return nextFrame; } });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (id: number) => frames.delete(id) });
  Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: (fn: () => void) => { tasks.set(++nextTask, fn); return nextTask; } });
  Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: (id: number) => tasks.delete(id) });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ visibility: visible ? "visible" : "hidden" }) });
  const tick = () => { const pending = [...frames.entries()]; frames.clear(); for (const [, fn] of pending) fn(0); };
  const runTasks = () => { const pending = [...tasks.values()]; tasks.clear(); for (const fn of pending) fn(); };
  try {
    const runtime = {};
    const controller = new AbortController();
    let resolved = false;
    current.recordContent = "AC-2"; current.recordCommit = recordCommitToken({});
    const pending = waitForRecordPaint("AC-2", runtime, controller.signal).then(() => { resolved = true; });
    callback(); tick(); await Promise.resolve();
    assert.equal(resolved, false, "a prior runtime on the same record cannot release supporting work");
    visible = false; current.recordCommit = recordCommitToken(runtime); callback();
    assert.equal(frames.size, 0, "a committed record behind the loading surface cannot acknowledge paint");
    visible = true; callback();
    tick(); await Promise.resolve(); assert.equal(resolved, false);
    tick(); await Promise.resolve(); assert.equal(resolved, false, "supporting work cannot resume inside RAF");
    tick();
    current.recordCommit = recordCommitToken({}); runTasks(); await Promise.resolve();
    assert.equal(resolved, false, "the record must still match when the later task runs");
    current.recordCommit = recordCommitToken(runtime); callback(); tick(); tick(); await Promise.resolve(); tick(); runTasks();
    await pending; assert.equal(resolved, true); assert.equal(connected, false);
    const cancelled = new AbortController();
    const waiting = waitForRecordPaint("other", {}, cancelled.signal);
    cancelled.abort(); await waiting; assert.equal(connected, false); assert.equal(frames.size, 0);
    const cancelledTask = new AbortController();
    const taskWaiting = waitForRecordPaint("AC-2", runtime, cancelledTask.signal);
    tick(); tick(); await Promise.resolve(); tick(); assert.equal(tasks.size, 1); cancelledTask.abort(); await taskWaiting;
    assert.equal(tasks.size, 0, "abort must cancel the after-paint task");
    const failedTask = waitForRecordPaint("AC-2", runtime, new AbortController().signal);
    tick(); tick(); await Promise.resolve(); tick(); renderError = true; runTasks();
    await assert.rejects(failedTask, /renderer/); assert.equal(tasks.size, 0); assert.equal(connected, false);
    renderError = true;
    await assert.rejects(waitForRecordPaint("AC-2", {}, new AbortController().signal), /renderer/);
    assert.equal(connected, false);
    renderError = false;
    let releaseFonts = () => {};
    const pendingFonts = () => {
      fakeDocument.fonts = { status: "loading", ready: new Promise<void>(resolve => { releaseFonts = resolve; }) };
    };
    fakeDocument.fonts = {status: "loaded", ready: Promise.resolve()};
    const fontWait = waitForRecordPaint("AC-2", runtime, new AbortController().signal);
    pendingFonts();
    tick(); tick(); await Promise.resolve(); assert.equal(frames.size, 0); assert.equal(tasks.size, 0);
    current.recordCommit = recordCommitToken({});
    fakeDocument.fonts!.status = "loaded"; releaseFonts(); await Promise.resolve(); tick(); runTasks();
    assert.equal(connected, true, "stale identity after font readiness must keep waiting");
    current.recordCommit = recordCommitToken(runtime); callback(); tick(); tick(); await Promise.resolve(); tick(); runTasks();
    await fontWait; assert.equal(connected, false);
    pendingFonts();
    const fontAbort = new AbortController();
    const abortedFonts = waitForRecordPaint("AC-2", runtime, fontAbort.signal);
    tick(); tick(); fontAbort.abort(); await abortedFonts; assert.equal(connected, false);
    releaseFonts(); await Promise.resolve(); assert.equal(frames.size, 0);
    pendingFonts();
    const failedFonts = waitForRecordPaint("AC-2", runtime, new AbortController().signal);
    tick(); tick(); renderError = true; callback(); await assert.rejects(failedFonts, /renderer/);
    releaseFonts(); await Promise.resolve(); assert.equal(frames.size, 0); assert.equal(connected, false);
    renderError = false; delete fakeDocument.fonts;
    const noFontApi = waitForRecordPaint("AC-2", runtime, new AbortController().signal);
    tick(); tick(); await Promise.resolve(); tick(); runTasks(); await noFontApi;
    const alreadyAborted = new AbortController(); alreadyAborted.abort();
    await waitForRecordPaint("AC-2", {}, alreadyAborted.signal);
    assert.equal(connected, false);
  } finally {
    for (const key of keys) { const descriptor = descriptors.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
