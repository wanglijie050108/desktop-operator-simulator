import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_OBSERVATION_NODES,
  PRODUCT_LISTING_MAX_OBSERVATION_NODES,
  rebuildTree,
  redactNodeName,
  summarizeTree,
  type RawObservationNode,
} from "../src/domain/observation.js";

const KEY = "unit-test-redaction-key";

describe("observation layer", () => {
  it("redacts node names to a stable HMAC token and never leaks the label", () => {
    const tokenA = redactNodeName("搜索框", KEY);
    expect(tokenA).not.toContain("搜索框");
    expect(tokenA).toMatch(/^node:[0-9a-f]{16}$/u);
    // Same label -> same token (stable for replay/dedup); different label -> different.
    expect(redactNodeName("搜索框", KEY)).toBe(tokenA);
    expect(redactNodeName("购物车", KEY)).not.toBe(tokenA);
  });

  it("keeps controlType/automationId/boundingBox but drops raw names in the summary", () => {
    const tree: RawObservationNode[] = [
      {
        automationId: "search-btn",
        boundingBox: { height: 30, width: 80, x: 10, y: 20 },
        controlType: "Button",
        name: "搜索",
      },
    ];
    const summary = summarizeTree(tree, "UIA_TREE", "2026-10-23T00:00:00Z", KEY);
    expect(summary.redactedNodes[0]).toStrictEqual({
      automationId: "search-btn",
      boundingBox: { height: 30, width: 80, x: 10, y: 20 },
      controlType: "Button",
      nameToken: redactNodeName("搜索", KEY),
    });
    expect(JSON.stringify(summary)).not.toContain("搜索");
  });

  it("sets truncated=true and reports full nodeCount when the tree exceeds maxNodes", () => {
    const deep: RawObservationNode = {
      controlType: "Pane",
      name: "root",
      children: Array.from({ length: 5 }, (_, index) => ({
        controlType: "Pane",
        name: `child-${String(index)}`,
        children: Array.from({ length: 5 }, (__, inner) => ({
          controlType: "Pane",
          name: `leaf-${String(index)}-${String(inner)}`,
        })),
      })),
    };
    const summary = summarizeTree([deep], "UIA_TREE", "2026-10-23T00:00:00Z", KEY, 7);
    expect(summary.nodeCount).toBe(31); // 1 + 5*(1 + 5)
    expect(summary.truncated).toBe(true);
    expect(summary.redactedNodes.length).toBeLessThan(31);
  });

  it("is not silent when exactly at the node limit", () => {
    const tree: RawObservationNode[] = Array.from({ length: 3 }, (_, index) => ({
      controlType: "Pane",
      name: `n-${String(index)}`,
    }));
    const summary = summarizeTree(tree, "UIA_TREE", "2026-10-23T00:00:00Z", KEY, 3);
    expect(summary.truncated).toBe(false);
    expect(summary.redactedNodes).toHaveLength(3);
  });
});

describe("listing-page node budget", () => {
  it("caps a large product grid far below the default budget", () => {
    // A results page whose grid exposes far more rows than we are willing to send.
    // Ten times the listing budget: an unfiltered grid, which is the documented real case.
    const rows = Array.from({ length: 4_000 }, (_, index) => ({
      controlType: "ListItem",
      name: `商品 ${String(index)}`,
    }));
    const grid: RawObservationNode = { controlType: "List", name: "结果", children: rows };

    const summary = summarizeTree(
      [grid],
      "UIA_TREE",
      "2026-10-24T00:00:00Z",
      KEY,
      PRODUCT_LISTING_MAX_OBSERVATION_NODES,
    );

    expect(PRODUCT_LISTING_MAX_OBSERVATION_NODES).toBeLessThan(DEFAULT_MAX_OBSERVATION_NODES);
    expect(summary.truncated).toBe(true);
    expect(summary.nodeCount).toBe(4_001); // grid + rows, measured before truncation
    // Truncation must actually stop the walk, not merely re-label a complete tree.
    expect(JSON.stringify(summary.redactedNodes).length).toBeLessThan(200_000);
  });

  it("leaves a small results page complete and unflagged", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      controlType: "ListItem",
      name: `商品 ${String(index)}`,
    }));
    const summary = summarizeTree(
      [{ controlType: "List", name: "结果", children: rows }],
      "UIA_TREE",
      "2026-10-24T00:00:00Z",
      KEY,
      PRODUCT_LISTING_MAX_OBSERVATION_NODES,
    );
    expect(summary.truncated).toBe(false);
  });
});

