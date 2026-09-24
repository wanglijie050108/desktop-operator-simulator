import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactCleanupService } from "../src/application/artifact-cleanup.js";
import { selectArtifactsForRemoval } from "../src/domain/artifact-retention.js";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function entry(name: string, createdAt: string, sizeBytes = 100) {
  return { createdAt, name, sizeBytes };
}

describe("selectArtifactsForRemoval", () => {
  it("expires files older than the age limit", () => {
    const entries = [
      entry("old.png", "2026-09-16T12:00:00.000Z"),
      entry("new.png", "2026-09-18T12:00:00.000Z"),
    ];

    expect(
      selectArtifactsForRemoval(entries, { maxAgeDays: 7, maxTotalBytes: 10_000 }, NOW),
    ).toEqual(["old.png"]);
  });

  it("removes oldest files first when over the size budget", () => {
    const entries = [
      entry("a.png", "2026-09-23T12:00:00.000Z", 100),
      entry("b.png", "2026-09-22T12:00:00.000Z", 100),
      entry("c.png", "2026-09-21T12:00:00.000Z", 100),
    ];

    // Selection is oldest-first (c then b); the result is returned name-sorted for
    // deterministic deletion batches.
    expect(selectArtifactsForRemoval(entries, { maxAgeDays: 7, maxTotalBytes: 150 }, NOW)).toEqual([
      "b.png",
      "c.png",
    ]);
  });

  it("keeps every file when within the size budget", () => {
    const entries = [entry("a.png", "2026-09-23T12:00:00.000Z", 50)];
    expect(selectArtifactsForRemoval(entries, { maxAgeDays: 7, maxTotalBytes: 100 }, NOW)).toEqual(
      [],
    );
  });

  it("applies age expiry before size eviction", () => {
    const entries = [
      entry("expired.png", "2026-09-01T12:00:00.000Z", 5),
      entry("recent.png", "2026-09-23T12:00:00.000Z", 100),
    ];

    // Expired file is removed by age; the survivor fits the small budget on its own.
    expect(selectArtifactsForRemoval(entries, { maxAgeDays: 7, maxTotalBytes: 100 }, NOW)).toEqual([
      "expired.png",
    ]);
  });

  it("rejects invalid policy configuration", () => {
    expect(() =>
      selectArtifactsForRemoval([], { maxAgeDays: 0, maxTotalBytes: 100 }, NOW),
    ).toThrow();
    expect(() =>
      selectArtifactsForRemoval([], { maxAgeDays: 7, maxTotalBytes: -1 }, NOW),
    ).toThrow();
  });
});

describe("ArtifactCleanupService", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "artifact-cleanup-"));
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("deletes expired files from the artifact directory", async () => {
    const expired = join(directory, "old.png");
    const recent = join(directory, "new.png");
    await writeFile(expired, "old-data");
    await writeFile(recent, "new-data");
    await utimes(
      expired,
      new Date("2026-09-16T12:00:00.000Z"),
      new Date("2026-09-16T12:00:00.000Z"),
    );
    await utimes(
      recent,
      new Date("2026-09-23T12:00:00.000Z"),
      new Date("2026-09-23T12:00:00.000Z"),
    );

    const service = new ArtifactCleanupService({
      directory,
      intervalMs: 60_000,
      maxAgeDays: 7,
      maxTotalBytes: 10_000,
      now: () => NOW,
    });
    const removed = await service.runOnce();

    expect(removed).toBe(1);
    await expect(stat(expired)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(recent)).isFile()).toBe(true);
  });

  it("returns zero when the directory does not exist", async () => {
    const service = new ArtifactCleanupService({
      directory: join(directory, "missing"),
      intervalMs: 60_000,
    });
    expect(await service.runOnce()).toBe(0);
  });

  it("rejects an empty artifact directory", () => {
    expect(() => new ArtifactCleanupService({ directory: " ", intervalMs: 60_000 })).toThrow(
      "Artifact directory must not be empty",
    );
  });

  it("rejects cleanup intervals below ten seconds", () => {
    expect(() => new ArtifactCleanupService({ directory, intervalMs: 1_000 })).toThrow(
      "Artifact cleanup interval must be at least 10000ms",
    );
  });

  it("starts at most one timer and allows closing it", () => {
    const service = new ArtifactCleanupService({
      directory,
      intervalMs: 60_000,
    });

    expect(() => {
      service.start();
      service.start();
      service.close();
      service.close();
    }).not.toThrow();
  });

  it("rethrows directory errors other than ENOENT", async () => {
    const filePath = join(directory, "regular-file");
    await writeFile(filePath, "data");

    const service = new ArtifactCleanupService({
      directory: filePath,
      intervalMs: 60_000,
    });

    await expect(service.runOnce()).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});
