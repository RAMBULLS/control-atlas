import assert from "node:assert/strict";
import test from "node:test";
import { recordCommitToken, waitForRecordPaint } from "../../src/ui/lib/waitForRecordPaint";

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
