/**
 * Pure aggregation logic for the M5 experiment report: closed-loop success rate,
 * duration distribution (including percentiles) and terminal error distribution.
 *
 * The module intentionally consumes plain snapshots rather than infrastructure
 * records so it stays independent of SQLite and Fastify.
 */

export type TaskType = "AI_QUESTION" | "PRODUCT_SEARCH";

export interface TaskSnapshot {
  createdAt: string;
  /** Terminal error code when the run did not succeed. */
  errorCode?: string;
  state: string;
  type: string;
  updatedAt: string;
}

export interface TaskStatisticsFilter {
  from?: string;
  to?: string;
  type?: string;
}

export interface DurationSummary {
  averageMs: number;
  count: number;
  maxMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface ErrorCount {
  code: string;
  count: number;
}

export interface TaskSummary {
  /** Runs that reached SUCCEEDED or FAILED without manual/system intervention. */
  completedCount: number;
  duration: DurationSummary;
  errorDistribution: ErrorCount[];
  failedCount: number;
  stateCounts: Record<string, number>;
  succeededCount: number;
  /** SUCCEEDED / completed; null when no run completed. */
  successRate: number | null;
  terminalCount: number;
  totalCount: number;
}

export interface TaskStatisticsReport {
  byType: Record<TaskType, TaskSummary>;
  generatedAt: string;
  overall: TaskSummary;
  version: string;
}

const TERMINAL_STATES: readonly string[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "INTERRUPTED",
];

const COMPLETED_STATES: readonly string[] = ["SUCCEEDED", "FAILED"];

const TASK_TYPES: readonly TaskType[] = ["AI_QUESTION", "PRODUCT_SEARCH"];

const UNSPECIFIED_ERROR = "UNSPECIFIED";

/** Filters snapshots by task type and inclusive createdAt time window. */
export function selectSnapshots(
  snapshots: readonly TaskSnapshot[],
  filter: TaskStatisticsFilter = {},
): TaskSnapshot[] {
  const fromMs = parseTimestamp(filter.from);
  const toMs = parseTimestamp(filter.to);
  // createdAt validity is only enforced when a window is actually requested, so
  // type-only filtering never discards counters from malformed timestamps.
  const hasWindow = fromMs !== null || toMs !== null;
  return snapshots.filter((snapshot) => {
    if (filter.type !== undefined && snapshot.type !== filter.type) {
      return false;
    }
    if (!hasWindow) {
      return true;
    }
    const createdAtMs = Date.parse(snapshot.createdAt);
    if (Number.isNaN(createdAtMs)) {
      return false;
    }
    if (fromMs !== null && createdAtMs < fromMs) {
      return false;
    }
    if (toMs !== null && createdAtMs > toMs) {
      return false;
    }
    return true;
  });
}

/** Aggregates success, state, duration and error counters for one snapshot group. */
export function summarizeSnapshots(snapshots: readonly TaskSnapshot[]): TaskSummary {
  const stateCounts: Record<string, number> = {};
  const durations: number[] = [];
  const errorCounts = new Map<string, number>();
  let terminalCount = 0;
  let succeededCount = 0;
  let failedCount = 0;

  for (const snapshot of snapshots) {
    stateCounts[snapshot.state] = (stateCounts[snapshot.state] ?? 0) + 1;
    const isTerminal = TERMINAL_STATES.includes(snapshot.state);
    if (isTerminal) {
      terminalCount += 1;
    }
    if (snapshot.state === "SUCCEEDED") {
      succeededCount += 1;
    }
    if (snapshot.state === "FAILED") {
      failedCount += 1;
    }
    if (COMPLETED_STATES.includes(snapshot.state)) {
      const durationMs = durationMillis(snapshot);
      if (durationMs !== null) {
        durations.push(durationMs);
      }
    }
    if (isTerminal && snapshot.state !== "SUCCEEDED") {
      const trimmedCode = snapshot.errorCode?.trim();
      const code =
        trimmedCode === undefined || trimmedCode === "" ? UNSPECIFIED_ERROR : trimmedCode;
      errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);
    }
  }

  const completedCount = succeededCount + failedCount;
  return {
    completedCount,
    duration: summarizeDurations(durations),
    errorDistribution: [...errorCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
    failedCount,
    stateCounts: sortRecord(stateCounts),
    succeededCount,
    successRate: completedCount === 0 ? null : roundRatio(succeededCount / completedCount),
    terminalCount,
    totalCount: snapshots.length,
  };
}

/** Builds the overall report with per-task-type breakdowns. */
export function buildStatisticsReport(
  snapshots: readonly TaskSnapshot[],
  options: { generatedAt: string; version: string },
): TaskStatisticsReport {
  const byType = {} as Record<TaskType, TaskSummary>;
  for (const type of TASK_TYPES) {
    byType[type] = summarizeSnapshots(snapshots.filter((snapshot) => snapshot.type === type));
  }
  return {
    byType,
    generatedAt: options.generatedAt,
    overall: summarizeSnapshots(snapshots),
    version: options.version,
  };
}

function summarizeDurations(durations: readonly number[]): DurationSummary {
  if (durations.length === 0) {
    return { averageMs: 0, count: 0, maxMs: 0, minMs: 0, p50Ms: 0, p95Ms: 0 };
  }
  const sorted = [...durations].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    averageMs: Math.round(total / sorted.length),
    count: sorted.length,
    maxMs: sorted[sorted.length - 1] ?? 0,
    minMs: sorted[0] ?? 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
  };
}

/** Nearest-rank percentile over an ascending, non-empty array. */
function percentile(sortedAscending: readonly number[], percent: number): number {
  const rank = Math.ceil((percent / 100) * sortedAscending.length);
  const index = Math.min(Math.max(rank, 1), sortedAscending.length) - 1;
  return sortedAscending[index] ?? 0;
}

function durationMillis(snapshot: TaskSnapshot): number | null {
  const startedAt = Date.parse(snapshot.createdAt);
  const finishedAt = Date.parse(snapshot.updatedAt);
  if (Number.isNaN(startedAt) || Number.isNaN(finishedAt)) {
    return null;
  }
  return Math.max(0, finishedAt - startedAt);
}

function parseTimestamp(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key] ?? 0;
  }
  return sorted;
}
