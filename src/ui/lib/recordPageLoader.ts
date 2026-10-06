import type { ObjectDetailPage } from "../pages/ObjectDetailPage";

type RecordPageModule = { default: typeof ObjectDetailPage };
let pending: Promise<RecordPageModule> | undefined;
let ready: typeof ObjectDetailPage | undefined;

/** Share startup warming with rendering without initializing a second lazy load. */
export function loadRecordPage(): Promise<RecordPageModule> {
  pending ??= import("../pages/ObjectDetailPage")
    .then((module) => {
      ready = module.ObjectDetailPage;
      return { default: ready };
    })
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}

export function readyRecordPage(): typeof ObjectDetailPage | undefined {
  return ready;
}
