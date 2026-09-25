import { computed, ref } from "vue";
import { defineStore } from "pinia";

import {
  type Agent,
  type StatisticsReport,
  type Task,
  type TaskState,
  cancelTask,
  emergencyStop,
  fetchAgents,
  fetchStatistics,
  fetchTasks,
  recoverTask,
} from "../api.js";

const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "INTERRUPTED",
]);

export const useOperationsStore = defineStore("operations", () => {
  const tasks = ref<Task[]>([]);
  const agents = ref<Agent[]>([]);
  const statistics = ref<StatisticsReport>();
  const selectedTaskId = ref<string>();
  const stateFilter = ref<TaskState>();
  const loading = ref(false);
  const error = ref<string>();

  const selectedTask = computed(
    () => tasks.value.find((task) => task.id === selectedTaskId.value) ?? tasks.value[0],
  );

  const activeCount = computed(
    () => tasks.value.filter((task) => !TERMINAL_STATES.has(task.state)).length,
  );

  const onlineAgentCount = computed(
    () => agents.value.filter((agent) => agent.status === "ONLINE").length,
  );

  async function refresh(): Promise<void> {
    loading.value = true;
    const [tasksResult, agentsResult, statisticsResult] = await Promise.allSettled([
      fetchTasks(stateFilter.value),
      fetchAgents(),
      fetchStatistics(),
    ]);
    if (tasksResult.status === "fulfilled") {
      tasks.value = tasksResult.value;
      if (
        selectedTaskId.value !== undefined &&
        !tasks.value.some((task) => task.id === selectedTaskId.value)
      ) {
        selectedTaskId.value = undefined;
      }
    }
    if (agentsResult.status === "fulfilled") {
      agents.value = agentsResult.value;
    }
    if (statisticsResult.status === "fulfilled") {
      statistics.value = statisticsResult.value;
    }
    error.value = firstFailureMessage([tasksResult, agentsResult, statisticsResult]);
    loading.value = false;
  }

  async function runAction(action: () => Promise<void>, fallbackMessage: string): Promise<void> {
    try {
      await action();
      error.value = undefined;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : fallbackMessage;
    }
  }

  async function cancelSelected(): Promise<void> {
    const task = selectedTask.value;
    if (task === undefined) {
      return;
    }
    await runAction(async () => {
      await cancelTask(task.id);
      await refresh();
    }, "取消任务失败");
  }

  async function recoverSelected(): Promise<void> {
    const task = selectedTask.value;
    if (task === undefined) {
      return;
    }
    await runAction(async () => {
      const recovered = await recoverTask(task.id);
      await refresh();
      selectedTaskId.value = recovered.id;
    }, "恢复任务失败");
  }

  async function triggerEmergencyStop(): Promise<void> {
    await runAction(async () => {
      await emergencyStop();
      await refresh();
    }, "紧急停止失败");
  }

  function select(taskId: string): void {
    selectedTaskId.value = taskId;
  }

  function filterBy(state?: TaskState): void {
    stateFilter.value = state;
    void refresh();
  }

  return {
    activeCount,
    agents,
    cancelSelected,
    error,
    filterBy,
    loading,
    onlineAgentCount,
    recoverSelected,
    refresh,
    select,
    selectedTask,
    selectedTaskId,
    stateFilter,
    statistics,
    tasks,
    triggerEmergencyStop,
  };
});

function firstFailureMessage(
  results: readonly PromiseSettledResult<unknown>[],
): string | undefined {
  for (const result of results) {
    if (result.status === "rejected") {
      return result.reason instanceof Error ? result.reason.message : "数据加载失败";
    }
  }
  return undefined;
}
