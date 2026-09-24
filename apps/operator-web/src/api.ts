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
    question?: string;
    source?: string;
  };
  result: {
    answer?: string;
    durationMs?: number;
    errorCode?: string;
    source?: string;
  } | null;
  shortCode: string;
  state: TaskState;
  steps: TaskStep[];
  type: "AI_QUESTION" | "PRODUCT_SEARCH";
  updatedAt: string;
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
