<script setup lang="ts">
import {
  AlertTriangle,
  Ban,
  Bot,
  Check,
  Circle,
  Clock3,
  LoaderCircle,
  RefreshCw,
  X,
} from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted } from "vue";

import type { TaskState } from "./api.js";
import { useTasksStore } from "./stores/tasks.js";

const store = useTasksStore();
const filters: readonly { label: string; value?: TaskState }[] = [
  { label: "全部" },
  { label: "执行中", value: "RUNNING" },
  { label: "待人工", value: "WAITING_FOR_HUMAN" },
  { label: "已成功", value: "SUCCEEDED" },
  { label: "已失败", value: "FAILED" },
];
const terminalStates = new Set<TaskState>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "INTERRUPTED",
]);
const stateLabels: Record<TaskState, string> = {
  RECEIVED: "已接收",
  PLANNED: "已规划",
  WAITING_FOR_INPUT: "待补充",
  RUNNING: "执行中",
  WAITING_FOR_HUMAN: "待人工",
  SUCCEEDED: "已成功",
  FAILED: "已失败",
  CANCELLED: "已取消",
  REJECTED: "已拒绝",
  INTERRUPTED: "已中断",
};
const stepLabels = {
  PENDING: "待执行",
  RUNNING: "执行中",
  SUCCEEDED: "成功",
  FAILED: "失败",
  SKIPPED: "已跳过",
} as const;
const activeCount = computed(
  () => store.tasks.filter((task) => !terminalStates.has(task.state)).length,
);
const canCancel = computed(
  () => store.selectedTask !== undefined && !terminalStates.has(store.selectedTask.state),
);
const formatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function formatTime(value: string | null): string {
  return value === null ? "--" : formatter.format(new Date(value));
}

function duration(startedAt: string | null, finishedAt: string | null): string {
  if (startedAt === null) {
    return "--";
  }
  const milliseconds = new Date(finishedAt ?? Date.now()).getTime() - new Date(startedAt).getTime();
  return `${String(Math.max(0, milliseconds))} ms`;
}

onMounted(() => {
  void store.refresh();
  refreshTimer = setInterval(() => {
    void store.refresh();
  }, 3_000);
});

onBeforeUnmount(() => {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer);
  }
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark"><Bot :size="20" /></span>
        <div>
          <strong>任务控制台</strong>
          <span>Human Operation Simulator</span>
        </div>
      </div>
      <div class="service-summary">
        <span class="online-dot"></span>
        <span>Control Server</span>
        <span class="summary-divider"></span>
        <span>{{ activeCount }} 个活动任务</span>
        <button
          class="icon-button"
          title="刷新任务"
          :disabled="store.loading"
          @click="store.refresh"
        >
          <RefreshCw :size="17" :class="{ spinning: store.loading }" />
        </button>
      </div>
    </header>

    <nav class="filter-bar" aria-label="任务状态筛选">
      <button
        v-for="filter in filters"
        :key="filter.label"
        :class="{ active: store.stateFilter === filter.value }"
        @click="store.filterBy(filter.value)"
      >
        {{ filter.label }}
      </button>
    </nav>

    <div v-if="store.error" class="error-banner">
      <AlertTriangle :size="17" />
      <span>{{ store.error }}</span>
    </div>

    <main class="workspace">
      <section class="task-pane" aria-label="任务列表">
        <div class="pane-heading">
          <h1>任务</h1>
          <span>{{ store.tasks.length }}</span>
        </div>
        <div v-if="store.tasks.length === 0 && !store.loading" class="empty-state">
          <Clock3 :size="28" />
          <strong>暂无任务</strong>
        </div>
        <button
          v-for="task in store.tasks"
          :key="task.id"
          class="task-row"
          :class="{ selected: store.selectedTask?.id === task.id }"
          @click="store.select(task.id)"
        >
          <span class="task-row-main">
            <span class="task-code">{{ task.shortCode }}</span>
            <strong>{{ task.request.question ?? "未命名任务" }}</strong>
            <small>{{ formatTime(task.createdAt) }}</small>
          </span>
          <span class="state-badge" :data-state="task.state">{{ stateLabels[task.state] }}</span>
        </button>
      </section>

      <section class="detail-pane" aria-label="任务详情">
        <template v-if="store.selectedTask">
          <div class="detail-header">
            <div>
              <span class="detail-kicker">AI 问答 · {{ store.selectedTask.shortCode }}</span>
              <h2>{{ store.selectedTask.request.question ?? "未命名任务" }}</h2>
              <p>
                {{ formatTime(store.selectedTask.createdAt) }} ·
                {{ store.selectedTask.policyVersion }}
              </p>
            </div>
            <button
              v-if="canCancel"
              class="cancel-button"
              title="取消当前任务"
              @click="store.cancelSelected"
            >
              <Ban :size="16" />
              取消任务
            </button>
          </div>

          <div class="detail-grid">
            <section class="timeline-section">
              <h3>执行步骤</h3>
              <ol class="timeline">
                <li
                  v-for="step in store.selectedTask.steps"
                  :key="step.id"
                  :data-state="step.state"
                >
                  <span class="step-icon">
                    <Check v-if="step.state === 'SUCCEEDED'" :size="15" />
                    <X v-else-if="step.state === 'FAILED'" :size="15" />
                    <LoaderCircle
                      v-else-if="step.state === 'RUNNING'"
                      :size="15"
                      class="spinning"
                    />
                    <Circle v-else :size="12" />
                  </span>
                  <div>
                    <strong>{{ step.name }}</strong>
                    <span
                      >{{ stepLabels[step.state] }} ·
                      {{ duration(step.startedAt, step.finishedAt) }}</span
                    >
                    <code v-if="step.errorCode">{{ step.errorCode }}</code>
                  </div>
                </li>
              </ol>
            </section>

            <section class="result-section">
              <div class="result-heading">
                <h3>结果</h3>
                <span class="state-badge" :data-state="store.selectedTask.state">
                  {{ stateLabels[store.selectedTask.state] }}
                </span>
              </div>
              <template v-if="store.selectedTask.result?.answer">
                <p class="answer">{{ store.selectedTask.result.answer }}</p>
                <dl>
                  <div>
                    <dt>来源</dt>
                    <dd>{{ store.selectedTask.result.source ?? "--" }}</dd>
                  </div>
                  <div>
                    <dt>耗时</dt>
                    <dd>{{ store.selectedTask.result.durationMs ?? "--" }} ms</dd>
                  </div>
                </dl>
              </template>
              <div v-else-if="store.selectedTask.result?.errorCode" class="failure">
                <AlertTriangle :size="18" />
                <code>{{ store.selectedTask.result.errorCode }}</code>
              </div>
              <p v-else class="pending-result">等待结果</p>
            </section>
          </div>
        </template>
        <div v-else class="empty-detail">
          <Bot :size="32" />
          <strong>选择一个任务</strong>
        </div>
      </section>
    </main>
  </div>
</template>
