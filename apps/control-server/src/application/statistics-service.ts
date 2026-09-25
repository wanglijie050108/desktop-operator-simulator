import {
  type TaskSnapshot,
  type TaskStatisticsFilter,
  buildStatisticsReport,
  selectSnapshots,
} from "../domain/task-statistics.js";
import type { TaskRecord } from "../infrastructure/database/task-repository.js";

/** Read side needed to collect experiment statistics. */
export interface TaskListSource {
  list(): readonly TaskRecord[];
}

/**
 * Produces the M5 experiment report from persisted tasks. Persistence records
 * are reduced to plain snapshots before entering the pure statistics domain.
 */
export class StatisticsService {
  public constructor(private readonly taskSource: TaskListSource) {}

  public buildReport(
    filter: TaskStatisticsFilter,
    options: { generatedAt: string; version: string },
  ) {
    const snapshots = this.taskSource.list().map(toSnapshot);
    return buildStatisticsReport(selectSnapshots(snapshots, filter), options);
  }
}

function toSnapshot(task: TaskRecord): TaskSnapshot {
  const errorCode = errorCodeFromResult(task.result);
  return {
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    state: task.state,
    type: task.type,
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function errorCodeFromResult(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) {
    return undefined;
  }
  if (!("errorCode" in result)) {
    return undefined;
  }
  const code: unknown = result.errorCode;
  return typeof code === "string" && code.trim() !== "" ? code : undefined;
}
