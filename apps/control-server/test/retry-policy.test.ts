import { describe, expect, it, vi } from "vitest";

import { AdapterError } from "../src/adapters/adapter-error.js";
import { RetryPolicy } from "../src/domain/retry-policy.js";

describe("RetryPolicy", () => {
  it("returns the result of the first successful attempt", async () => {
    const policy = new RetryPolicy({ sleep: () => Promise.resolve() });
    const operation = vi.fn(() => Promise.resolve("ok"));

    await expect(policy.execute("ai.ask", operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("retries a transient failure and then succeeds", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const onRetry = vi.fn();
    const policy = new RetryPolicy({ baseDelayMs: 100, onRetry, sleep });
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new AdapterError("NETWORK_ERROR", "offline"))
      .mockResolvedValueOnce("ok");

    await expect(policy.execute("ai.ask", operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
    expect(onRetry).toHaveBeenCalledWith("ai.ask", 2, 100, expect.any(AdapterError));
  });

  it("uses exponential backoff across attempts", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const policy = new RetryPolicy({ baseDelayMs: 100, maxAttempts: 3, sleep });
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new AdapterError("ADAPTER_TIMEOUT", "slow"))
      .mockRejectedValueOnce(new AdapterError("TEMPORARY_UNAVAILABLE", "busy"))
      .mockResolvedValueOnce("ok");

    await policy.execute("product.search", operation);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it("does not retry non-transient errors", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const policy = new RetryPolicy({ sleep });
    const operation = vi.fn().mockRejectedValueOnce(new AdapterError("LOGIN_REQUIRED", "login"));

    await expect(policy.execute("ai.ask", operation)).rejects.toBeInstanceOf(AdapterError);
    expect(operation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry plain errors", async () => {
    const policy = new RetryPolicy({ sleep: () => Promise.resolve() });
    const operation = vi.fn().mockRejectedValueOnce(new Error("boom"));

    await expect(policy.execute("ai.ask", operation)).rejects.toThrow("boom");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("rethrows the last error when attempts are exhausted", async () => {
    const policy = new RetryPolicy({ maxAttempts: 2, sleep: () => Promise.resolve() });
    const error = new AdapterError("NETWORK_ERROR", "offline");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(policy.execute("ai.ask", operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("rejects operations outside the retry allowlist", async () => {
    const policy = new RetryPolicy();
    await expect(policy.execute("chat.send", () => Promise.resolve("ok"))).rejects.toThrow(
      "not allowed to auto-retry",
    );
  });

  it("rejects invalid configuration", () => {
    expect(() => new RetryPolicy({ maxAttempts: 0 })).toThrow();
    expect(() => new RetryPolicy({ baseDelayMs: -1 })).toThrow();
  });
});
