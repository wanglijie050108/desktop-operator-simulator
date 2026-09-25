import { describe, expect, it } from "vitest";

import {
  type TaskSnapshot,
  buildStatisticsReport,
  selectSnapshots,
  summarizeSnapshots,
} from "../src/domain/task-statistics.js";

function snapshot(partial: {
  createdAt?: string;
  errorCode?: string;
  state: string;
  type?: string;
  updatedAt?: string;
}): TaskSnapshot {
  const createdAt = partial.createdAt ?? "2026-09-24T10:00:00.000Z";
  return {
    createdAt,
    type: partial.type ?? "AI_QUESTION",
    state: partial.state,
    updatedAt: partial.updatedAt ?? createdAt,
    ...(partial.errorCode === undefined ? {} : { errorCode: partial.errorCode }),
  };
}

describe("summarizeSnapshots", () => {
  it("returns zero counters and null success rate for empty input", () => {
    const summary = summarizeSnapshots([]);

    expect(summary).toMatchObject({
      completedCount: 0,
      failedCount: 0,
      stateCounts: {},
      succeededCount: 0,
      successRate: null,
      terminalCount: 0,
      totalCount: 0,
    });
    expect(summary.duration).toStrictEqual({
      averageMs: 0,
      count: 0,
      maxMs: 0,
      minMs: 0,
      p50Ms: 0,
      p95Ms: 0,
    });
    expect(summary.errorDistribution).toStrictEqual([]);
  });

  it("computes success rate over self-completed runs and keeps intervention states apart", () => {
    const summary = summarizeSnapshots([
      snapshot({ state: "SUCCEEDED", updatedAt: "2026-09-24T10:00:10.000Z" }),
      snapshot({
        createdAt: "2026-09-24T10:01:00.000Z",
        state: "SUCCEEDED",
        updatedAt: "2026-09-24T10:01:30.000Z",
      }),
      snapshot({
        createdAt: "2026-09-24T10:02:00.000Z",
        errorCode: "AI_PAGE_UNAVAILABLE",
        state: "FAILED",
        updatedAt: "2026-09-24T10:02:05.000Z",
      }),
      snapshot({
        createdAt: "2026-09-24T10:03:00.000Z",
        state: "CANCELLED",
        type: "PRODUCT_SEARCH",
        updatedAt: "2026-09-24T10:03:20.000Z",
      }),
      snapshot({
        createdAt: "2026-09-24T10:04:00.000Z",
        errorCode: "RECOVERY_AFTER_RESTART",
        state: "INTERRUPTED",
        type: "PRODUCT_SEARCH",
        updatedAt: "2026-09-24T10:04:15.000Z",
      }),
      snapshot({
        createdAt: "2026-09-24T10:05:00.000Z",
        state: "RUNNING",
        type: "PRODUCT_SEARCH",
      }),
    ]);

    expect(summary.totalCount).toBe(6);
    expect(summary.terminalCount).toBe(5);
    expect(summary.completedCount).toBe(3);
    expect(summary.succeededCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.successRate).toBe(0.6667);
    expect(summary.stateCounts).toStrictEqual({
      CANCELLED: 1,
      FAILED: 1,
      INTERRUPTED: 1,
      RUNNING: 1,
      SUCCEEDED: 2,
    });
  });

  it("summarizes completed-run durations with nearest-rank percentiles", () => {
    const summary = summarizeSnapshots([
      snapshot({ state: "SUCCEEDED", updatedAt: "2026-09-24T10:00:10.000Z" }),
      snapshot({
        createdAt: "2026-09-24T10:01:00.000Z",
        state: "SUCCEEDED",
        updatedAt: "2026-09-24T10:01:30.000Z",
      }),
      snapshot({
        createdAt: "2026-09-24T10:02:00.000Z",
        state: "FAILED",
        updatedAt: "2026-09-24T10:02:05.000Z",
      }),
    ]);

    expect(summary.duration).toStrictEqual({
      averageMs: 15_000,
      count: 3,
      maxMs: 30_000,
      minMs: 5_000,
      p50Ms: 10_000,
      p95Ms: 30_000,
    });
  });

  it("uses nearest-rank percentiles for even sample sizes", () => {
    const summary = summarizeSnapshots(
      [1_000, 2_000, 3_000, 4_000].map((milliseconds, index) =>
        snapshot({
          createdAt: `2026-09-24T10:0${String(index)}:00.000Z`,
          state: "SUCCEEDED",
          updatedAt: `2026-09-24T10:0${String(index)}:0${String(milliseconds / 1000)}.000Z`,
        }),
      ),
    );

    expect(summary.duration.p50Ms).toBe(2_000);
    expect(summary.duration.p95Ms).toBe(4_000);
  });

  it("buckets terminal errors by count then code, falling back to UNSPECIFIED", () => {
    const summary = summarizeSnapshots([
      snapshot({ errorCode: "NETWORK_ERROR", state: "FAILED" }),
      snapshot({ errorCode: "NETWORK_ERROR", state: "FAILED" }),
      snapshot({ errorCode: "TASK_TIMED_OUT", state: "FAILED" }),
      snapshot({ errorCode: "   ", state: "CANCELLED", type: "PRODUCT_SEARCH" }),
      snapshot({ state: "REJECTED" }),
      snapshot({ state: "SUCCEEDED" }),
    ]);

    expect(summary.errorDistribution).toStrictEqual([
      { code: "NETWORK_ERROR", count: 2 },
      { code: "UNSPECIFIED", count: 2 },
      { code: "TASK_TIMED_OUT", count: 1 },
    ]);
  });

  it("does not treat active waiting tasks as terminal or completed", () => {
    const summary = summarizeSnapshots([
      snapshot({ state: "WAITING_FOR_HUMAN" }),
      snapshot({ state: "WAITING_FOR_INPUT", type: "PRODUCT_SEARCH" }),
      snapshot({ state: "PLANNED" }),
      snapshot({ state: "RECEIVED" }),
    ]);

    expect(summary.terminalCount).toBe(0);
    expect(summary.completedCount).toBe(0);
    expect(summary.successRate).toBeNull();
    expect(summary.duration.count).toBe(0);
  });

  it("rounds success ratio to four decimal places", () => {
    const summary = summarizeSnapshots(
      [1, 2, 3].flatMap((value) => [snapshot({ state: value === 1 ? "FAILED" : "SUCCEEDED" })]),
    );

    expect(summary.completedCount).toBe(3);
    expect(summary.successRate).toBe(0.6667);
  });
});

