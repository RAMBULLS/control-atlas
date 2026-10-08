/** Share the initial record import with its renderer, without loading React. */
export function createRecordRouteModuleCache<T>(load: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  let fulfilled: T | null = null;
  return {
    ready: () => fulfilled,
    load: () => {
      if (!pending) {
        pending = load().then(module => {
          fulfilled = module;
          return module;
        }).catch(error => {
          pending = null;
          throw error;
        });
      }
      return pending;
    },
  };
}

export const recordRouteModule = createRecordRouteModuleCache(
  () => import("../pages/ObjectDetailPage"),
);
