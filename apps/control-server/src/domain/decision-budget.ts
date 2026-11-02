/**
 * Decision budget (FR-14, BUDGET-01, Plan B).
 *
 * The triple budget bounds non-deterministic loops so they cannot run away. Exhaustion is
 * a declared terminal state (`DECISION_BUDGET_EXHAUSTED` -> `WAITING_FOR_HUMAN`), never an
 * unbounded loop. Numeric values are defaults for the cross-platform slice; the docs note
 * they must be frozen after live cost measurements (docs/06 §3.2, docs/14 §8).
 */

export interface DecisionBudget {
  maxRounds: number;
  maxTokens: number;
  maxWallClockMs: number;
}

export function defaultDecisionBudget(): DecisionBudget {
  return {
    maxRounds: 12,
    maxTokens: 8_000,
    maxWallClockMs: 110_000,
  };
}

export function loadDecisionBudget(
  environment: NodeJS.ProcessEnv = process.env,
  base: DecisionBudget = defaultDecisionBudget(),
): DecisionBudget {
  return {
    maxRounds: readPositiveInteger(environment.DECISION_MAX_ROUNDS, base.maxRounds),
    maxTokens: readPositiveInteger(environment.DECISION_MAX_TOKENS, base.maxTokens),
    maxWallClockMs: readPositiveInteger(
      environment.DECISION_MAX_WALL_CLOCK_MS,
      base.maxWallClockMs,
    ),
  };
}

function readPositiveInteger(rawValue: string | undefined, fallback: number): number {
  if (rawValue === undefined) {
    return fallback;
  }
  if (!/^[1-9]\d*$/u.test(rawValue)) {
    throw new Error("Decision budget limits must be positive integers");
  }
  return Number(rawValue);
}
