import { describe, expect, it } from "vitest";

import type { ProductCandidate } from "../src/adapters/product-search-adapter.js";
import { rankProducts, validateProductCandidates } from "../src/domain/product-ranking.js";

const collectedAt = "2026-09-24T08:00:00.000Z";
const allowedDomains = new Set(["shop.fixture.test"]);

function candidate(overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    attributes: { features: "静音 办公" },
    collectedAt,
    price: 199,
    rating: 4.8,
    salesText: "已售1.2万",
    shopName: "Fixture Store",
    title: "静音办公无线鼠标",
    url: "https://shop.fixture.test/products/mouse-a",
    ...overrides,
  };
}

describe("product candidate validation and ranking", () => {
  it("normalizes valid candidates and preserves structured fields", () => {
    expect(validateProductCandidates([candidate()], allowedDomains)).toStrictEqual([candidate()]);
  });

  it("normalizes extracted text to prevent multiline reply injection", () => {
    expect(
      validateProductCandidates(
        [
          candidate({
            attributes: { features: "静音\n办公" },
            salesText: "已售\n1万",
            shopName: "Fixture\nStore",
            title: "静音\n办公鼠标",
          }),
        ],
        allowedDomains,
      )[0],
    ).toMatchObject({
      attributes: { features: "静音 办公" },
      salesText: "已售 1万",
      shopName: "Fixture Store",
      title: "静音 办公鼠标",
    });
  });

  it.each([
    { price: Number.NaN },
    { rating: 5.1 },
    { collectedAt: "not-a-date" },
    { url: "http://shop.fixture.test/products/mouse-a" },
    { url: "https://user:password@shop.fixture.test/products/mouse-a" },
    { url: "https://untrusted.example/products/mouse-a" },
    { attributes: { features: "" } },
  ])("rejects an invalid adapter candidate", (overrides) => {
    expect(() => validateProductCandidates([candidate(overrides)], allowedDomains)).toThrow(
      expect.objectContaining({ code: "INVALID_PRODUCT_DATA" }),
    );
  });

  it.each([
    null,
    { ...candidate(), title: 42 },
    { ...candidate(), attributes: null },
    { ...candidate(), attributes: { features: 42 } },
  ])("rejects malformed runtime values without throwing a generic type error", (value) => {
    expect(() => validateProductCandidates([value], allowedDomains)).toThrow(
      expect.objectContaining({ code: "INVALID_PRODUCT_DATA" }),
    );
  });

  it("deduplicates candidates by normalized product URL", () => {
    const first = candidate({ title: "First candidate" });
    const duplicate = candidate({ title: "Duplicate candidate" });

    expect(validateProductCandidates([first, duplicate], allowedDomains)).toStrictEqual([first]);
  });

  it("filters over-budget products and ranks deterministically", () => {
    const request = {
      candidateCount: 3,
      maxPrice: 300,
      preferences: ["静音", "办公"],
      query: "无线鼠标",
    };
    const candidates = [
      candidate({
        title: "昂贵鼠标",
        price: 399,
        url: "https://shop.fixture.test/products/over-budget",
      }),
      candidate({
        title: "普通无线鼠标",
        attributes: { features: "游戏" },
        price: 99,
        rating: null,
        salesText: null,
        url: "https://shop.fixture.test/products/basic",
      }),
      candidate(),
      candidate({
        title: "静音无线鼠标 B",
        attributes: { features: "静音" },
        price: 159,
        rating: 4.6,
        salesText: "已售8000",
        url: "https://shop.fixture.test/products/mouse-b",
      }),
    ];

    const first = rankProducts(candidates, request);
    const second = rankProducts([...candidates].reverse(), request);

    expect(first).toStrictEqual(second);
    expect(first).toHaveLength(3);
    expect(first.every((product) => product.price <= request.maxPrice)).toBe(true);
    expect(first.map((product) => product.rank)).toStrictEqual([1, 2, 3]);
    expect(first[0]?.title).toBe("静音办公无线鼠标");
  });

  it("fails closed when no candidate satisfies the budget", () => {
    expect(() =>
      rankProducts([candidate({ price: 301 })], {
        candidateCount: 3,
        maxPrice: 300,
        preferences: [],
        query: "无线鼠标",
      }),
    ).toThrow(expect.objectContaining({ code: "NO_PRODUCTS_IN_BUDGET" }));
  });
});
