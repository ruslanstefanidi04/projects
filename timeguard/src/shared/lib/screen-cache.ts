const memory = new Map<string, unknown>();

export function readScreenCache<T>(key: string): T | null {
  if (memory.has(key)) return memory.get(key) as T;
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as T;
    memory.set(key, data);
    return data;
  } catch {
    return null;
  }
}

export function writeScreenCache<T>(key: string, value: T, persist = true) {
  memory.set(key, value);
  if (!persist) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked
  }
}
