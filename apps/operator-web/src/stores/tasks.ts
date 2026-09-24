import { computed, ref } from "vue";
import { defineStore } from "pinia";

import { cancelTask, fetchTasks, type Task, type TaskState } from "../api.js";

export const useTasksStore = defineStore("tasks", () => {
  const tasks = ref<Task[]>([]);
  const selectedTaskId = ref<string>();
  const stateFilter = ref<TaskState>();
  const loading = ref(false);
  const error = ref<string>();

  const selectedTask = computed(
    () => tasks.value.find((task) => task.id === selectedTaskId.value) ?? tasks.value[0],
  );

  async function refresh(): Promise<void> {
    loading.value = true;
    try {
      tasks.value = await fetchTasks(stateFilter.value);
      error.value = undefined;
      if (
        selectedTaskId.value !== undefined &&
        !tasks.value.some((task) => task.id === selectedTaskId.value)
      ) {
        selectedTaskId.value = undefined;
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "任务加载失败";
    } finally {
      loading.value = false;
    }
  }

  async function cancelSelected(): Promise<void> {
    const task = selectedTask.value;
    if (task === undefined) {
      return;
    }
    try {
      await cancelTask(task.id);
      await refresh();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "取消任务失败";
    }
  }

  function select(taskId: string): void {
    selectedTaskId.value = taskId;
  }

  function filterBy(state?: TaskState): void {
    stateFilter.value = state;
    void refresh();
  }

  return {
    cancelSelected,
    error,
    filterBy,
    loading,
    refresh,
    select,
    selectedTask,
    selectedTaskId,
    stateFilter,
    tasks,
  };
});