describe("selectSnapshots", () => {
  const fixtures: readonly TaskSnapshot[] = [
    snapshot({ state: "SUCCEEDED" }),
    snapshot({
      createdAt: "2026-09-24T10:01:00.000Z",
      state: "SUCCEEDED",
    }),
    snapshot({
      createdAt: "2026-09-24T10:02:00.000Z",
      state: "FAILED",
    }),
    snapshot({
      createdAt: "2026-09-24T10:03:00.000Z",
      state: "CANCELLED",
      type: "PRODUCT_SEARCH",
    }),
    snapshot({
      createdAt: "2026-09-24T10:04:00.000Z",
      state: "INTERRUPTED",
      type: "PRODUCT_SEARCH",
    }),
  ];

  it("filters by task type", () => {
    const selected = selectSnapshots(fixtures, { type: "PRODUCT_SEARCH" });

    expect(selected).toHaveLength(2);
    expect(selected.every((item) => item.type === "PRODUCT_SEARCH")).toBe(true);
  });

  it("applies an inclusive createdAt window", () => {
    const selected = selectSnapshots(fixtures, {
      from: "2026-09-24T10:02:00.000Z",
      to: "2026-09-24T10:04:00.000Z",
    });

    expect(selected.map((item) => item.createdAt)).toStrictEqual([
      "2026-09-24T10:02:00.000Z",
      "2026-09-24T10:03:00.000Z",
      "2026-09-24T10:04:00.000Z",
    ]);
  });

  it("excludes unparseable timestamps only when a window is requested", () => {
    const invalid = snapshot({ createdAt: "not-a-date", state: "RUNNING" });

    expect(selectSnapshots([invalid], {})).toHaveLength(1);
    expect(selectSnapshots([invalid], { from: "2026-09-24T09:00:00.000Z" })).toHaveLength(0);
  });

  it("ignores invalid boundary strings", () => {
    const selected = selectSnapshots(fixtures, { from: "not-a-date", to: "not-a-date" });

    expect(selected).toHaveLength(5);
  });
});

describe("buildStatisticsReport", () => {
  it("produces overall and per-type summaries with report metadata", () => {
    const report = buildStatisticsReport(
      [
        snapshot({ state: "SUCCEEDED" }),
        snapshot({ errorCode: "NETWORK_ERROR", state: "FAILED" }),
        snapshot({ state: "SUCCEEDED", type: "PRODUCT_SEARCH" }),
      ],
      { generatedAt: "2026-09-24T12:00:00.000Z", version: "9.9.9" },
    );

    expect(report.generatedAt).toBe("2026-09-24T12:00:00.000Z");
    expect(report.version).toBe("9.9.9");
    expect(report.overall.totalCount).toBe(3);
    expect(report.overall.succeededCount).toBe(2);
    expect(report.byType.AI_QUESTION.totalCount).toBe(2);
    expect(report.byType.AI_QUESTION.successRate).toBe(0.5);
    expect(report.byType.PRODUCT_SEARCH.totalCount).toBe(1);
    expect(report.byType.PRODUCT_SEARCH.successRate).toBe(1);
  });

  it("always includes both task types even without data", () => {
    const report = buildStatisticsReport([], {
      generatedAt: "2026-09-24T12:00:00.000Z",
      version: "0.1.0",
    });

    expect(report.byType.AI_QUESTION.totalCount).toBe(0);
    expect(report.byType.PRODUCT_SEARCH.totalCount).toBe(0);
    expect(report.overall.totalCount).toBe(0);
  });

  it("keeps unknown types in overall but outside per-type breakdowns", () => {
    const report = buildStatisticsReport([snapshot({ state: "RUNNING", type: "FUTURE_TYPE" })], {
      generatedAt: "2026-09-24T12:00:00.000Z",
      version: "0.1.0",
    });

    expect(report.overall.totalCount).toBe(1);
    expect(report.byType.AI_QUESTION.totalCount).toBe(0);
    expect(report.byType.PRODUCT_SEARCH.totalCount).toBe(0);
  });
});
