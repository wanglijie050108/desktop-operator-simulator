import { AdapterError } from "../adapters/adapter-error.js";
import type { ProductCandidate } from "../adapters/product-search-adapter.js";
import { rankProducts, validateProductCandidates } from "./product-ranking.js";
import type { ProductSearchRequest } from "./product-search-command.js";

/**
 * Deterministic post-condition for a GUI-driven product search (VERIFY-01).
 *
 * The decision loop never treats "the model said it was done" as success. This verifier is
 * the only thing that can end the loop on a positive note, and it answers exactly one
 * question: *can the current screen already produce a ranked reply?* It reuses the same
 * `validateProductCandidates` and `rankProducts` the classic adapter path uses, so the two
 * paths cannot drift into accepting different data.
 *
 * Everything here is synchronous and side-effect free, which is what makes the outcome
 * replayable: the same candidates always produce the same verdict.
 */

export interface ProductVerificationResult {
  /** Products that passed validation and the budget, ranked. Empty when `passed` is false. */
  products: ProductCandidate[];
  /** True only when at least one candidate survived validation and the budget. */
  passed: boolean;
  /** Why verification did not pass; `undefined` when it did. */
  reason?: string;
}

export interface ProductVerificationOptions {
  allowedDomains: ReadonlySet<string>;
  request: ProductSearchRequest;
}

/**
 * Verifies whether `candidates` are good enough to end the loop.
 *
 * A near-miss (no rows yet, rows still loading, a row with a broken link) is reported as
 * "not yet", not as an error: the loop should keep observing. Throwing would end the task,
 * and a page that has simply not finished rendering is not a failure.
 */
export function verifyProductCandidates(
  candidates: readonly unknown[],
  options: ProductVerificationOptions,
): ProductVerificationResult {
  if (candidates.length === 0) {
    return { passed: false, products: [], reason: "NO_CANDIDATES" };
  }

  let validated: ProductCandidate[];
  try {
    validated = validateProductCandidates(candidates, options.allowedDomains);
  } catch (error) {
    // Invalid data is expected mid-loop (a price still animating, a placeholder row).
    return {
      passed: false,
      products: [],
      reason: error instanceof AdapterError ? error.code : "INVALID_PRODUCT_DATA",
    };
  }

  if (validated.length === 0) {
    return { passed: false, products: [], reason: "NO_CANDIDATES" };
  }

  let ranked;
  try {
    ranked = rankProducts(validated, options.request);
  } catch (error) {
    // NO_PRODUCTS_IN_BUDGET is the common case: results exist but none is cheap enough.
    return {
      passed: false,
      products: [],
      reason: error instanceof AdapterError ? error.code : "NO_PRODUCTS_IN_BUDGET",
    };
  }

  if (ranked.length === 0) {
    return { passed: false, products: [], reason: "NO_PRODUCTS_IN_BUDGET" };
  }

  return { passed: true, products: ranked };
}
