import { readdir, stat, unlink } from "node:fs/promises";

import {
  selectArtifactsForRemoval,
  type ArtifactRetentionPolicy,
} from "../domain/artifact-retention.js";

export interface ArtifactCleanupOptions extends Partial<ArtifactRetentionPolicy> {
  directory: string;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Periodically removes expired screenshots and traces. The service is deliberately
 * scope-limited to the configured artifact directory and never follows subdirectories.
 */
export class ArtifactCleanupService {
  private readonly directory: string;
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly policy: ArtifactRetentionPolicy;
  private timer: NodeJS.Timeout | null = null;

  public constructor(options: ArtifactCleanupOptions) {
    this.directory = options.directory;
    this.intervalMs = options.intervalMs ?? 3_600_000;
    this.now = options.now ?? (() => new Date());
    this.policy = {
      maxAgeDays: options.maxAgeDays ?? 7,
      maxTotalBytes: options.maxTotalBytes ?? 500 * 1024 * 1024,
    };

    if (this.directory.trim().length === 0) {
      throw new Error("Artifact directory must not be empty");
    }
    if (this.intervalMs < 10_000) {
      throw new Error("Artifact cleanup interval must be at least 10000ms");
    }
  }

  public start(): void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        void this.runOnce();
      }, this.intervalMs);
      this.timer.unref();
    }
  }

  public close(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async runOnce(): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      // A missing artifact directory is normal before the first real run.
      if (isMissingEntry(error)) {
        return 0;
      }
      throw error;
    }

    const entries = [];
    for (const name of names) {
      const fileStat = await stat(`${this.directory}/${name}`);
      if (fileStat.isFile()) {
        entries.push({
          createdAt: fileStat.mtime.toISOString(),
          name,
          sizeBytes: fileStat.size,
        });
      }
    }

    let removed = 0;
    for (const name of selectArtifactsForRemoval(entries, this.policy, this.now())) {
      await unlink(`${this.directory}/${name}`);
      removed += 1;
    }
    return removed;
  }
}

function isMissingEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
