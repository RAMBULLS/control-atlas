/** Only this application's verified public snapshot is stored, never system evidence. */
const DATABASE = "control-atlas-public-snapshot-v1";
function database() {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("This browser could not open local snapshot storage."));
    request.onblocked = () => reject(new Error("Close other Atlas tabs before updating local storage."));
  });
}
export async function storedSnapshot(action, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("snapshots", action === "read" ? "readonly" : "readwrite");
      const store = transaction.objectStore("snapshots");
      const request = action === "read" ? store.get("baseline") : action === "clear" ? store.delete("baseline") : store.put(value, "baseline");
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result || null);
      transaction.onerror = () => reject(new Error("The public snapshot could not be saved on this device."));
      transaction.onabort = () => reject(new Error("Snapshot storage was interrupted. No successful save is claimed."));
    });
  } finally { db.close(); }
}
