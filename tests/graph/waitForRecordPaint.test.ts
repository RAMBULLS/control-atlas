import assert from "node:assert/strict";
import test from "node:test";
import { recordCommitToken, waitForRecordPaint } from "../../src/ui/lib/waitForRecordPaint";

test("paint acknowledgement requires the matching runtime and two paint opportunities, and releases observers on cancellation/error", async () => {
  const keys = ["document", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame"];
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let callback = () => {};
  let connected = false;
  let nextFrame = 0;
  const frames = new Map<number, (time: number) => void>();
  let renderError = false;
  const current: Record<string, string> = {};
  const workspace = { querySelector: (selector: string) => selector.includes("render-error") ? (renderError ? {} : null) : { dataset: current } };
  const fakeDocument = { body: {}, getElementById: () => workspace };
  class Observer { constructor(fn: () => void) { callback = fn; } observe() { connected = true; } disconnect() { connected = false; } }
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: Observer });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (fn: (time: number) => void) => { frames.set(++nextFrame, fn); return nextFrame; } });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (id: number) => frames.delete(id) });
  const tick = () => { const pending = [...frames.entries()]; frames.clear(); for (const [, fn] of pending) fn(0); };
  try {
    const runtime = {};
    const controller = new AbortController();
    let resolved = false;
    current.recordContent = "AC-2"; current.recordCommit = recordCommitToken({});
    const pending = waitForRecordPaint("AC-2", runtime, controller.signal).then(() => { resolved = true; });
    callback(); tick(); await Promise.resolve();
    assert.equal(resolved, false, "a prior runtime on the same record cannot release supporting work");
    current.recordCommit = recordCommitToken(runtime); callback();
    tick(); await Promise.resolve(); assert.equal(resolved, false);
    tick(); await pending; assert.equal(resolved, true); assert.equal(connected, false);
    const cancelled = new AbortController();
    const waiting = waitForRecordPaint("other", {}, cancelled.signal);
    cancelled.abort(); await waiting; assert.equal(connected, false); assert.equal(frames.size, 0);
    renderError = true;
    await assert.rejects(waitForRecordPaint("AC-2", {}, new AbortController().signal), /renderer/);
    assert.equal(connected, false);
    const alreadyAborted = new AbortController(); alreadyAborted.abort();
    await waitForRecordPaint("AC-2", {}, alreadyAborted.signal);
    assert.equal(connected, false);
  } finally {
    for (const key of keys) { const descriptor = descriptors.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
