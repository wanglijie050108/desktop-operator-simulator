# 修复 .NET job 的集成测试步骤并修复 Windows 进程清理缺陷

## 元信息

- 日期：2026-09-30
- 状态：已完成（本地验证与 CI 实测均通过）
- 环境：Windows 11；Node.js 24.15.0；npm 11.12.1；uv 0.11.14；CPython 3.11.6；
  本地无 .NET 10 SDK

## 目标

- 让 `.NET quality checks` job 的 `Test Agent reconnection` 步骤在 `windows-latest`
  上通过，恢复两种 Agent 的集成测试覆盖。
- 修复本地复现中发现的集成脚本清理缺陷：断言通过后进程不退出、残留孤儿 Agent 进程。
- 不通过删除或跳过 python 集成测试来换取绿灯。

## 上下文与证据

- 前置诊断见 `changelog/2026-09-30-diagnose-dotnet-ci-failure.md`：该步骤经
  `package.json` 的 `test:integration:m1` 调用 `uv`，而 `dotnet` job 未安装 `uv`，
  且 runner 镜像未预装 `uv`。
- 本次实施的变更契约：
  - 预期行为：该 job 能启动两种 Agent 并完成注册、服务重启重连、急停 `PAUSED` 校验；
    断言完成后脚本必须自行退出且不残留子进程。
  - 保持不变：该 job 其余步骤、`node` 与 `python` 两个 job、本地 `npm run check` 语义、
    脚本的断言逻辑与输出格式、两个 Agent 变体的行为。
  - 禁止行为：从该步骤移除 python 变体、放宽断言、用 `process.exit` 掩盖未清理的进程、
    改变非 Windows 平台的终止语义。
- 缺陷一证据（`uv` 缺失）：CI 步骤级结论显示第 12 步 `Test Agent reconnection` 失败，
  而 `dotnet test` 成功；该 job 无 `astral-sh/setup-uv` 步骤；runner 镜像清单
  （Windows2025/2022）预装 Python 3.12.10 与 pip，**无 `uv`**。
- 缺陷二证据（进程不退出）：
  - 本地执行 `npm run test:integration:m1:python`，脚本输出
    `{"agentKind":"python","result":"passed"}`，`firstSeenAt`→`reconnectedAt`→`pausedAt`
    三阶段时间戳齐全，即注册、服务重启重连、急停 `PAUSED` 全部通过。
  - 但脚本持续运行数分钟不退出。进程树核对：npm 包装器与脚本仍存活、控制服务器已退出、
    `uv.exe` 已退出，而 `uv` 拉起的 `.venv\Scripts\python.exe` 及其子解释器成为孤儿仍在运行。
  - 决定性实验：强杀孤儿 python 进程后，脚本 5 秒内立即退出，该次命令返回 `cmd exit = 0`。
  - 结论：`stopProcess` 只终止直接子进程 `uv`，孤儿的 python 继承了 `uv` 的
    stdout/stderr 管道写端，使 Node 事件循环无法清空，进程永不退出。
  - 影响判断：在有 `uv` 的 CI 上，该步骤会由“退出码 1”变为“挂起到 10 分钟超时”，
    即单修缺陷一不足以让 CI 转绿。

## 分析与决策

- 缺陷一采用方案 A：在 `dotnet` job 内、`Test Agent reconnection` 之前增加
  `astral-sh/setup-uv@v6`（version 0.12.18、python 3.11）与
  `uv sync --project apps/desktop-agent-python --locked`，与 `python` job 保持一致。
  选它而非方案 B/C：改动最小（仅 2 个步骤），保持该 job 同时验证两种 Agent 的既有意图，
  不新增 check 名称从而不影响分支保护设置。
- 缺陷二按用户选择采用方案 (a)：在 Windows 上以 `taskkill /PID <pid> /T /F` 终止**进程树**
  （同时消除孤儿），并在终止后销毁该子进程的 stdout/stderr 流作为防御；非 Windows 平台
  保持原有 `SIGTERM` 语义。拒绝方案 (c)（脚本结尾 `process.exit`），因为那只是绕过症状、
  仍残留孤儿 Agent 进程。
