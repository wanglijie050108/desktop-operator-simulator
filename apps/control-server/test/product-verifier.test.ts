import { describe, expect, it } from "vitest";

import { verifyProductCandidates } from "../src/domain/product-verifier.js";

const ALLOWED = new Set(["shop.example.com"]);
const REQUEST = {
  candidateCount: 3,
  maxPrice: 300,
  preferences: [],
  query: "无线鼠标",
};

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attributes: {},
    collectedAt: "2026-11-02T00:00:00.000Z",
    price: 199,
    rating: 4.8,
    salesText: null,
    shopName: null,
    title: "无线鼠标 A",
    url: "https://shop.example.com/item/1",
    ...overrides,
  };
}

describe("product verifier (VERIFY-01)", () => {
  it("passes when a candidate survives validation and the budget", () => {
    const result = verifyProductCandidates([candidate()], {
      allowedDomains: ALLOWED,
      request: REQUEST,
    });

    expect(result.passed).toBe(true);
    expect(result.products).toHaveLength(1);
    expect(result.reason).toBeUndefined();
  });

  it("does not yet pass on an empty screen", () => {
    const result = verifyProductCandidates([], { allowedDomains: ALLOWED, request: REQUEST });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("NO_CANDIDATES");
  });

  it("does not yet pass when every result is over budget", () => {
    const result = verifyProductCandidates([candidate({ price: 999 })], {
      allowedDomains: ALLOWED,
      request: REQUEST,
    });
    // The page rendered real results; it just has nothing the user can afford.
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("NO_PRODUCTS_IN_BUDGET");
  });

  it("does not yet pass on a row whose fields are still invalid", () => {
    const result = verifyProductCandidates([candidate({ title: "   " })], {
      allowedDomains: ALLOWED,
      request: REQUEST,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("INVALID_PRODUCT_DATA");
  });

  it("rejects a candidate from a domain outside the allowlist", () => {
    const result = verifyProductCandidates([candidate({ url: "https://evil.test/item/1" })], {
      allowedDomains: ALLOWED,
      request: REQUEST,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("INVALID_PRODUCT_DATA");
  });

  it("rejects a non-https link", () => {
    const result = verifyProductCandidates([candidate({ url: "http://shop.example.com/item/1" })], {
      allowedDomains: ALLOWED,
      request: REQUEST,
    });
    expect(result.passed).toBe(false);
  });

  it("rejects a non-object entry without throwing", () => {
    const result = verifyProductCandidates(["not a row"], {
      allowedDomains: ALLOWED,
      request: REQUEST,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("INVALID_PRODUCT_DATA");
  });

  it("passes as soon as one of several candidates is usable", () => {
    const result = verifyProductCandidates(
      [
        candidate({ price: 999 }),
        candidate({ url: "https://shop.example.com/item/2", title: "B" }),
      ],
      { allowedDomains: ALLOWED, request: REQUEST },
    );
    // Over-budget rows are filtered by rankProducts, not treated as invalid.
    expect(result.passed).toBe(true);
  });

  it("is deterministic: the same input always yields the same verdict", () => {
    const input = [candidate(), candidate({ url: "https://shop.example.com/item/2", title: "B" })];
    const first = verifyProductCandidates(input, { allowedDomains: ALLOWED, request: REQUEST });
    const second = verifyProductCandidates(input, { allowedDomains: ALLOWED, request: REQUEST });
    expect(first).toStrictEqual(second);
  });

  it("does not mutate the candidates it was given", () => {
    const input = candidate();
    const snapshot = structuredClone(input);
    verifyProductCandidates([input], { allowedDomains: ALLOWED, request: REQUEST });
    expect(input).toStrictEqual(snapshot);
  });

  it("returns ranked products, not just a boolean, so the caller can reply", () => {
    const result = verifyProductCandidates([candidate()], {
      allowedDomains: ALLOWED,
      request: REQUEST,
    });
    expect(result.products[0]).toMatchObject({ rank: 1, title: "无线鼠标 A" });
  });
});
