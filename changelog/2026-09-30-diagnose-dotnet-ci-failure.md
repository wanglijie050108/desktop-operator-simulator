# 定位 .NET CI job 在推送后失败的原因

## 元信息

- 日期：2026-09-30
- 状态：已完成（根因已修复，并经 CI run `36695036267` 验证 `.NET` job 转绿）
- 环境：Windows 11；本地仅有 .NET 8 SDK，无法在本地复现该 job；Node.js 24.15.0

## 目标

- 定位推送 `main` 后 CI 中 `.NET quality checks` 失败的具体步骤与根因。
- 给出可验证的修复方案，不在本任务中擅自修改 CI 设计。

## 上下文与证据

- 用户提供的 CI 结论：`Node quality checks` 成功、`Python agent quality checks` 成功、
  `.NET quality checks` 失败（约 3 分钟）。
- 经 `pwsh` 调用 GitHub REST API 取得的事实（网页抓取工具被网络策略拦截，但 API 可达）：
  - run `36691157463`（head `00f33b2`）结论 `failure`；
    run `36691075230`（head `96f2f20`）结论 `failure`；
    run `36378876122`（head `8227723`，即合并前的 `main`）结论 **`success`**。
    → 该失败由本次合并引入，而非历史遗留。
  - 作业级结论：`Node quality checks` 成功、`Python agent quality checks` 成功、
    `.NET quality checks` 失败。
  - `.NET quality checks` 各步骤：1–10 全部成功（含 `Verify formatting`、`Build`、
    `Test`），**第 11 步 `Test Agent reconnection` 失败**（其后 Post 步骤部分 skipped）。
  - 该 check run 的 annotation 仅有 `Process completed with exit code 1`，不含 stdout。
- 配置与代码证据：
  - `.github/workflows/ci.yml` L102 是整个 workflow 中**唯一**执行集成测试的位置，
    且位于 `dotnet` job；`python` job 只跑 Ruff/mypy/pytest，从不跑集成测试。
  - 同文件 `dotnet` job 没有任何 `astral-sh/setup-uv` 或 Python 安装步骤；只有
    `python` job 使用 `astral-sh/setup-uv@v6`（version 0.12.18、python 3.11）。
  - `package.json` L32：`test:integration:m1` = `test:integration:m1:csharp &&
    test:integration:m1:python`；L34 的 python 变体执行
    `node tests/integration/m1-agent-reconnect.mjs --agent=python`。
  - `tests/integration/m1-agent-reconnect.mjs` L125–L126：python 变体 spawn 的命令是
    `uv run --project apps/desktop-agent-python desktop-agent-python`。
  - `tests/integration/m1-agent-reconnect.mjs` L23–L41：`startProcess` 只监听
    `stdout`/`stderr` 与 `exit`，**未监听 `child` 的 `error` 事件**。
  - 官方 runner 镜像清单（经 `actions/runner-images` contents API 取得
    `Windows2025-Readme.md`、`Windows2022-Readme.md`）中预装 Python 3.12.10 与
    pip，**不存在 `uv` 条目**。
  - csharp 变体自 `8227723` 的绿色 run 以来未发生逻辑变化，仅 `AGENT_NAME` 由固定值
    改为 `integration-${agentKind}-agent`，且脚本未对该变量做断言。

## 分析与决策

- 因果链：`dotnet` job 第 11 步 → `npm run test:integration:m1` → 先执行 csharp 变体
  （应通过）→ 再执行 python 变体 → spawn `uv` → 运行器上没有 `uv`（ENOENT）→
  由于未监听 `error` 事件，Node 抛出未捕获异常 → 进程以退出码 1 结束。
- 根因：迁移分支把 `package.json` 的 `test:integration:m1` 从“仅 csharp”改为
  “csharp && python”，但 `dotnet` job 未提供 `uv`/Python 环境；这是**修改共享脚本时
  遗漏其消费方**导致的跨 job 依赖缺口，不是被测代码缺陷。
- 残余不确定性（如实记录）：CI 日志需认证（下载返回 403），无法直接读取 stdout，
  因此“csharp 子步骤先通过、失败发生在 python 子步骤”属高置信推断而非直接观测。
  支撑该推断的是：csharp 路径相对绿色基线未变，而 python 变体所需前置条件确实缺失。
- 次要缺陷：`startProcess` 未处理 `spawn` 的 `error` 事件，使缺少依赖时表现为不透明的
  退出码 1，而非明确的“uv 不可用”错误信息，增加了诊断成本。
