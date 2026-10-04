# Windows 平台迁移合并与 CI 转绿（2026-09-30 合并摘要）

> 本文件合并自 8 条原始 changelog（原文件名见文末索引）。原文可用
> `git show <commit>:changelog/<原文件名>` 找回。

## 阶段目标

- 克隆仓库并只读通读规范、设计文档与代码，判定项目定位与本机可执行范围。
- 审查 `feature/pywinauto-desktop-agent`，在真实 Windows 上实测其声明的质量门。
- 归档合并前的 `main`，把迁移分支并入 `main` 并推送远端。
- 修复随合并进入 `main` 的 Windows Python 质量门缺陷，且不放宽 `strict`。
- 诊断并修复 CI 中 `.NET quality checks` 的失败，恢复两种 Agent 的集成覆盖。
- 新增 `CLAUDE.md`，使 Claude Code 自动遵守仓库强制规范。

## 关键决策与依据

- **迁移而非重写**：保留 Node 控制平面（Fastify + SQLite + TS）、Vue 3 与契约，用 Python/pywinauto 替换 C#/FlaUI 桌面执行角色，C# 留作回退基线；依据是导师确认的窄口径“只替换 C#”，且真实微信联动为必须项。
- **现状结论**：`main` 桌面执行仍是失败关闭占位（`PlaceholderDesktopActionExecutor` 返回 `NOT_IMPLEMENTED`），与 `docs/08` 一致；本机 .NET 8.0.206 低于 `global.json` 要求的 10.0.401、Python 3.14.4 与分支要求的 3.11 不符，故未构建测试。
- **迁移分支审查**：领先 `main` 11 个提交（HEAD `0bde877`）、39 个新文件约 6000 行，`apps/desktop-agent-python/` 含 14 源文件 / 13 测试文件；其 changelog 中真实 Windows 项全为 `BLOCKED`（原因统一为“当前为 macOS”），而本机即目标机（微信 4.x `Weixin.exe` 运行中）。
- **归档分支**：`archive/main-baseline-20260930` 指向 `8227723`；既有远端 `archive/csharp-agent-baseline-20260928` 指向共同祖先 `675edee`，未覆盖 `main` 后两个提交，不足以替代。
- **合并方式**：`git merge --no-ff`（迁移分支并入 `main`，不 rebase）保留显式合并提交，便于整体回退与审计；`git merge-tree --write-tree` 预判干净树、退出码 0。
- **合并结果**：合并提交 `e591d93`，ort 无冲突，54 文件 +6398/−112，`main` 领先 `origin/main` 12 个提交；`git diff <branch> main -- apps/desktop-agent-python` 为空，证明 Python 代码逐字节未变，合并前实测结论可直接沿用。
- **语义冲突复核**：双方自共同祖先仅共同改动 `.trae/skills/human-operation-simulator-guardrails/SKILL.md`，双向 diff 无差异、质量闭环段落保留；`8227723` 的 `AgentClientTests.cs` 与 `2026-09-28-fix-dotnet-ci-flake.md` 亦保留。
- **Python 缺陷一根因**：`windows_backend.py` L152/L163 的 `ctypes.windll` 带 `# type: ignore[attr-defined]`，在 Windows（stub 定义了 `windll`）变为多余，触发 mypy `strict` 的 `warn_unused_ignores` → `unused-ignore` 并中断质量门。
- **缺陷一修复**：在 `pyproject.toml` 为该模块加 mypy override，仅关闭其 `unused-ignore`；拒绝 `getattr(ctypes, "windll")`（会把 `user32` 弱化为 `Any`，丢失 `GetSystemMetrics`/`GetDpiForSystem`/`keybd_event` 的静态检查），拒绝删除 ignore（会破坏 macOS/Linux）。
- **Python 缺陷二根因**：`tests/test_config.py`、`tests/test_uia_inspection.py` 断言 `str(Path) == "C:/automation-data/artifacts"`，Windows 下 `Path` 渲染为反斜杠导致失败；改为比较 `Path` 对象（`config.py` L131 以 `Path(...)` 构造目标值，语义等价）。
- **CI 失败根因**：`dotnet` job 的 `Test Agent reconnection` → `npm run test:integration:m1` → python 变体 spawn `uv run --project apps/desktop-agent-python`，而 `windows-latest` 镜像清单（Windows2025/2022）无 `uv` 且该 job 未安装 → ENOENT；`tests/integration/m1-agent-reconnect.mjs` L23–L41 未监听 `child` 的 `error` 事件，致未捕获异常与退出码 1。合并前 `8227723` 的 run 为 success，故属合并引入。
- **CI 修复取方案 A**：在 `dotnet` job 内该步骤前新增 `astral-sh/setup-uv@v6`（0.12.18、python 3.11）与 `uv sync --project apps/desktop-agent-python --locked`（+12 行、2 步），保持同 job 验证两种 Agent，且不新增 check 名称以免影响分支保护。
- **进程清理缺陷与修复**：`stopProcess` 只杀直接子进程 `uv`，孤儿 `.venv\Scripts\python.exe` 继承 stdout/stderr 管道写端，Node 事件循环无法清空，断言通过也永不退出（在 CI 上将表现为超时而非退出码 1）；改 Windows 用 `taskkill /PID <pid> /T /F` 终止进程树并随后销毁 stdio 流，非 Windows 保持 `SIGTERM`，`taskkill` 失败回退 `child.kill("SIGTERM")`，拒绝 `process.exit` 掩盖残留。
- **推送操作边界**：首次 `git push` 因本机凭据对仓库无写权限被拒（HTTP 403），只读 `ls-remote` 正常；经账号持有人授权完成凭据切换后推送成功（`main` `8227723..96f2f20`，归档分支新建）。授权由持有人本人完成，不索取、不代填、不记录任何口令、令牌或密钥。
- **CLAUDE.md 原因**：仓库有 `AGENTS.md` 与守卫 Skill，但 Claude Code 默认只自动加载 `CLAUDE.md`（基线实测“自动加载的规范文件：无”“我没有自动读 AGENTS.md”）；故新建仅含 `@AGENTS.md` 的入口（导入而非复制正文，避免第二套规范），不额外注入 317 行 `SKILL.md` 以省上下文，经用户确认纳入版本库。

