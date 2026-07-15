import type { GrowthPageData } from "../types";

interface GrowthCacheEntry {
  userId: string;
  data: GrowthPageData;
  fetchedAt: number;
}

const STORAGE_KEY = "xiaobang-growth-cache";

let cache: GrowthCacheEntry | null = null;

function readStorageEntry(userId: string): GrowthCacheEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const entry = JSON.parse(raw) as GrowthCacheEntry;
    if (
      entry.userId !== userId ||
      !entry.data?.stats ||
      !Array.isArray(entry.data.trackedExpressions)
    ) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeStorageEntry(entry: GrowthCacheEntry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Quota exceeded or private mode — in-memory cache still works.
  }
}

export function readGrowthCache(userId: string): GrowthPageData | null {
  if (cache?.userId === userId) {
    return cache.data;
  }

  const stored = readStorageEntry(userId);
  if (stored) {
    cache = stored;
    return stored.data;
  }

  return null;
}

export function writeGrowthCache(userId: string, data: GrowthPageData): void {
  cache = { userId, data, fetchedAt: Date.now() };
  writeStorageEntry(cache);
}

export function growthCacheAgeMs(userId: string): number | null {
  if (cache?.userId !== userId) {
    return null;
  }
  return Date.now() - cache.fetchedAt;
}

export function invalidateGrowthCache(): void {
  cache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Background refresh interval for the growth page cache. */
export const GROWTH_CACHE_STALE_MS = 60_000;
