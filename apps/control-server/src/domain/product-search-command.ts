export interface ProductSearchRequest {
  candidateCount: number;
  maxPrice: number;
  preferences: string[];
  query: string;
}

export type ProductSearchCommandDecision =
  | { accepted: true; request: ProductSearchRequest }
  | {
      accepted: false;
      code: "COMMAND_UNSUPPORTED" | "INVALID_ARGUMENTS";
      missingFields?: readonly ("candidateCount" | "maxPrice" | "query")[];
    };

const BUDGET_PATTERNS = [
  /(\d+(?:\.\d{1,2})?)\s*元?\s*(?:以内|以下|封顶|上限)/iu,
  /(?:预算|最高价?|不超过|不高于)\s*(?:为|是|[:：])?\s*(\d+(?:\.\d{1,2})?)\s*元?/iu,
] as const;
const COUNT_PATTERN = /(?:选|比较|推荐)\s*([1-3一二三])\s*款/iu;
const PREFERENCE_PATTERN = /(?:优先|偏好)\s*(.+)$/iu;

function parseCount(value: string): number | undefined {
  const chineseNumbers: Readonly<Record<string, number>> = { 一: 1, 二: 2, 三: 3 };
  const count = chineseNumbers[value] ?? Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 3 ? count : undefined;
}

function normalizeQuery(command: string): string {
  let query = command;
  for (const pattern of BUDGET_PATTERNS) {
    query = query.replace(pattern, "");
  }
  query = query.replace(COUNT_PATTERN, "").replace(PREFERENCE_PATTERN, "");
  return query
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/gu, "")
    .replace(/[，,。；;]\s*[，,。；;]+/gu, "，")
    .replace(/^(?:的|商品)\s*/u, "")
    .replace(/\s*(?:的|商品)$/u, "")
    .trim();
}

export function parseProductSearchCommand(
  content: string,
  commandPrefix: string,
): ProductSearchCommandDecision {
  const normalized = content.trim();
  if (!normalized.startsWith(commandPrefix)) {
    return { accepted: false, code: "COMMAND_UNSUPPORTED" };
  }

  const prefixedCommand = normalized.slice(commandPrefix.length).trim();
  const searchMatch = /^(?:搜索|查找)\s*(.*)$/iu.exec(prefixedCommand);
  if (searchMatch === null) {
    return { accepted: false, code: "COMMAND_UNSUPPORTED" };
  }

  const command = searchMatch[1]?.trim() ?? "";
  const budgetMatch = BUDGET_PATTERNS.map((pattern) => pattern.exec(command)).find(
    (match) => match !== null,
  );
  const maxPrice = budgetMatch?.[1] === undefined ? undefined : Number(budgetMatch[1]);
  const countMatch = COUNT_PATTERN.exec(command);
  const candidateCount = countMatch?.[1] === undefined ? undefined : parseCount(countMatch[1]);
  const query = normalizeQuery(command);
  const missingFields: ("candidateCount" | "maxPrice" | "query")[] = [];

  if (query.length === 0 || query.length > 100) {
    missingFields.push("query");
  }
  if (
    maxPrice === undefined ||
    !Number.isFinite(maxPrice) ||
    maxPrice <= 0 ||
    maxPrice > 1_000_000
  ) {
    missingFields.push("maxPrice");
  }
  if (candidateCount === undefined) {
    missingFields.push("candidateCount");
  }
  if (missingFields.length > 0) {
    return { accepted: false, code: "INVALID_ARGUMENTS", missingFields };
  }
  if (maxPrice === undefined || candidateCount === undefined) {
    return { accepted: false, code: "INVALID_ARGUMENTS" };
  }

  const preferenceText = PREFERENCE_PATTERN.exec(command)?.[1] ?? "";
  const preferences = preferenceText
    .split(/[、，,和与及/]/u)
    .map((preference) => preference.trim())
    .filter((preference) => preference.length > 0)
    .slice(0, 5);

  return {
    accepted: true,
    request: {
      candidateCount,
      maxPrice,
      preferences,
      query,
    },
  };
}
