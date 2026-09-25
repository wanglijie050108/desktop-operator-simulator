<script setup lang="ts">
import {
  Activity,
  AlertTriangle,
  Ban,
  Bot,
  Check,
  Circle,
  CircleCheck,
  Clock3,
  ExternalLink,
  Info,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  MonitorCog,
  OctagonAlert,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  Wifi,
  WifiOff,
  X,
} from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type { AgentStatus, TaskState } from "./api.js";
import { useOperationsStore } from "./stores/operations.js";

const store = useOperationsStore();

type ViewName = "agents" | "statistics" | "tasks";
const currentView = ref<ViewName>("tasks");
const views: readonly { label: string; value: ViewName }[] = [
  { label: "任务监控", value: "tasks" },
  { label: "执行节点", value: "agents" },
  { label: "统计看板", value: "statistics" },
];

const filters: readonly { label: string; value?: TaskState }[] = [
  { label: "全部" },
  { label: "执行中", value: "RUNNING" },
  { label: "待补充", value: "WAITING_FOR_INPUT" },
  { label: "待人工", value: "WAITING_FOR_HUMAN" },
  { label: "已成功", value: "SUCCEEDED" },
  { label: "已失败", value: "FAILED" },
  { label: "已取消", value: "CANCELLED" },
  { label: "已中断", value: "INTERRUPTED" },
];

const terminalStates = new Set<TaskState>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "INTERRUPTED",
]);
const recoverableStates = new Set<TaskState>(["FAILED", "INTERRUPTED"]);
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
const agentStatusLabels: Record<AgentStatus, string> = {
  BUSY: "执行中",
  OFFLINE: "离线",
  ONLINE: "在线",
  PAUSED: "已暂停",
};
const stepLabels = {
  PENDING: "待执行",
  RUNNING: "执行中",
  SUCCEEDED: "成功",
  FAILED: "失败",
  SKIPPED: "已跳过",
} as const;

const canCancel = computed(
  () => store.selectedTask !== undefined && !terminalStates.has(store.selectedTask.state),
);
const canRecover = computed(
  () => store.selectedTask !== undefined && recoverableStates.has(store.selectedTask.state),
);

const report = computed(() => store.statistics);
const reportSections = computed(() => {
  const current = report.value;
  if (current === undefined) {
    return [];
  }
  return [
    { key: "overall", title: "总体", value: current.overall },
    { key: "AI_QUESTION", title: "AI 问答", value: current.byType.AI_QUESTION },
    { key: "PRODUCT_SEARCH", title: "商品查询", value: current.byType.PRODUCT_SEARCH },
  ];
});
const maxErrorCount = computed(() => {
  const counts = report.value?.overall.errorDistribution.map((item) => item.count) ?? [];
  return Math.max(1, ...counts);
});

// Emergency stop requires two clicks within the arming window to avoid misfires.
const stopArmed = ref(false);
let stopArmTimer: ReturnType<typeof setTimeout> | undefined;
function triggerEmergencyStop(): void {
  if (!stopArmed.value) {
    stopArmed.value = true;
    stopArmTimer = setTimeout(() => {
      stopArmed.value = false;
    }, 4_000);
    return;
  }
  if (stopArmTimer !== undefined) {
    clearTimeout(stopArmTimer);
  }
  stopArmed.value = false;
  void store.triggerEmergencyStop();
}

const formatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function formatTime(value: string | null | undefined): string {
  return value === null || value === undefined ? "--" : formatter.format(new Date(value));
}

