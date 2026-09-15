import '@testing-library/jest-dom';

/**
 * Deterministic Web Storage for tests.
 *
 * Why this exists: from Node 22 onward Node ships its OWN global `localStorage`
 * (the Web Storage API). On Node 25 that native global wins over jsdom's, and
 * because Node's implementation is file-backed it is INERT unless the process
 * was started with a valid `--localstorage-file` — `localStorage.getItem` is
 * simply `undefined`. `window.localStorage` is the very same object, so jsdom's
 * working Storage never gets a look in.
 *
 * The visible symptom was ~360 failures across 27 files, all
 * `TypeError: localStorage.getItem is not a function`, thrown from ThemeProvider
 * and the i18n provider during mount — which between them wrap nearly every
 * test. Note `sessionStorage` is unaffected: Node's is in-memory and works.
 *
 * Rather than depend on whichever Storage the host Node and jsdom happen to
 * agree on, the suite installs its own. That makes results identical on Node 22,
 * 25 and whatever comes next, and keeps them independent of any file on the
 * machine running them.
 *
 * This is a working Storage, deliberately NOT a no-op: tests such as
 * Layout.test.tsx set `purser.theme` and assert the theme that results, so a
 * stub that silently discarded writes would leave those tests passing while
 * testing nothing.
 */
function createMemoryStorage(): Storage {
  let entries = new Map<string, string>();

  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear() {
      entries = new Map();
    },
    getItem(key: string) {
      // Storage returns null — not undefined — for an absent key.
      return entries.has(String(key)) ? (entries.get(String(key)) as string) : null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(String(key));
    },
    setItem(key: string, value: string) {
      // Storage coerces both key and value to strings.
      entries.set(String(key), String(value));
    },
  };

  return storage;
}

function installStorage(name: 'localStorage' | 'sessionStorage') {
  const storage = createMemoryStorage();
  // `configurable: true` on both targets, verified on Node 25 — the native
  // global is defined with a getter, so it can be replaced but not assigned to.
  for (const target of [globalThis, window] as const) {
    Object.defineProperty(target, name, {
      value: storage,
      configurable: true,
      writable: false,
    });
  }
}

installStorage('localStorage');
installStorage('sessionStorage');