## 验证证据

| 范围 / 命令 | 状态 | 结果 |
|---|---|---|
| 克隆与现状复核（`git clone` / `git status --short --branch`） | PASSED | `main` 工作树干净、与 `origin/main` 一致；占位执行器与 `docs/08` 一致 |
| 分支审查（`rev-list --count` / 逐提交 `--name-only`） | PASSED | 领先 11 个提交、39 个新增文件约 6000 行；HEAD `0bde877` |
| `npm run check:python`（合并前 Windows） | FAILED | Ruff 通过；mypy 报 `windows_backend.py` L152/L163 `unused-ignore` 2 项并中断 |
| `npm run test:python`（合并前 Windows） | FAILED | 107 通过、2 失败、2 跳过；覆盖率 91.45%（门槛 90%）达标 |
| `git merge-tree --write-tree` / `git merge --no-ff` | PASSED | 干净树、退出码 0；无冲突，`e591d93`，54 文件 +6398/−112，`origin/main...main` = `0 12` |
| 合并正确性核验（SKILL.md 双向 diff、旧 `main` 独有文件、Python 目录 diff、归档指向） | PASSED | 两侧无差异、质量闭环段落与两份旧 changelog 保留；Python diff 为空；归档 = `8227723` |
| 修复后 `npm run check:python`（Windows） | PASSED | 退出码 0；109 通过、2 跳过；覆盖率 91.82%（门槛 90%） |
| `uv run mypy`（win32 与 `--platform linux`）/ `ruff format --check` | PASSED | 均 `no issues found in 25 source files`；`26 files already formatted` |
| CI run `36691157463`（`00f33b2`）、`36691075230`（`96f2f20`） | FAILED | Node ✓、Python agent ✓、`.NET` ✗；失败点 `11. Test Agent reconnection`，annotation 仅 `exit code 1` |
| CI run `36378876122`（`8227723`，合并前 `main`） | PASSED | `success`，证明 `.NET` 失败由本次合并引入 |
| runner 镜像清单核对（`actions/runner-images` contents API） | PASSED | Windows2025/2022 预装 Python 3.12.10 与 pip，**无 `uv`** |
| `GET /actions/jobs/<id>/logs` | FAILED | 403 需认证，CI 原始 stdout 未取得 |
| `npm run test:integration:m1:python`（修复前） | FAILED | 断言 `result: passed`、三阶段时间戳齐全，但进程不退出、孤儿 python 残留 |
| `npm run test:integration:m1:python`（修复后 ×2） | PASSED | 均 `exit=0`，5.1 秒 / 5.0 秒，`result: passed`，残留进程 0 |
| CI run `36695036267`（head `704905f`） | PASSED | 三 job 全部 `success`（Node、Python agent、`.NET quality checks`），两种 Agent 变体均在实际 runner 验证 |
| `npm run check:node`（本地） | FAILED | ESLint 3 个解析错误，全来自 `.venv` 第三方 `.js`（`ignores` 未含 `.venv`）；三个 CI job 均不触发 |
| `check:dotnet` / `test:integration:m1:csharp` | NOT_EXECUTED | 本机无 .NET 10 SDK（要求 10.0.401，仅有 8.0.101/8.0.206） |
| M0 Spike（notepad / wechat-inspect） | NOT_EXECUTED | 会抢占前台窗口、覆盖剪贴板或在真实微信上取证，需用户显式授权 |
| CLAUDE.md 前后对照实测（同一问题） | PASSED | 建立前“自动加载：无”；建立后自动加载 `CLAUDE.md` 并经 `@AGENTS.md` 引入 `AGENTS.md`，能陈述强制流程 |

