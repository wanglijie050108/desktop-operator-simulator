import type { RawObservationNode } from "../domain/observation.js";
import type { ProductSearchRequest } from "../domain/product-search-command.js";

/**
 * Heuristic extractor: control tree -> raw product rows (VERIFY-01 input).
 *
 * **This is a starting point, not a calibrated site adapter.** It was written against the
 * shape of a generic search-results grid and has never been run against a live storefront,
 * so treat its success rate as unknown until `docs/07` validation happens. The output is
 * deliberately *raw*: it is fed to `verifyProductCandidates`, which applies the same strict
 * field, domain and budget checks the classic adapter path uses. A wrong guess therefore
 * produces "not yet" rather than a bad reply.
 *
 * The approach: a row is the smallest subtree whose combined text contains both a price and
 * a non-empty title. Prices are matched permissively (￥/¥/元/plain decimals) because
 * storefronts disagree; the URL has to come from somewhere too, and a node without any
 * usable link is emitted anyway so the verifier can report why it was rejected instead of
 * the row silently vanishing.
 */

const PRICE_PATTERN = /(?:￥|¥|RMB\s*)?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s*元?/u;
const MAX_ROWS = 100;

export interface ExtractedRow {
  attributes: Record<string, string>;
  collectedAt: string;
  price: number;
  rating: number | null;
  salesText: string | null;
  shopName: string | null;
  title: string;
  url: string;
}

export interface ExtractProductRowsOptions {
  /** Timestamp stamped on every row; injected so extraction stays deterministic. */
  collectedAt: string;
  /** Domains allowed to appear in a row URL; a row without one is still emitted. */
  baseUrl?: string;
}

export function extractProductRows(
  tree: readonly RawObservationNode[],
  request: ProductSearchRequest,
  options: ExtractProductRowsOptions,
): ExtractedRow[] {
  const rows: ExtractedRow[] = [];
  const seen = new Set<string>();

  const visit = (node: RawObservationNode): void => {
    if (rows.length >= MAX_ROWS) {
      return;
    }
    const candidates = collectRowCandidates(node);
    for (const row of candidates) {
      const key = `${row.title}|${String(row.price)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        attributes: { source: "uia-tree", query: request.query },
        collectedAt: options.collectedAt,
        price: row.price,
        rating: null,
        salesText: row.salesText,
        shopName: row.shopName,
        title: row.title,
        // A row without a link cannot be ranked; emitting it with an empty URL lets the
        // verifier reject it explicitly instead of the row disappearing without a trace.
        url: row.url ?? options.baseUrl ?? "",
      });
      if (rows.length >= MAX_ROWS) {
        return;
      }
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  for (const root of tree) {
    visit(root);
  }
  return rows;
}

interface RowCandidate {
  price: number;
  salesText: string | null;
  shopName: string | null;
  title: string;
  url: string | undefined;
}

/**
 * A node is a row when its own subtree already contains a price, and its parent's does not
 * add a second price: that keeps the row at the tightest subtree that describes one product
 * rather than the whole grid.
 */
function collectRowCandidates(node: RawObservationNode): RowCandidate[] {
  const text = flattenText(node);
  const priceMatch = PRICE_PATTERN.exec(text);
  if (priceMatch === null) {
    return [];
  }

  for (const child of node.children ?? []) {
    // Descend into a child that alone still carries a price; the row is narrower than this
    // node. A grid usually wraps many rows, so this is the common path.
    if (PRICE_PATTERN.test(flattenText(child))) {
      return [];
    }
  }

  const title = deriveTitle(node, text, priceMatch);
  if (title === "") {
    return [];
  }

  return [
    {
      price: parsePrice(priceMatch),
      salesText: deriveSales(text),
      shopName: deriveShopName(node),
      title,
      url: findUrl(node),
    },
  ];
}

function flattenText(node: RawObservationNode): string {
  const parts: string[] = [];
  const walk = (current: RawObservationNode): void => {
    if (current.name !== undefined && current.name.trim() !== "") {
      parts.push(current.name.trim());
    }
    for (const child of current.children ?? []) {
      walk(child);
    }
  };
  walk(node);
  return parts.join(" ");
}

function parsePrice(match: RegExpExecArray): number {
  const whole = Number(match[1]?.replaceAll(",", "") ?? "0");
  const fraction = match[2] === undefined ? 0 : Number(`0.${match[2]}`);
  const value = whole + fraction;
  // The verifier rejects non-positive prices, so clamp invalid input to 0 and let it fail
  // there rather than inventing a plausible number here.
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function deriveTitle(node: RawObservationNode, text: string, match: RegExpExecArray): string {
  // Prefer the longest label that is not the price itself; that is usually the title.
  const labels = collectLabels(node)
    .map((label) => label.trim())
    .filter((label) => label !== "" && !PRICE_PATTERN.test(label));
  const longest = labels.sort((left, right) => right.length - left.length)[0];
  if (longest !== undefined && longest.length >= 2) {
    return longest.slice(0, 200);
  }
  const stripped = text.replace(match[0], " ").replace(/\s+/gu, " ").trim();
  return stripped.slice(0, 200);
}

function collectLabels(node: RawObservationNode): string[] {
  const labels: string[] = [];
  const walk = (current: RawObservationNode): void => {
    if (current.name !== undefined) {
      labels.push(current.name);
    }
    for (const child of current.children ?? []) {
      walk(child);
    }
  };
  walk(node);
  return labels;
}

function deriveSales(text: string): string | null {
  const match = /(?:已售|销量|月销)\s*([\d.,]+\s*万?\+?)/u.exec(text);
  return match?.[1] === undefined ? null : match[1].slice(0, 100);
}

function deriveShopName(node: RawObservationNode): string | null {
  const match = /(?:店铺|旗舰店|专营店|官方店)[:：]?\s*([^\s|]{1,50})/u.exec(flattenText(node));
  return match?.[1] === undefined ? null : match[1].slice(0, 100);
}

function findUrl(node: RawObservationNode): string | undefined {
  // UIA sometimes exposes a hyperlink's target as the automation id or in the name.
  const walk = (current: RawObservationNode): string | undefined => {
    const probe = current.automationId ?? "";
    if (/^https:\/\//iu.test(probe)) {
      return probe;
    }
    const nameProbe = current.name ?? "";
    if (/^https:\/\//iu.test(nameProbe)) {
      return nameProbe;
    }
    for (const child of current.children ?? []) {
      const found = walk(child);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };
  return walk(node);
}