function duration(startedAt: string | null, finishedAt: string | null): string {
  if (startedAt === null) {
    return "--";
  }
  const milliseconds = new Date(finishedAt ?? Date.now()).getTime() - new Date(startedAt).getTime();
  return `${String(Math.max(0, milliseconds))} ms`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds} ms`;
  }
  return `${(milliseconds / 1_000).toFixed(2)} s`;
}

function percent(value: number | null): string {
  return value === null ? "--" : `${(value * 100).toFixed(1)}%`;
}

function taskTitle(task: { request: { question?: string; query?: string }; type: string }): string {
  return task.type === "PRODUCT_SEARCH"
    ? (task.request.query ?? "待补充商品查询")
    : (task.request.question ?? "未命名任务");
}

function taskKind(type: string): string {
  return type === "PRODUCT_SEARCH" ? "商品查询" : "AI 问答";
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(value);
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
  if (stopArmTimer !== undefined) {
    clearTimeout(stopArmTimer);
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
        <span>{{ store.onlineAgentCount }} 个在线节点</span>
        <span class="summary-divider"></span>
        <span>{{ store.activeCount }} 个活动任务</span>
        <button
          class="icon-button"
          title="刷新全部数据"
          :disabled="store.loading"
          @click="store.refresh"
        >
          <RefreshCw :size="17" :class="{ spinning: store.loading }" />
        </button>
        <button
          class="stop-button"
          :class="{ armed: stopArmed }"
          title="紧急停止所有执行节点"
          data-testid="emergency-stop"
          @click="triggerEmergencyStop"
        >
          <OctagonAlert :size="16" />
          {{ stopArmed ? "再次点击确认急停" : "紧急停止" }}
        </button>
      </div>
    </header>

    <nav class="view-bar" aria-label="功能视图切换">
      <button
        v-for="view in views"
        :key="view.value"
        :class="{ active: currentView === view.value }"
        :data-testid="`view-${view.value}`"
        @click="currentView = view.value"
      >
        <ListChecks v-if="view.value === 'tasks'" :size="15" />
        <MonitorCog v-else-if="view.value === 'agents'" :size="15" />
        <LayoutDashboard v-else :size="15" />
        {{ view.label }}
      </button>
    </nav>

    <div v-if="store.error" class="error-banner">
      <AlertTriangle :size="17" />
      <span>{{ store.error }}</span>
    </div>

    <template v-if="currentView === 'tasks'">
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
              <strong>{{ taskTitle(task) }}</strong>
              <small>{{ formatTime(task.createdAt) }}</small>
            </span>
            <span class="state-badge" :data-state="task.state">{{ stateLabels[task.state] }}</span>
          </button>
        </section>

        <section class="detail-pane" aria-label="任务详情">
          <template v-if="store.selectedTask">
            <div class="detail-header">
              <div>
                <span class="detail-kicker"
                  >{{ taskKind(store.selectedTask.type) }} ·
                  {{ store.selectedTask.shortCode }}</span
                >
                <h2>{{ taskTitle(store.selectedTask) }}</h2>
                <p>
                  {{ formatTime(store.selectedTask.createdAt) }} ·
                  {{ store.selectedTask.policyVersion }}
                </p>
              </div>
              <div class="detail-actions">
                <button
                  v-if="canRecover"
                  class="recover-button"
                  title="基于原请求创建新任务"
                  data-testid="recover-task"
                  @click="store.recoverSelected"
                >
                  <RotateCcw :size="15" />
                  重新执行
                </button>
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
                <template v-else-if="store.selectedTask.result?.products">
                  <div class="product-summary">
                    <span>{{ store.selectedTask.result.source ?? "--" }}</span>
                    <span
                      >采集于 {{ formatTime(store.selectedTask.result.collectedAt ?? null) }}</span
                    >
                  </div>
                  <ol class="product-list">
                    <li v-for="product in store.selectedTask.result.products" :key="product.url">
                      <span class="product-rank">{{ product.rank }}</span>
                      <div class="product-content">
                        <div class="product-title">
                          <strong>{{ product.title }}</strong>
                          <span>{{ formatPrice(product.price) }}</span>
                        </div>
                        <p>
                          {{ product.shopName ?? "店铺未提供" }} · 评分
                          {{ product.rating?.toFixed(1) ?? "未提供" }} ·
                          {{ product.salesText ?? "销量未提供" }}
                        </p>
                        <a :href="product.url" target="_blank" rel="noopener noreferrer">
                          查看原始商品
                          <ExternalLink :size="13" />
                        </a>
                      </div>
                    </li>
                  </ol>
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
            <ShoppingBag :size="32" />
            <strong>选择一个任务</strong>
          </div>
        </section>
      </main>
    </template>

    <main v-else-if="currentView === 'agents'" class="panel-view" data-testid="agents-view">
      <div class="view-intro">
        <h1>执行节点</h1>
        <p>已注册的 Windows 桌面代理；状态由心跳驱动，超过心跳窗口自动转为离线。</p>
      </div>
      <div v-if="store.agents.length === 0" class="empty-panel">
        <MonitorCog :size="30" />
        <strong>暂无已注册节点</strong>
        <small>启动 Windows Desktop Agent 后将自动注册并显示在此处。</small>
      </div>
      <div v-else class="agent-grid">
        <article
          v-for="agent in store.agents"
          :key="agent.id"
          class="agent-card"
          :data-status="agent.status"
        >
          <div class="agent-card-header">
            <span class="agent-icon">
              <MonitorCog :size="18" />
            </span>
            <div>
              <strong>{{ agent.name }}</strong>
              <small>v{{ agent.version }}</small>
            </div>
            <span class="state-badge" :data-agent-status="agent.status">
              <Wifi v-if="agent.status === 'ONLINE'" :size="11" />
              <WifiOff v-else :size="11" />
              {{ agentStatusLabels[agent.status] }}
            </span>
          </div>
          <div class="agent-capabilities">
            <span v-for="capability in agent.capabilities" :key="capability">{{ capability }}</span>
            <span v-if="agent.capabilities.length === 0" class="muted">未声明能力</span>
          </div>
          <dl class="agent-meta">
            <div>
              <dt>最近心跳</dt>
              <dd>{{ formatTime(agent.lastSeenAt) }}</dd>
            </div>
            <div>
              <dt>节点 ID</dt>
              <dd class="mono">{{ agent.id }}</dd>
            </div>
          </dl>
        </article>
      </div>
    </main>

    <main v-else class="panel-view" data-testid="statistics-view">
      <div class="view-intro">
        <h1>统计看板</h1>
        <p>闭环成功率、耗时分布与终态错误分布，含按任务类型的分组统计。</p>
      </div>
      <div class="fixture-notice" data-testid="statistics-notice">
        <Info :size="15" />
        <span
          >统计仅反映当前数据库中的任务记录；由测试夹具或模拟适配器产生的数据不代表真实站点成功率。</span
        >
      </div>
      <template v-if="report">
        <div class="stat-grid">
          <article
            v-for="section in reportSections"
            :key="section.key"
            class="stat-card"
            :class="{ overview: section.key === 'overall' }"
            :data-testid="`stat-${section.key}`"
          >
            <header class="stat-card-header">
              <Activity v-if="section.key === 'overall'" :size="16" />
              <span class="stat-card-title">{{ section.title }}</span>
              <span class="rate-chip">{{ percent(section.value.successRate) }}</span>
            </header>
            <div class="stat-metrics">
              <div>
                <dt>总任务</dt>
                <dd>{{ section.value.totalCount }}</dd>
              </div>
              <div>
                <dt>闭环完成</dt>
                <dd>{{ section.value.completedCount }}</dd>
              </div>
              <div>
                <dt>成功</dt>
                <dd>{{ section.value.succeededCount }}</dd>
              </div>
              <div>
                <dt>失败</dt>
                <dd>{{ section.value.failedCount }}</dd>
              </div>
            </div>
            <dl class="stat-duration">
              <div>
                <dt>平均耗时</dt>
                <dd>{{ formatDuration(section.value.duration.averageMs) }}</dd>
              </div>
              <div>
                <dt>P50 / P95</dt>
                <dd>
                  {{ formatDuration(section.value.duration.p50Ms) }} /
                  {{ formatDuration(section.value.duration.p95Ms) }}
                </dd>
              </div>
            </dl>
          </article>
        </div>

        <section class="error-panel">
          <h2>错误分布（总体）</h2>
          <p v-if="report.overall.errorDistribution.length === 0" class="no-errors">
            <CircleCheck :size="16" />
            暂无终态错误记录
          </p>
          <ul v-else>
            <li v-for="item in report.overall.errorDistribution" :key="item.code" class="error-row">
              <code>{{ item.code }}</code>
              <span class="error-track">
                <span
                  class="error-bar"
                  :style="{ width: `${Math.round((item.count / maxErrorCount) * 100)}%` }"
                ></span>
              </span>
              <span class="error-count">{{ item.count }}</span>
            </li>
          </ul>
        </section>

        <p class="report-meta">
          生成时间 {{ formatTime(report.generatedAt) }} · 数据版本 {{ report.version }}
        </p>
      </template>
    </main>
  </div>
</template>
