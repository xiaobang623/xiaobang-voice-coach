const STORAGE_KEY = "xiaobang_guest_id";

/** Stable id for visitors when Supabase auth is unavailable. */
export function getGuestId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const next = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}