- 终止失败路径显式处理：若 `taskkill` 未成功（`status !== 0`）则回退 `child.kill("SIGTERM")`；
  若连信号都无法发出（`kill` 返回 false），则不无限等待 `exit`，直接进入流释放。
- 未额外增加“有界等待超时”：主因已由进程树终止消除，加入计时器属未被证据支持的额外复杂度；
  该取舍记入风险与限制。

## 操作记录

1. 读取 `ci.yml`，按方案 A 增加 `uv` 安装与依赖同步步骤。
   - 结果：成功；新增 12 行（纯新增，含说明注释）。
2. 用 YAML 解析器校验 workflow 结构并复核 diff。
   - 结果：成功；三个 job 与 `dotnet` 的 12 个步骤顺序符合预期。
3. 安装 Node 依赖并构建（`npm install`、`npm run build`）。
   - 结果：成功；259 个包，前端构建通过。
4. 本地执行 CI 同款命令，发现断言通过但进程不退出。
   - 结果：部分成功；据此定位缺陷二。
5. 核对进程树并做决定性实验（强杀孤儿进程）。
   - 结果：成功；确认卡点性质与成因。
6. 按方案 (a) 修改 `tests/integration/m1-agent-reconnect.mjs` 的 `stopProcess`。
   - 结果：成功；Windows 终止进程树，跨平台释放 stdio。
7. 分层验证：语法、格式、lint、集成测试两次运行、Node 质量门。
   - 结果：集成测试两次均 `exit=0`、约 5 秒完成、`result: passed`、零残留进程；
     Node 质量门在 lint 阶段失败，但原因是本地 `.venv` 目录未被 ESLint 忽略（见问题与处理）。

## 文件变更

- `.github/workflows/ci.yml`：`dotnet` job 新增 `Set up uv and Python` 与
  `Install locked Python dependencies` 两个步骤。
- `tests/integration/m1-agent-reconnect.mjs`：`stopProcess` 改为按进程树终止并释放
  stdio 流；导入增加 `spawnSync`。
