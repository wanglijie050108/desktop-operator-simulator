import { describe, expect, it } from "vitest";

import { extractProductRows } from "../src/adapters/product-row-extractor.js";
import type { RawObservationNode } from "../src/domain/observation.js";

/**
 * These tests pin the heuristic's *contract*, not its real-world accuracy. The extractor has
 * never been run against a live storefront; what is verified here is that it produces rows
 * the verifier can judge, and that it degrades to "no rows" rather than to a wrong price.
 */

const REQUEST = { candidateCount: 3, maxPrice: 300, preferences: [], query: "无线鼠标" };
const COLLECTED_AT = "2026-11-02T00:00:00.000Z";
const OPTIONS = { baseUrl: "https://shop.example.com/search", collectedAt: COLLECTED_AT };

function row(name: string, children: RawObservationNode[] = []): RawObservationNode {
  return { children, controlType: "ListItem", name };
}

function grid(rows: RawObservationNode[]): RawObservationNode[] {
  return [{ children: rows, controlType: "List", name: "搜索结果" }];
}

describe("product row extractor (heuristic)", () => {
  it("extracts one row per priced item", () => {
    const rows = extractProductRows(
      grid([row("无线鼠标 A ￥199"), row("无线鼠标 B ￥259"), row("无线鼠标 C ￥999")]),
      REQUEST,
      OPTIONS,
    );

    expect(rows).toHaveLength(3);
    expect(rows.map((entry) => entry.price)).toStrictEqual([199, 259, 999]);
    expect(rows[0]?.title).toContain("无线鼠标 A");
  });

  it("ignores nodes that carry no price", () => {
    const rows = extractProductRows(
      grid([row("无线鼠标 A ￥199"), { controlType: "Text", name: "加载更多" }]),
      REQUEST,
      OPTIONS,
    );
    expect(rows).toHaveLength(1);
  });

  it("parses prices with a fraction, comma and the 元 suffix", () => {
    const rows = extractProductRows(
      grid([row("商品 ￥1,299.50"), row("商品 B 259元")]),
      REQUEST,
      OPTIONS,
    );
    expect(rows[0]?.price).toBe(1299.5);
    expect(rows[1]?.price).toBe(259);
  });

  it("descends into a grid instead of treating it as one giant row", () => {
    const rows = extractProductRows(grid([row("A ￥199"), row("B ￥299")]), REQUEST, OPTIONS);
    // The grid itself contains prices, but its children each contain one: the row must be
    // the child, otherwise two products collapse into one candidate.
    expect(rows).toHaveLength(2);
  });

  it("captures sales text and shop name when present", () => {
    const rows = extractProductRows(
      [
        {
          children: [row("无线鼠标 ￥199 已售 1.2万 店铺：某某旗舰店")],
          controlType: "List",
          name: "r",
        },
      ],
      REQUEST,
      OPTIONS,
    );
    expect(rows[0]?.salesText).toBe("1.2万");
    expect(rows[0]?.shopName).toContain("旗舰店");
  });

  it("falls back to the configured base url when a row has no link", () => {
    const rows = extractProductRows(grid([row("无线鼠标 ￥199")]), REQUEST, OPTIONS);
    expect(rows[0]?.url).toBe("https://shop.example.com/search");
  });

  it("uses a hyperlink target when UIA exposes one", () => {
    const rows = extractProductRows(
      grid([
        row("无线鼠标 ￥199", [
          {
            automationId: "https://shop.example.com/item/9",
            controlType: "Hyperlink",
            name: "详情",
          },
        ]),
      ]),
      REQUEST,
      OPTIONS,
    );
    expect(rows[0]?.url).toBe("https://shop.example.com/item/9");
  });

  it("stamps every row with the injected collection time", () => {
    const rows = extractProductRows(grid([row("A ￥199")]), REQUEST, OPTIONS);
    expect(rows[0]?.collectedAt).toBe(COLLECTED_AT);
  });

  it("de-duplicates identical title and price pairs", () => {
    const rows = extractProductRows(grid([row("A ￥199"), row("A ￥199")]), REQUEST, OPTIONS);
    expect(rows).toHaveLength(1);
  });

  it("caps the row count so one page cannot flood the trace", () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      row(`商品 ${String(index)} ￥${String(100 + index)}`),
    );
    const rows = extractProductRows(grid(many), REQUEST, OPTIONS);
    expect(rows).toHaveLength(100);
  });

  it("returns nothing for a tree with no prices", () => {
    const rows = extractProductRows(
      [
        {
          controlType: "Window",
          name: "购物 - Chrome",
          children: [{ controlType: "Edit", name: "搜索" }],
        },
      ],
      REQUEST,
      OPTIONS,
    );
    expect(rows).toStrictEqual([]);
  });

  it("never invents a positive price from unparsable text", () => {
    const rows = extractProductRows(grid([row("面议")]), REQUEST, OPTIONS);
    // "面议" has no number at all, so no row is produced rather than a 0 price being made up.
    expect(rows).toStrictEqual([]);
  });
});