describe("flat Agent payload reconstruction", () => {
  it("rebuilds nesting from depth-annotated nodes", () => {
    const tree = rebuildTree([
      {
        depth: 0,
        controlType: "Window",
        automationId: "Main",
        name: "root",
        enabled: true,
        visible: true,
      },
      {
        depth: 1,
        controlType: "Button",
        automationId: "search",
        name: "搜索",
        enabled: true,
        visible: true,
      },
      {
        depth: 1,
        controlType: "List",
        automationId: "",
        name: "结果",
        enabled: true,
        visible: true,
      },
      {
        depth: 2,
        controlType: "ListItem",
        automationId: "",
        name: "row",
        enabled: true,
        visible: true,
      },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.controlType).toBe("Window");
    expect(tree[0]?.children).toHaveLength(2);
    expect(tree[0]?.children?.[1]?.children?.[0]?.controlType).toBe("ListItem");
  });

  it("keeps nodes whose parent was dropped instead of losing them", () => {
    // The Agent truncated the tree, so depth jumps from 0 to 2.
    const tree = rebuildTree([
      {
        depth: 0,
        controlType: "Window",
        automationId: "",
        name: "root",
        enabled: true,
        visible: true,
      },
      {
        depth: 2,
        controlType: "Text",
        automationId: "",
        name: "orphan",
        enabled: true,
        visible: true,
      },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.children?.[0]?.controlType).toBe("Text");
  });

  it("drops empty automation ids and names rather than emitting blank strings", () => {
    const tree = rebuildTree([
      { depth: 0, controlType: "Pane", automationId: "", name: "", enabled: true, visible: true },
    ]);
    expect(tree[0]).toStrictEqual({ controlType: "Pane" });
  });

  it("routes a rebuilt tree through redaction without leaking labels", () => {
    const tree = rebuildTree([
      {
        depth: 0,
        controlType: "Window",
        automationId: "",
        name: "购物车",
        enabled: true,
        visible: true,
      },
    ]);
    const summary = summarizeTree(tree, "UIA_TREE", "2026-10-24T00:00:00Z", KEY);
    expect(JSON.stringify(summary)).not.toContain("购物车");
    expect(summary.redactedNodes[0]?.nameToken).toMatch(/^node:[0-9a-f]{16}$/u);
  });
});

describe("character hygiene fixtures from real UIA behaviour", () => {
  const CAPTURED_AT = "2026-10-24T00:00:00Z";

  it("keeps an emoji product name usable as a redaction input", () => {
    // The Python Agent repairs lone surrogates before sending; a valid emoji must still
    // redact to a single stable token rather than splitting into two.
    const summary = summarizeTree(
      [{ controlType: "Text", name: "😀 优惠价" }],
      "UIA_TREE",
      CAPTURED_AT,
      KEY,
    );
    expect(summary.redactedNodes[0]?.nameToken).toBe(redactNodeName("😀 优惠价", KEY));
  });

  it("is stable when the same sanitized label arrives twice", () => {
    const tree: RawObservationNode[] = [
      { controlType: "Text", name: "搜索结果" },
      { controlType: "Text", name: "搜索结果" },
    ];
    const summary = summarizeTree(tree, "UIA_TREE", CAPTURED_AT, KEY);
    expect(summary.redactedNodes[0]?.nameToken).toBe(summary.redactedNodes[1]?.nameToken);
  });
});