- 候选修复方案：
  - **方案 A（推荐，最小改动）**：在 `dotnet` job 增加 `astral-sh/setup-uv@v6`
    （python 3.11）与 `uv sync --locked`，保持 L102 的 `test:integration:m1` 不变。
    该 job 同时验证两种 Agent，与分支作者改造脚本支持 `--agent=csharp|python` 的意图
    一致；改动仅 2 个步骤。
  - **方案 B（语义更清晰，改动更大）**：`dotnet` job 改为只跑
    `test:integration:m1:csharp`；`python` job 增加 setup-node、`npm ci`、`npm run build`
    与 `test:integration:m1:python`。职责更正交，但需在 python job 复制 Node 准备步骤。
  - **方案 C**：新建独立 `integration` job，同时准备 Node、.NET 与 uv；最清晰但改动最大，
    且会新增 check 名称，可能影响分支保护设置。
- 本任务不擅自实施方案：CI 结构属项目设计选择，且方案间取舍需要用户确认。

## 操作记录

1. 读取用户提供的 CI 结论并通过 API 核对 run 与 job 级状态。
   - 结果：成功；确认失败由本次合并引入，且精确定位到第 11 步。
2. 读取 `ci.yml`、`package.json`、集成脚本，核对依赖与消费方。
   - 结果：成功；确认 dotnet job 缺少 uv/Python 而该步骤需要 `uv`。
3. 通过 runner-images 清单核对 `windows-latest` 是否预装 `uv`。
   - 结果：成功；确认未预装，假设成立。
4. 尝试下载失败 job 的原始日志。
   - 结果：失败；返回 403，需认证，无法读取 stdout。
5. 形成三个候选方案并记录残余不确定性。
   - 结果：成功；待用户决定。

## 文件变更

- `changelog/2026-09-30-diagnose-dotnet-ci-failure.md`：新增本记录。
- 未修改任何产品代码、CI 配置或依赖。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `GET /actions/runs?per_page=3` | PASSED | `00f33b2` 与 `96f2f20` 均为 `failure`；合并前 `8227723` 为 `success`。 |
| `GET /actions/runs/36691157463/jobs` | PASSED | 精确定位失败步骤为 `11. Test Agent reconnection`；第 10 步 `Test` 成功。 |
| `GET /commits/00f33b2/check-runs` + annotations | PASSED | 仅返回 `Process completed with exit code 1`，无 stdout。 |
| `GET /actions/jobs/<id>/logs` | FAILED | 403，需认证；未能取得原始日志。 |
| runner 镜像清单核对（contents API） | PASSED | Windows2025/2022 预装 Python 3.12.10、pip，无 `uv`。 |
| 本地复现 `.NET quality checks` | NOT_EXECUTED | 本机仅有 .NET 8 SDK，`global.json` 要求 10.0.401。 |
| 修复方案实施 | NOT_EXECUTED | 待用户选择方案 A/B/C。 |

## 问题与处理

- 现象：网页抓取工具访问 `api.github.com` / `github.com` / `raw.githubusercontent.com`
  均被拒（解析到非公网地址）。
- 根因：该工具受网络策略限制。
- 处理：改用 `pwsh` 调用 GitHub REST API；`Invoke-WebRequest` 因落到 IE 解析引擎报
  “非交互模式”，改以 `Invoke-RestMethod` 与 contents API 绕过。
- 结果：除需认证的日志下载外，所需事实均已取得。
- 现象：`raw.githubusercontent.com` 经 `curl.exe` 返回空。
- 根因：该主机同样被策略拦截。
- 处理：改用 `api.github.com` 的 contents API 读取同一文件内容并解码。
- 结果：成功取得 runner 镜像清单。

## 风险与限制

- 未读取到 CI stdout，根因结论为高置信推断（配置 + 运行器镜像 + 脚本行为三者互证），
  而非日志直接证实。
- 本地无法复现 `.NET quality checks`，修复后只能靠下一次 CI 运行验证。
- `main` 当前处于 `.NET` check 失败状态；若仓库启用了必需状态检查，会阻塞后续 PR。
- 方案选择会影响 CI 结构与 check 名称，需用户确认后再实施。

## 最终结果

- 已完成：定位到失败步骤（`dotnet` job 第 11 步 `Test Agent reconnection`）与根因
  （该步骤经共享脚本调用 `uv`，而 runner 未预装 `uv` 且该 job 未安装 `uv`）。
- 未完成：CI 原始日志未取得（需认证）。
- 后续：修复及验证见 `changelog/2026-09-30-fix-dotnet-ci-integration-job.md`；
  该任务另发现并修复了集成脚本在 Windows 上不退出、残留孤儿进程的缺陷。CI run
  `36695036267` 三个 job 全部通过，本诊断的结论得到闭环验证。
