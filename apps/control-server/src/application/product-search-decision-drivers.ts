import type { DesktopCommand } from "@hos/contracts";

import { AdapterError } from "../adapters/adapter-error.js";
import type {
  ObservationAdapter,
  ObservationCapture,
  RawObservationNode,
} from "../domain/observation.js";
import { verifyProductCandidates } from "../domain/product-verifier.js";
import type { ProductSearchRequest } from "../domain/product-search-command.js";
import type { ProductSearchDecisionDrivers } from "./product-search-decision-strategy.js";

/**
 * Composes the Plan B drivers for a GUI-driven product search (LOOP-01 wiring).
 *
 * The decision loop only hands a round number to `collectCandidates`, so the driver has to
 * remember the capture it just took. That ownership is explicit here rather than scattered
 * across call sites: each successful `observe` replaces the retained tree, and both
 * `collectCandidates` and `verify` read from it. The parsed request is supplied once at
 * construction, because it is fixed for the whole task.
 *
 * `extractCandidates` is injected rather than implemented here on purpose. Turning a real
 * storefront's accessibility tree into product rows is site-specific and needs calibration
 * against a live page (`docs/07`), which this module cannot do. Keeping it a parameter means
 * the wiring, the budget, and the verification path are testable today with a deterministic
 * extractor, and only the extractor needs recalibration later.
 */

/** Returns raw candidate objects; validation happens in the verifier. */
export type ProductRowExtractor = (
  tree: readonly RawObservationNode[],
  request: ProductSearchRequest,
) => readonly unknown[];

export interface ProductSearchDecisionDriversOptions {
  allowedDomains: ReadonlySet<string>;
  commandExecutor: {
    execute(command: DesktopCommand, signal: AbortSignal): Promise<void>;
  };
  extractCandidates: ProductRowExtractor;
  /** Per-UIA-call timeout forwarded to the Agent. */
  inspectionTimeoutMs?: number;
  /** How many nodes to ask the Agent for. Omitted means the Agent's own default. */
  maxNodes?: number;
  observation: ObservationAdapter;
  request: ProductSearchRequest;
  targetProcessName: string;
  taskId: string;
  titleContains?: string;
}

export interface ProductSearchDecisionDriversHandle {
  drivers: ProductSearchDecisionDrivers;
  /** Last captured tree, exposed for diagnostics and tests. */
  lastTree(): readonly RawObservationNode[] | undefined;
}

export function createProductSearchDecisionDrivers(
  options: ProductSearchDecisionDriversOptions,
): ProductSearchDecisionDriversHandle {
  let retained: ObservationCapture | undefined;
  let lastExtracted: readonly unknown[] = [];

  const drivers: ProductSearchDecisionDrivers = {
    collectCandidates: () => (retained === undefined ? undefined : [...lastExtracted]),

    execute: (command: DesktopCommand, signal: AbortSignal) =>
      options.commandExecutor.execute(command, signal),

    // The round number is carried by the loop's own trace, not by the observation request.
    observe: async (_round: number, signal: AbortSignal) => {
      const inspection: Parameters<ObservationAdapter["inspect"]>[0] = {
        target: {
          processName: options.targetProcessName,
          ...(options.titleContains === undefined ? {} : { titleContains: options.titleContains }),
        },
        taskId: options.taskId,
        ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
      };
      const capture = await options.observation.inspect(inspection, signal);
      retained = capture;
      return capture;
    },

    // Returns a promise rather than being declared async so a synchronous verdict does not
    // introduce a microtask hop the loop would have to reason about.
    verify: (_round: number, signal: AbortSignal) => {
      if (signal.aborted) {
        return Promise.reject(new AdapterError("TASK_CANCELLED", "Verification was cancelled"));
      }
      if (retained === undefined) {
        // Verifying before observing would silently pass on an empty screen.
        return Promise.reject(
          new AdapterError("VERIFIER_FAILED", "Verifier ran before any observation"),
        );
      }
      lastExtracted = options.extractCandidates(retained.raw, options.request);
      return Promise.resolve(
        verifyProductCandidates(lastExtracted, {
          allowedDomains: options.allowedDomains,
          request: options.request,
        }).passed,
      );
    },
  };

  return { drivers, lastTree: () => retained?.raw };
}
