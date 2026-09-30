# 修复 .NET job 的集成测试步骤并发现 Windows 进程清理缺陷

## 元信息

- 日期：2026-09-30
- 状态：进行中（`uv` 缺失已修复并本地验证；新发现的 Windows 进程清理缺陷待用户决定修法）
- 环境：Windows 11；Node.js 24.15.0；npm 11.12.1；uv 0.11.14；CPython 3.11.6；
  本地无 .NET 10 SDK

## 目标

- 让 `.NET quality checks` job 的 `Test Agent reconnection` 步骤在 `windows-latest`
  上通过，恢复两种 Agent 的集成测试覆盖。
- 在推送前取得本地证据，避免用一次失败的 CI 运行来发现问题。
- 不通过删除或跳过 python 集成测试来换取绿灯。

## 上下文与证据

- 前置诊断见 `changelog/2026-09-30-diagnose-dotnet-ci-failure.md`：该步骤经
  `package.json` 的 `test:integration:m1` 调用 `uv`，而 `dotnet` job 未安装 `uv`，
  且 runner 镜像未预装 `uv`。
- 本次实施的变更契约：
  - 预期行为：该 job 能启动两种 Agent 并完成注册、服务重启重连、急停 `PAUSED` 校验。
  - 保持不变：该 job 前 10 个步骤、`node` 与 `python` 两个 job、本地 `npm run check`
    的语义、`test:integration:m1` 脚本定义。
  - 禁止行为：从该步骤移除 python 变体、放宽断言、把集成测试改为非阻塞。
- 本地复现证据（安装 Node 依赖并构建后执行 CI 同款命令
  `npm run test:integration:m1:python`）：
  - 断言全部通过，脚本输出
    `{"agentKind":"python","result":"passed"}`，
    其中 `firstSeenAt`→`reconnectedAt`→`pausedAt` 三阶段时间戳齐全，覆盖注册、
    服务重启重连与急停 `PAUSED`。
  - **但进程不退出**：脚本持续运行数分钟。进程树核对显示 npm 包装器与脚本
    （`node tests/integration/m1-agent-reconnect.mjs --agent=python`）仍存活，
    控制服务器已退出，`uv.exe` 已退出，而 `uv` 拉起的
    `.venv\Scripts\python.exe` 及其子解释器成为**孤儿进程**仍在运行。
  - 决定性实验：强杀上述孤儿 python 进程后，脚本在 5 秒内立即退出，该次
    `npm run` 最终返回 `cmd exit = 0`。
  - 结论：脚本的清理逻辑只杀掉了直接子进程 `uv`，孤儿的 python 继承了
    `uv` 的 stdout/stderr 管道写端，使脚本的事件循环无法清空，进程永不退出。

## 分析与决策

- `uv` 缺失修复采用方案 A：在 `dotnet` job 内、`Test Agent reconnection` 之前增加
  `astral-sh/setup-uv@v6`（version 0.12.18、python 3.11）与
  `uv sync --project apps/desktop-agent-python --locked`，与 `python` job 的配置保持一致。
  选它而非方案 B/C 的理由：改动最小（仅新增 2 个步骤），保持该 job 同时验证两种
  Agent 的既有意图，不新增 check 名称从而不影响分支保护设置。
- **新发现改变了结论**：仅补 `uv` 不足以让 CI 转绿。本地证据表明，在有 `uv` 的环境下
  该步骤的断言会通过但进程不退出；在 CI 上这会表现为该步骤挂起到 job 的 10 分钟超时，
  即失败形态由“退出码 1”变成“超时”，仍然红。
- 候选修法：
  - **方案 (a)（推荐）**：修正测试脚本的进程清理——在 Windows 上按进程树终止
    （如 `taskkill /PID <pid> /T /F`），并在终止后销毁该子进程的 stdout/stderr 流，
    使事件循环能够清空。既解决挂起，也避免孤儿 Agent 进程残留。
  - 方案 (b)：不再用 `uv run` 启动 Agent，改为直接调用虚拟环境内的 python
    可执行文件（`Scripts\python.exe` / `bin/python`），使直接子进程就是 Agent 本身，
    终止它即终止 Agent。需要处理跨平台路径。
  - 方案 (c)：脚本结尾显式 `process.exit(0)`。实现最简，但只是绕过症状，仍会残留
    孤儿 Agent 进程，属治标。
- 未擅自实施方案 (a)/(b)/(c)：修改共享测试基础设施属设计选择，需用户确认。

## 操作记录

