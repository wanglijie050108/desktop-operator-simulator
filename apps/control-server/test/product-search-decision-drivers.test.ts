import { describe, expect, it, vi } from "vitest";

import type { DesktopCommand } from "@hos/contracts";

import { AdapterError } from "../src/adapters/adapter-error.js";
import { createProductSearchDecisionDrivers } from "../src/application/product-search-decision-drivers.js";
import {
  createObservationCapture,
  type ObservationCapture,
  type ObservationRequest,
  type RawObservationNode,
} from "../src/domain/observation.js";

const ALLOWED = new Set(["shop.example.com"]);
const REQUEST = { candidateCount: 3, maxPrice: 300, preferences: [], query: "无线鼠标" };
const TREE: RawObservationNode[] = [
  { automationId: "RootWebArea", children: [], controlType: "Window", name: "购物" },
];

function capture(): ObservationCapture {
  return createObservationCapture(TREE, "UIA_TREE", "2026-11-02T00:00:00Z", "driver-key");
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attributes: {},
    collectedAt: "2026-11-02T00:00:00.000Z",
    price: 199,
    rating: null,
    salesText: null,
    shopName: null,
    title: "无线鼠标 A",
    url: "https://shop.example.com/item/1",
    ...overrides,
  };
}

function build(
  options: {
    extract?: (tree: readonly RawObservationNode[]) => readonly unknown[];
    inspect?: (request: ObservationRequest, signal: AbortSignal) => Promise<ObservationCapture>;
  } = {},
) {
  const inspect = vi.fn(options.inspect ?? (() => Promise.resolve(capture())));
  const execute = vi.fn(() => Promise.resolve());
  const handle = createProductSearchDecisionDrivers({
    allowedDomains: ALLOWED,
    commandExecutor: { execute },
    extractCandidates: options.extract ?? (() => [candidate()]),
    observation: { inspect },
    request: REQUEST,
    targetProcessName: "chrome.exe",
    taskId: "66666666-6666-4666-8666-666666666666",
  });
  return { execute, handle, inspect };
}

const SIGNAL = new AbortController().signal;

describe("product search decision drivers", () => {
  it("observes the configured window", async () => {
    const { handle, inspect } = build();

    await handle.drivers.observe(1, SIGNAL);

    expect(inspect).toHaveBeenCalledTimes(1);
    const request = inspect.mock.calls[0]?.[0];
    expect(request?.target.processName).toBe("chrome.exe");
    expect(request?.taskId).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("exposes the captured tree after observing", async () => {
    const { handle } = build();
    expect(handle.lastTree()).toBeUndefined();
    await handle.drivers.observe(1, SIGNAL);
    expect(handle.lastTree()).toHaveLength(1);
  });

  it("has no candidates before the first observation", () => {
    const { handle } = build();
    expect(handle.drivers.collectCandidates(1)).toBeUndefined();
  });

  it("passes verification once the extracted rows are usable", async () => {
    const { handle } = build();
    await handle.drivers.observe(1, SIGNAL);

    await expect(handle.drivers.verify(1, SIGNAL)).resolves.toBe(true);
  });

  it("does not yet pass when the page has no rows", async () => {
    const { handle } = build({ extract: () => [] });
    await handle.drivers.observe(1, SIGNAL);

    await expect(handle.drivers.verify(1, SIGNAL)).resolves.toBe(false);
  });

  it("does not yet pass while every row is over budget", async () => {
    const { handle } = build({ extract: () => [candidate({ price: 9999 })] });
    await handle.drivers.observe(1, SIGNAL);

    // A rendered but unaffordable page must not end the loop as a success.
    await expect(handle.drivers.verify(1, SIGNAL)).resolves.toBe(false);
  });

  it("returns the extracted rows through collectCandidates after verifying", async () => {
    const row = candidate();
    const { handle } = build({ extract: () => [row] });
    await handle.drivers.observe(1, SIGNAL);
    await handle.drivers.verify(1, SIGNAL);

    expect(handle.drivers.collectCandidates(1)).toStrictEqual([row]);
  });

  it("re-reads the tree on every round so a stale picture cannot verify", async () => {
    let round = 0;
    const extract = vi.fn(() => {
      round += 1;
      return round === 1 ? [] : [candidate()];
    });
    const { handle } = build({ extract });

    await handle.drivers.observe(1, SIGNAL);
    expect(await handle.drivers.verify(1, SIGNAL)).toBe(false);

    await handle.drivers.observe(2, SIGNAL);
    expect(await handle.drivers.verify(2, SIGNAL)).toBe(true);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("fails closed when verification runs before any observation", async () => {
    const { handle } = build();
    await expect(handle.drivers.verify(1, SIGNAL)).rejects.toBeInstanceOf(AdapterError);
  });

  it("stops verifying once the task is cancelled", async () => {
    const controller = new AbortController();
    const { handle } = build();
    await handle.drivers.observe(1, controller.signal);
    controller.abort();

    await expect(handle.drivers.verify(1, controller.signal)).rejects.toMatchObject({
      code: "TASK_CANCELLED",
    });
  });

  it("forwards execution to the command executor", async () => {
    const { execute, handle } = build();
    const command = { type: "desktop.command" } as DesktopCommand;

    await handle.drivers.execute(command, SIGNAL);

    expect(execute).toHaveBeenCalledWith(command, SIGNAL);
  });

  it("propagates an observation failure instead of inventing a tree", async () => {
    const { handle } = build({
      inspect: () => Promise.reject(new AdapterError("AGENT_UNAVAILABLE", "offline")),
    });

    await expect(handle.drivers.observe(1, SIGNAL)).rejects.toMatchObject({
      code: "AGENT_UNAVAILABLE",
    });
    expect(handle.lastTree()).toBeUndefined();
  });
});
