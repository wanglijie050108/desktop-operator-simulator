import { AdapterError } from "../adapters/adapter-error.js";
import type { ProductCandidate } from "../adapters/product-search-adapter.js";
import type { ProductSearchRequest } from "./product-search-command.js";

export interface RankedProduct extends ProductCandidate {
  rank: number;
  score: number;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseSalesCount(salesText: string | null): number | undefined {
  if (salesText === null) {
    return undefined;
  }
  const match = /(\d+(?:\.\d+)?)\s*(万)?/u.exec(salesText.replaceAll(",", ""));
  if (match?.[1] === undefined) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value * (match[2] === undefined ? 1 : 10_000) : undefined;
}

function preferenceScore(candidate: ProductCandidate, preferences: readonly string[]): number {
  if (preferences.length === 0) {
    return 0.5;
  }
  const searchable = [candidate.title, ...Object.values(candidate.attributes)]
    .join(" ")
    .toLocaleLowerCase("zh-CN");
  const matches = preferences.filter((preference) =>
    searchable.includes(preference.toLocaleLowerCase("zh-CN")),
  ).length;
  return matches / preferences.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function parseAttributes(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  const normalized: Record<string, string> = {};
  for (const [key, attribute] of entries) {
    if (
      key.trim().length === 0 ||
      key.length > 100 ||
      typeof attribute !== "string" ||
      attribute.trim().length === 0 ||
      attribute.length > 200
    ) {
      return undefined;
    }
    normalized[key.trim()] = normalizeText(attribute);
  }
  return normalized;
}

export function validateProductCandidates(
  candidates: readonly unknown[],
  allowedDomains: ReadonlySet<string>,
): ProductCandidate[] {
  const uniqueCandidates = new Map<string, ProductCandidate>();
  for (const value of candidates) {
    if (!isRecord(value)) {
      throw new AdapterError("INVALID_PRODUCT_DATA", "Product candidate must be an object");
    }
    const {
      attributes: rawAttributes,
      collectedAt,
      price,
      rating,
      salesText,
      shopName,
      title,
      url: rawUrl,
    } = value;
    const attributes = parseAttributes(rawAttributes);
    if (
      typeof title !== "string" ||
      typeof price !== "number" ||
      (shopName !== null && typeof shopName !== "string") ||
      (rating !== null && typeof rating !== "number") ||
      (salesText !== null && typeof salesText !== "string") ||
      typeof rawUrl !== "string" ||
      typeof collectedAt !== "string" ||
      attributes === undefined
    ) {
      throw new AdapterError(
        "INVALID_PRODUCT_DATA",
        "Product adapter returned invalid field types",
      );
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new AdapterError("INVALID_PRODUCT_DATA", "Product URL is invalid");
    }

    const domainAllowed = [...allowedDomains].some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
    const collectedAtDate = new Date(collectedAt);
    if (
      title.trim().length === 0 ||
      title.length > 200 ||
      !Number.isFinite(price) ||
      price <= 0 ||
      price > 1_000_000 ||
      (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) ||
      (shopName !== null && (shopName.trim().length === 0 || shopName.length > 100)) ||
      (salesText !== null && salesText.length > 100) ||
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      !domainAllowed ||
      Number.isNaN(collectedAtDate.getTime()) ||
      collectedAtDate.toISOString() !== collectedAt
    ) {
      throw new AdapterError(
        "INVALID_PRODUCT_DATA",
        "Product adapter returned an invalid candidate",
      );
    }

    const normalizedCandidate: ProductCandidate = {
      attributes,
      collectedAt,
      price,
      rating,
      salesText: salesText === null ? null : normalizeText(salesText),
      shopName: shopName === null ? null : normalizeText(shopName),
      title: normalizeText(title),
      url: url.toString(),
    };
    if (!uniqueCandidates.has(normalizedCandidate.url)) {
      uniqueCandidates.set(normalizedCandidate.url, normalizedCandidate);
    }
  }
  return [...uniqueCandidates.values()];
}

export function rankProducts(
  candidates: readonly ProductCandidate[],
  request: ProductSearchRequest,
): RankedProduct[] {
  const withinBudget = candidates.filter((candidate) => candidate.price <= request.maxPrice);
  if (withinBudget.length === 0) {
    throw new AdapterError("NO_PRODUCTS_IN_BUDGET", "No valid products satisfy the budget");
  }

  const salesCounts = withinBudget.map((candidate) => parseSalesCount(candidate.salesText));
  const maximumSales = Math.max(0, ...salesCounts.map((count) => count ?? 0));
  return withinBudget
    .map((candidate, index) => {
      const ratingScore = candidate.rating === null ? 0.5 : clamp(candidate.rating / 5);
      const salesCount = salesCounts[index];
      const salesScore =
        salesCount === undefined || maximumSales === 0 ? 0.5 : clamp(salesCount / maximumSales);
      const priceScore = clamp(1 - candidate.price / request.maxPrice);
      const score =
        0.35 * preferenceScore(candidate, request.preferences) +
        0.25 * ratingScore +
        0.2 * salesScore +
        0.2 * priceScore;
      return { ...candidate, rank: 0, score: Number(score.toFixed(4)) };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.price - right.price ||
        left.title.localeCompare(right.title, "zh-CN") ||
        left.url.localeCompare(right.url),
    )
    .slice(0, request.candidateCount)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