## 未完成与后续

- 真实微信联动未实现：真实 selector、`WeChatMessageSource`、Node 桌面命令结果桥与真实 `ChatReplyAdapter` 均为后续工作，默认执行角色未切换。
- M0 Spike（记事本、只读微信 UIA 取证）未执行，真实 pywinauto 兼容性、两秒急停与输入释放无实机证据，需用户显式授权。
- 整仓 `npm run check` 不可达绿：`check:dotnet` 需 .NET 10 SDK；`check:node` 受 `eslint.config.mjs` 未忽略 `.venv` 的独立缺陷阻塞，待用户决定是否修复。
- 全局 `~/.gitconfig` 的 `http.sslverify=false`（TLS 校验禁用）仅记录风险、未擅自修改，待用户决定。
- `startProcess` 仍未监听 `spawn` 的 `error` 事件，未来缺可执行文件时仍只会得到不透明的退出码 1。

## 风险与限制

- 迁移分支 changelog 的“全绿”带平台前提（仅 macOS）；非 Windows 结论由 `mypy --platform linux` 近似验证，本机无 macOS/Linux 主机真实执行。
- CI 原始日志因需认证（403）未取得，`.NET` 根因是配置 + runner 镜像 + 脚本行为互证的高置信推断；修复后 run `36695036267` 转绿已闭环排除该风险。
- mypy override 使该模块 `unused-ignore` 不再报告，未来新增真正多余的 ignore 不会被发现；`coverage.omit` 仍排除 `windows_backend.py`，91.82% 只覆盖跨平台逻辑。
- 本地无 .NET 10 SDK，`dotnet` job 与 csharp 集成变体只能靠 CI 验证；未加“有界等待超时”，若未来某 Agent 无法被终止，清理阶段仍可能挂起。

## 原始条目索引

- `changelog/2026-09-30-repo-clone-and-status-review.md` — 克隆并只读通读；`main` 干净，真实执行仍为失败关闭占位，工具链版本不符故未构建测试。
- `changelog/2026-09-30-pywinauto-branch-review.md` — 审查迁移分支（领先 11 提交、HEAD `0bde877`），Windows 实测出 2 项 mypy + 2 项 pytest 跨平台缺陷。
- `changelog/2026-09-30-archive-main-and-merge-pywinauto.md` — 归档 `main` 为 `archive/main-baseline-20260930`（`8227723`），`--no-ff` 无冲突合并产生 `e591d93` 并推送。
- `changelog/2026-09-30-switch-github-credentials-and-push.md` — 推送被拒（403）后经持有人授权完成凭据切换，`main` 与归档分支推送成功。
- `changelog/2026-09-30-fix-windows-python-quality-gate.md` — 修复 Windows Python 质量门：mypy 模块 override + 两处路径断言改比较 `Path`，通过且覆盖率 91.82%。
- `changelog/2026-09-30-diagnose-dotnet-ci-failure.md` — 定位 `.NET` job 失败：集成步骤调用 `uv` 而 runner 未预装，属合并引入的跨 job 依赖缺口。
- `changelog/2026-09-30-fix-dotnet-ci-integration-job.md` — 该 job 安装 `uv`，并修集成脚本不退出/孤儿进程缺陷，CI run `36695036267` 三 job 全绿。
- `changelog/2026-09-30-add-claude-md-entry.md` — 新增 `CLAUDE.md`（`@AGENTS.md`）使 Claude Code 自动加载强制规范，经对照实测生效。
