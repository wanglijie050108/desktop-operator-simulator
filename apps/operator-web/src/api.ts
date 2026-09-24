export type TaskState =
  | "RECEIVED"
  | "PLANNED"
  | "WAITING_FOR_INPUT"
  | "RUNNING"
  | "WAITING_FOR_HUMAN"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "REJECTED"
  | "INTERRUPTED";

export interface TaskStep {
  artifactRefs: unknown[];
  attempt: number;
  errorCode: string | null;
  finishedAt: string | null;
  id: string;
  name: string;
  sequence: number;
  startedAt: string | null;
  state: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  taskId: string;
}

export interface Task {
  createdAt: string;
  id: string;
  policyVersion: string;
  request: {
    conversationId?: string;
    candidateCount?: number;
    maxPrice?: number;
    missingFields?: string[];
    preferences?: string[];
    question?: string;
    query?: string;
    source?: string;
  };
  result: {
    adapterVersion?: string;
    answer?: string;
    collectedAt?: string;
    durationMs?: number;
    errorCode?: string;
    maxPrice?: number;
    missingFields?: string[];
    products?: {
      attributes: Record<string, string>;
      collectedAt: string;
      price: number;
      rank: number;
      rating: number | null;
      salesText: string | null;
      score: number;
      shopName: string | null;
      title: string;
      url: string;
    }[];
    query?: string;
    source?: string;
  } | null;
  shortCode: string;
  state: TaskState;
  steps: TaskStep[];
  type: "AI_QUESTION" | "PRODUCT_SEARCH";
  updatedAt: string;
}

export type AgentStatus = "ONLINE" | "OFFLINE" | "PAUSED" | "BUSY";

export interface Agent {
  capabilities: string[];
  id: string;
  lastSeenAt: string;
  name: string;
  status: AgentStatus;
  version: string;
}

export interface DurationSummary {
  averageMs: number;
  count: number;
  maxMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface ErrorCount {
  code: string;
  count: number;
}

export interface TaskSummary {
  completedCount: number;
  duration: DurationSummary;
  errorDistribution: ErrorCount[];
  failedCount: number;
  stateCounts: Record<string, number>;
  succeededCount: number;
  successRate: number | null;
  terminalCount: number;
  totalCount: number;
}

export interface StatisticsReport {
  byType: {
    AI_QUESTION: TaskSummary;
    PRODUCT_SEARCH: TaskSummary;
  };
  generatedAt: string;
  overall: TaskSummary;
  version: string;
}

export interface StatisticsFilter {
  from?: string;
  to?: string;
  type?: "AI_QUESTION" | "PRODUCT_SEARCH";
}

interface ApiError {
  code: string;
  message: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new Error(`${error.code}: ${error.message}`);
  }
  return (await response.json()) as T;
}

export function fetchTasks(state?: TaskState): Promise<Task[]> {
  const query = state === undefined ? "" : `?state=${encodeURIComponent(state)}`;
  return request<Task[]>(`/api/v1/tasks${query}`);
}

export function cancelTask(taskId: string): Promise<Task> {
  return request<Task>(`/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  });
}

export function recoverTask(taskId: string): Promise<Task> {
  return request<Task>(`/api/v1/tasks/${encodeURIComponent(taskId)}/recover`, {
    method: "POST",
  });
}

export function fetchAgents(): Promise<Agent[]> {
  return request<Agent[]>("/api/v1/agents");
}

export interface EmergencyStopResult {
  accepted: boolean;
  notifiedAgents: number;
}

export function emergencyStop(): Promise<EmergencyStopResult> {
  return request<EmergencyStopResult>("/api/v1/system/emergency-stop", {
    method: "POST",
  });
}

export function fetchStatistics(filter: StatisticsFilter = {}): Promise<StatisticsReport> {
  const params = new URLSearchParams();
  if (filter.type !== undefined) {
    params.set("type", filter.type);
  }
  if (filter.from !== undefined) {
    params.set("from", filter.from);
  }
  if (filter.to !== undefined) {
    params.set("to", filter.to);
  }
  const query = params.size === 0 ? "" : `?${params.toString()}`;
  return request<StatisticsReport>(`/api/v1/statistics${query}`);
}
