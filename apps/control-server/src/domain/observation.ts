import { createHmac } from "node:crypto";

/**
 * Observation layer for the Plan B decision loop (OBS-01, cross-platform slice).
 *
 * The decision loop never sees raw desktop text verbatim. The structured tree is
 * reduced to a bounded, redacted summary before it leaves this module, so untrusted
 * UI/chat content (a prompt-injection vector) can only ever arrive as data, never as
 * instruction. The real transport (`DESKTOP_INSPECT_TREE` over the Agent WebSocket)
 * and the Python executor are a separate, Windows-only task; this module is the
 * "structure tree -> bounded text representation" conversion layer that both paths share.
 */

export type ObservationSource = "UIA_TREE" | "DOM_TREE" | "SCREENSHOT";

export const DEFAULT_MAX_OBSERVATION_NODES = 2000;
/**
 * Budget for a product-listing page.
 *
 * A search-results grid can expose thousands of rows, and every row costs a handful of
 * tokens in the model prompt. 2000 nodes both overruns the per-task token budget and
 * pushes a huge observation into the trace, so listing pages get a much smaller cap:
 * a dozen result rows fit inside it, and `truncated` makes the shortfall explicit rather
 * than letting the model believe it saw the whole page. This value is an engineering
 * starting point to be re-measured under `docs/07` before acceptance, not a calibrated
 * constant.
 */
export const PRODUCT_LISTING_MAX_OBSERVATION_NODES = 400;
const NAME_MAX_LENGTH = 200;
const NAME_TOKEN_LENGTH = 16;

export interface RawObservationNode {
  automationId?: string;
  boundingBox?: { height: number; width: number; x: number; y: number };
  children?: readonly RawObservationNode[];
  controlType: string;
  name?: string;
}

/** One node of the Agent's flat, depth-annotated observation payload. */
export interface FlatObservationNode {
  automationId: string;
  controlType: string;
  depth: number;
  enabled: boolean;
  name: string;
  visible: boolean;
}

export interface RedactedObservationNode {
  automationId?: string;
  boundingBox?: { height: number; width: number; x: number; y: number };
  children?: readonly RedactedObservationNode[];
  controlType: string;
  nameToken?: string;
}

export interface ObservationSummary {
  /** Node count measured before truncation. */
  capturedAt: string;
  nodeCount: number;
  redactedNodes: RedactedObservationNode[];
  source: ObservationSource;
  truncated: boolean;
}

export interface ObservationRequest {
  maxNodes?: number;
  target: { processName: string; titleContains?: string };
  taskId: string;
}

export interface ObservationAdapter {
  inspect(request: ObservationRequest, signal: AbortSignal): Promise<ObservationSummary>;
}

/**
 * Replaces a control name with a stable HMAC token. The model and persisted trace see
 * the token, never the original label, so the observation layer cannot leak UI text
 * into the decision record. The key never leaves the server process.
 */
export function redactNodeName(name: string, key: string): string {
  const trimmed = name.slice(0, NAME_MAX_LENGTH);
  const digest = createHmac("sha256", key).update(trimmed).digest("hex");
  return `node:${digest.slice(0, NAME_TOKEN_LENGTH)}`;
}

function countNodes(nodes: readonly RawObservationNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0);
}

interface Remaining {
  count: number;
}

function buildRedacted(
  nodes: readonly RawObservationNode[],
  key: string,
  remaining: Remaining,
): { nodes: RedactedObservationNode[]; truncated: boolean } {
  const output: RedactedObservationNode[] = [];
  let truncated = false;
  for (const node of nodes) {
    if (remaining.count <= 0) {
      truncated = true;
      break;
    }
    remaining.count -= 1;
    const redacted: RedactedObservationNode = { controlType: node.controlType };
    if (node.automationId !== undefined) {
      redacted.automationId = node.automationId;
    }
    if (node.boundingBox !== undefined) {
      redacted.boundingBox = node.boundingBox;
    }
    if (node.name !== undefined) {
      redacted.nameToken = redactNodeName(node.name, key);
    }
    if (node.children !== undefined && node.children.length > 0) {
      const childResult = buildRedacted(node.children, key, remaining);
      redacted.children = childResult.nodes;
      if (childResult.truncated) {
        truncated = true;
      }
    }
    output.push(redacted);
  }
  return { nodes: output, truncated };
}

/**
 * Rebuilds a nested tree from the depth-first, depth-annotated node list the Desktop
 * Agent sends in `desktop.command.result.observation`.
 *
 * The Agent emits a flat list because it is far smaller on the wire and avoids deep JSON
 * nesting. Rebuilding re-validates the shape rather than assuming it: a depth that jumps
 * by more than one means the parent was dropped (truncation on the Agent side), and those
 * nodes become siblings at the shallowest level that can hold them instead of being
 * silently discarded. Returning a partial tree is what the `truncated` flag documents.
 */
export function rebuildTree(flatNodes: readonly FlatObservationNode[]): RawObservationNode[] {
  const roots: RawObservationNode[] = [];
  // stack[depth] holds the node currently open at that depth.
  const stack: RawObservationNode[] = [];
  for (const flat of flatNodes) {
    const node: RawObservationNode = { controlType: flat.controlType };
    if (flat.automationId !== "") {
      node.automationId = flat.automationId;
    }
    if (flat.name !== "") {
      node.name = flat.name;
    }
    const depth = stack.length === 0 ? 0 : Math.min(flat.depth, stack.length);
    if (depth === 0) {
      roots.push(node);
    } else {
      const parent = stack[depth - 1];
      // Parent is guaranteed by the clamp above, but TypeScript cannot see that.
      if (parent !== undefined) {
        parent.children = [...(parent.children ?? []), node];
      }
    }
    stack.length = depth;
    stack.push(node);
  }
  return roots;
}

/**
 * Converts a raw control tree into a bounded, redacted summary. Truncation is explicit
 * (the `truncated` flag) and never silent: when the raw tree exceeds `maxNodes`, descent
 * stops and `nodeCount` still reports the full pre-truncation total.
 */
export function summarizeTree(
  rawTree: readonly RawObservationNode[],
  source: ObservationSource,
  capturedAt: string,
  redactionKey: string,
  maxNodes: number = DEFAULT_MAX_OBSERVATION_NODES,
): ObservationSummary {
  const nodeCount = countNodes(rawTree);
  const remaining: Remaining = { count: maxNodes };
  const { nodes, truncated } = buildRedacted(rawTree, redactionKey, remaining);
  return {
    capturedAt,
    nodeCount,
    redactedNodes: nodes,
    source,
    truncated: truncated || nodeCount > maxNodes,
  };
}
