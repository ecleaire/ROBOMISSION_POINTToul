export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  isPersistent(): boolean;
}

/**
 * Keeps the app usable when browser storage is blocked or full.
 * Failed writes remain available for the lifetime of the current tab.
 */
export function createResilientStorage(provider: () => Storage): StorageLike {
  const fallback = new Map<string, string>();
  let available = true;

  return {
    getItem(key) {
      try {
        const value = provider().getItem(key);
        available = true;
        return value ?? fallback.get(key) ?? null;
      } catch {
        available = false;
        return fallback.get(key) ?? null;
      }
    },
    setItem(key, value) {
      try {
        provider().setItem(key, value);
        available = true;
        fallback.delete(key);
      } catch {
        available = false;
        fallback.set(key, value);
      }
    },
    removeItem(key) {
      fallback.delete(key);
      try {
        provider().removeItem(key);
        available = true;
      } catch {
        available = false;
        // The in-tab fallback has already been cleared.
      }
    },
    isPersistent() {
      return available && fallback.size === 0;
    },
  };
}
