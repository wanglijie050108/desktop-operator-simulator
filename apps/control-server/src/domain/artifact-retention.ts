export interface ArtifactEntry {
  createdAt: string;
  name: string;
  sizeBytes: number;
}

export interface ArtifactRetentionPolicy {
  /** Files older than this are removed regardless of total size. */
  maxAgeDays: number;
  /** Total size budget shared by the remaining files. */
  maxTotalBytes: number;
}

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Deterministically selects files to remove:
 * 1. Every file older than maxAgeDays is expired.
 * 2. If the surviving files still exceed the total size budget, the oldest files are
 *    removed first (ties resolved by name) until the budget is met.
 */
export function selectArtifactsForRemoval(
  entries: readonly ArtifactEntry[],
  policy: ArtifactRetentionPolicy,
  now: Date,
): string[] {
  if (policy.maxAgeDays <= 0) {
    throw new Error("maxAgeDays must be positive");
  }
  if (policy.maxTotalBytes < 0) {
    throw new Error("maxTotalBytes must not be negative");
  }

  const ageCutoff = now.getTime() - policy.maxAgeDays * MILLISECONDS_PER_DAY;
  const removed = new Set<string>();
  const survivors: ArtifactEntry[] = [];

  for (const entry of entries) {
    if (Date.parse(entry.createdAt) <= ageCutoff) {
      removed.add(entry.name);
    } else {
      survivors.push(entry);
    }
  }

  let totalBytes = survivors.reduce((total, entry) => total + entry.sizeBytes, 0);
  if (totalBytes <= policy.maxTotalBytes) {
    return [...removed].sort();
  }

  const oldestFirst = [...survivors].sort(compareOldestFirst);
  for (const entry of oldestFirst) {
    removed.add(entry.name);
    totalBytes -= entry.sizeBytes;
    if (totalBytes <= policy.maxTotalBytes) {
      break;
    }
  }

  return [...removed].sort();
}

function compareOldestFirst(a: ArtifactEntry, b: ArtifactEntry): number {
  const byAge = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return byAge !== 0 ? byAge : a.name.localeCompare(b.name);
}