- `changelog/2026-09-30-fix-dotnet-ci-integration-job.md`：本记录。
- 本地环境产物（不入库）：`node_modules/`、`apps/desktop-agent-python/.venv/`；
  临时日志 `inttest*.log`（已删除）；`npm install` 对 `package-lock.json` 的一行
  无关改动（`hasInstallScript`）已还原。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git diff -- .github/workflows/ci.yml` | PASSED | 仅新增 12 行，原有步骤未改动。 |
| YAML 解析校验（`uv run --with pyyaml`） | PASSED | 3 个 job；`dotnet` 步骤顺序正确。 |
| 误输入 `.slnm` 的复核 | PASSED | 已改回 `.slnx`，全文件 `.slnm` 出现次数为 0。 |
| `node --check tests/integration/m1-agent-reconnect.mjs` | PASSED | 退出码 0。 |
| `npx prettier --check <脚本>` | PASSED | All matched files use Prettier code style。 |
| `npx eslint <脚本>` | PASSED | 退出码 0，无告警。 |
| `npm run test:integration:m1:python`（修复前） | FAILED | 断言 `result: passed`，但进程不退出；需外部强杀孤儿才返回。 |
| `npm run test:integration:m1:python`（修复后，第 1 次） | PASSED | `exit=0`，**5.1 秒**完成，`result: passed`，残留进程 0。 |
| `npm run test:integration:m1:python`（修复后，第 2 次） | PASSED | `exit=0`，**5.0 秒**，`result: passed`，残留进程 0。 |
| `npm run check:node` | FAILED | 格式与类型检查通过；ESLint 报 3 个解析错误，均来自 `.venv` 内的第三方 `.js` 文件，与本改动无关。 |
| `npm run test:integration:m1:csharp` | NOT_EXECUTED | 本机无 .NET 10 SDK，无法构建 `DesktopAgent`。 |
| 修改后 CI 实测（run `36695036267`，head `704905f`） | PASSED | 三个 job 全部 `success`：`Node quality checks`、`Python agent quality checks`、`.NET quality checks`。`.NET` job 的 `Test Agent reconnection` 步骤通过，两种 Agent 变体均在实际 runner 上验证。 |
| 真实 Windows 微信/桌面验证 | NOT_EXECUTED | 与本次改动无关。 |

## 问题与处理

- 现象：首次执行集成测试时长时间无输出，疑似挂死。
- 根因：脚本派生的孙进程继承了 stdout 管道写端，我先前用 `| Out-String` 捕获输出导致
  读取端等不到 EOF；这是**捕获方式**造成的假象，掩盖了真实原因。
- 处理：改用文件重定向捕获，并核对进程树。
- 结果：取得真实结果并进一步定位到脚本自身的清理缺陷。
- 现象：编辑 workflow 时误将 `HumanOperationSimulator.slnx` 输成 `.slnm`。
- 根因：手工替换时的输入错误。
- 处理：立即改正，并用全文件检索与 diff 复核确认。
- 结果：未把该错误带入提交。
- 现象：`npm run check:node` 的 ESLint 阶段报 3 个解析错误，全部指向
  `apps/desktop-agent-python/.venv/Lib/site-packages/` 下的第三方 `.js` 文件。
- 根因：`eslint.config.mjs` 的 `ignores` 只列了 `**/coverage/**`、`**/dist/**`、
  `**/node_modules/**`，未包含 `.venv`，而 `.gitignore` 已忽略 `.venv/`；ESLint 的
  type-aware 模式因此尝试把这些文件纳入项目服务。
- 处理：本次不改（属独立缺陷）；已确认它**不影响 CI**——`node` job 不创建 `.venv`，
  `dotnet` job 虽会 `uv sync` 但从不执行 ESLint，`python` job 不跑 npm 脚本。
- 结果：属本地开发体验缺陷，待用户决定是否单独修复。

## 风险与限制

- CI 实测已通过，因此 `taskkill /T /F` 对 `dotnet run` 进程树的行为已在实际
  `windows-latest` runner 上得到验证（`test:integration:m1` 先跑 csharp 再跑 python，
  两者均需通过该步骤）；本地仍无法单独执行 csharp 变体（缺 .NET 10）。
- 未加入“有界等待”：若未来某种 Agent 实现无法被终止，清理阶段仍可能挂起；当前证据
  不支持为此增加复杂度。
- 缺陷二若未修复，其在 CI 上的表现（超时而非退出码 1）由本地证据推断；该推断未被
  runner 直接观测，但修复后的 green run 已排除该风险。
- `npm run check` 在本机因 ESLint 未忽略 `.venv` 而无法整体转绿；这是独立缺陷，不阻塞 CI。
- `startProcess` 仍未监听 `spawn` 的 `error` 事件：若未来再次缺少可执行文件，报错仍是
  不透明的退出码 1 而非明确的 ENOENT 信息。

## 最终结果

- 已完成：`dotnet` job 的 `uv` 缺失已修复；集成脚本在 Windows 上不退出与孤儿进程残留的
  缺陷已按方案 (a) 修复，并经两次本地运行验证（各约 5 秒完成、`exit=0`、零残留进程）；
  推送后 CI run `36695036267` 三个 job 全部通过，`.NET` check 由红转绿。
- 未完成：`npm run check` 的整体绿灯被独立的 ESLint/.venv 缺陷阻塞；未执行任何真实环境验证。
- 下一步建议：决定是否修复 `eslint.config.mjs` 未忽略 `.venv` 的独立缺陷；随后按计划
  执行只读微信 UIA 取证推进 M0。
