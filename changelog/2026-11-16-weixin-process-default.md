# 微信 4.x 进程名默认值改为 Weixin.exe

## 元信息

- 日期：2026-11-16
- 状态：已完成（默认值与文档更新；实机运行未执行）
- 环境：Windows 11；Python 3.11.18（uv 托管）
- 分支：`feature/pywinauto1`

## 目标

- 让 Agent、只读取证工具和收发 Spike 在未显式配置时直接命中微信 4.x 的
  `Weixin.exe`，同时保留对 3.x `WeChat.exe` 的显式支持。

## 上下文与证据

- 用户反馈：新版本微信的进程名已改为 `Weixin.exe`。
- 既有代码：`uia_inspection.py` 与 `wechat_spike.py` 的白名单已同时包含
  `wechat` 和 `weixin`，但所有默认值仍是 `WeChat.exe`；不显式配置时会
  `TARGET_APP_NOT_FOUND`。
- 默认值分布：`config.py`（两处）、`windows_executor.py`（构造函数与工厂）、
  `wechat_source.py`、`uia_inspection.py`、`wechat_spike.py`。
- 运行期 Agent 使用 `AGENT_WECHAT_PROCESS`；取证与 Spike 使用
  `WECHAT_PROCESS_NAME`，两者此前都默认 `WeChat.exe`。

## 分析与决策

- 默认值统一改为 `Weixin.exe`：这是 4.x 的实际进程名，也是本项目目标版本
  （4.1.15 系列）对应的名称。
- 不删除旧名字支持：`WeChat.exe` 仍可显式配置，3.x 环境不受影响。
- 进程名比较本就 casefold 并去掉 `.exe`，因此 `Weixin.exe`/`weixin` 等价。
- 运行期 Agent 还要求 `AGENT_ALLOWED_PROCESSES` 含同一进程名，否则策略校验拒绝执行；
  已在安装手册补充该约束。

## 操作记录

1. 核对所有默认值与白名单，确认只有默认值需要调整。
   - 结果：成功。
2. 修改 5 个源码文件中的 6 处默认值。
   - 结果：成功。
3. 更新 `README.md`、`docs/07`、`docs/09` 的命令与配置表。
   - 结果：成功。
4. 新增 3 个默认值断言并修正 2 个受影响的既有用例。
   - 结果：成功。

## 文件变更

- `apps/desktop-agent-python/src/desktop_agent/config.py`：`wechat_process_name` 默认值
  与 `AGENT_WECHAT_PROCESS` 解析默认值改为 `Weixin.exe`。
- `apps/desktop-agent-python/src/desktop_agent/windows_executor.py`：执行器构造函数与
  工厂默认值改为 `Weixin.exe`。
- `apps/desktop-agent-python/src/desktop_agent/wechat_source.py`：默认进程名。
- `apps/desktop-agent-python/src/desktop_agent/uia_inspection.py`：默认进程名。
- `apps/desktop-agent-python/src/desktop_agent/wechat_spike.py`：默认进程名。
- `apps/desktop-agent-python/tests/`：新增默认值断言，修正受影响的 2 个用例。
- `README.md`、`docs/07-windows-test-environment.md`、`docs/09-installation-guide.md`：
  命令与配置表更新，并补充 `AGENT_WECHAT_PROCESS` 行。
- `changelog/2026-11-16-weixin-process-default.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `uv run ruff format src tests` | PASSED | 31 个文件无需改动。 |
| `uv run ruff check src tests` | PASSED | All checks passed。 |
| `uv run mypy src tests` | PASSED | 31 个源文件无问题（strict）。 |
| `npm run check:python` | PASSED | **229 passed, 2 skipped**；总覆盖率 92.69%。 |
| 微信实机取证/收发 | NOT_EXECUTED | 需要目标机与测试账号。 |

## 问题与处理

- 现象：首次改默认值后 2 个用例失败（一个断言旧默认值，一个 Fake 后端仍期望
  `wechat`）。
- 根因：测试中的显式期望未随默认值更新。
- 处理：断言改为 `weixin`；CLI 集成用例显式设置 `WECHAT_PROCESS_NAME=WeChat.exe`，
  保持其只验证 CLI 装配、不依赖默认值。
- 结果：全部通过。

## 风险与限制

- 若目标机仍是微信 3.x，必须显式设置 `AGENT_WECHAT_PROCESS=WeChat.exe` 与
  `WECHAT_PROCESS_NAME=WeChat.exe`，并把 `wechat.exe` 加入 `AGENT_ALLOWED_PROCESSES`。
- 未实机核对 `Weixin.exe` 的实际窗口结构与标题控件；Spike B 的 R-01 仍未解除。

## 最终结果

- 默认配置现在与微信 4.x 一致，旧版本仍可显式覆盖。
- 质量门全部通过；未执行任何真实微信操作。