1. 读取 `ci.yml`，按方案 A 增加 `uv` 安装与依赖同步步骤。
   - 结果：成功；新增 12 行。
   - 影响：`.github/workflows/ci.yml`。
2. 用 YAML 解析器校验 workflow 结构，并复核 diff。
   - 结果：成功；三个 job 与 `dotnet` 的 12 个步骤顺序符合预期，diff 为纯新增。
3. 安装 Node 依赖并构建（`npm install`、`npm run build`）。
   - 结果：成功；259 个包，前端构建通过。
4. 本地执行 CI 同款命令 `npm run test:integration:m1:python`。
   - 结果：部分成功；断言 `result: passed`，但进程不退出（见上文证据）。
5. 核对进程树并做决定性实验（强杀孤儿进程）。
   - 结果：成功；脚本随即退出，命令返回 0，确认卡点性质。

## 文件变更

- `.github/workflows/ci.yml`：`dotnet` job 新增 `Set up uv and Python` 与
  `Install locked Python dependencies` 两个步骤（含说明为何该 job 也需要 uv 的注释）。
- `changelog/2026-09-30-fix-dotnet-ci-integration-job.md`：本记录。
- 本地环境产物（不入库）：`node_modules/`、`apps/desktop-agent-python/.venv/`、
  临时日志 `inttest.log`（已删除）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git diff -- .github/workflows/ci.yml` | PASSED | 仅新增 12 行，原有步骤未改动。 |
| YAML 解析校验（`uv run --with pyyaml`） | PASSED | 3 个 job；`dotnet` 步骤顺序正确（uv 安装在 `Test Agent reconnection` 之前）。 |
| 误输入 `.slnm` 的复核 | PASSED | 已立即改回 `.slnx`；全文件 `.slnm` 出现次数为 0。 |
| `npm install` | PASSED | 259 个包，0 漏洞。 |
| `npm run build` | PASSED | contracts / control-server / operator-web 构建通过。 |
| `npm run test:integration:m1:python`（断言） | PASSED | `result: passed`，注册、重连、急停 `PAUSED` 均验证通过。 |
| `npm run test:integration:m1:python`（进程退出） | FAILED | 断言通过后进程不退出；需外部强杀孤儿进程后才返回，暴露测试脚本清理缺陷。 |
| `npm run test:integration:m1:csharp` | NOT_EXECUTED | 本机无 .NET 10 SDK，无法构建 `DesktopAgent`。 |
| 修改后的 CI 实测 | NOT_EXECUTED | 尚未推送；且需先修好进程清理缺陷，否则只会得到超时失败。 |
| 真实 Windows 微信/桌面验证 | NOT_EXECUTED | 与本次改动无关。 |

## 问题与处理

- 现象：首次执行集成测试时整体长时间无输出，疑似挂死。
- 根因：脚本派生的孙进程继承了 stdout 管道写端，我先前用 `| Out-String` 捕获输出
  导致读取端等不到 EOF，命令永不返回；这是**捕获方式**造成的假象，掩盖了真实原因。
- 处理：改用文件重定向（`cmd /c "... > inttest.log 2>&1"`）捕获，并核对进程树。
- 结果：取得真实结果，并进一步定位到脚本自身的清理缺陷。
- 现象：编辑 workflow 时误将 `HumanOperationSimulator.slnx` 输成 `.slnm`。
- 根因：手工替换时的输入错误。
- 处理：立即改正，并用全文件检索确认 `.slnm` 出现次数为 0、diff 复核为纯新增。
- 结果：未把该错误带入提交。

## 风险与限制

- 修改后的 workflow 只能在 CI 上真正验证；本地无法执行 `dotnet` 相关步骤。
- 进程清理缺陷目前只在本地复现，其 CI 表现（超时而非退出码 1）是由本地证据推断的；
  未在 runner 上观测到。
- 本地复现依赖 `npm install` 产生的工作区依赖与 `.venv`，属开发环境产物，不入库。
- `main` 当前仍处于 `.NET` check 失败状态；在修好清理缺陷前推送只会把失败形态从
  退出码 1 变成 10 分钟超时。

## 最终结果

- 已完成：`dotnet` job 缺少 `uv` 的根因修复已实施并通过静态与本地验证；同时通过本地
  复现发现并定位了集成脚本在 Windows 上不退出、残留孤儿 Agent 进程的缺陷及其成因。
- 未完成：进程清理缺陷未修；修改未提交推送；CI 未实测。
- 下一步建议：确认修法（推荐方案 (a)）后实施，一次性推送，使 `.NET` job 真正转绿。
