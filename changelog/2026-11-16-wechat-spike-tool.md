# 实现微信收发 Spike B 的可重复执行工具与失败关闭校验

## 元信息

- 日期：2026-11-16
- 状态：已完成（工具与单测完成；目标微信实机运行未执行）
- 环境：Windows 11；uv 0.13.8（本次安装）；uv 托管的 Python 3.11.18；未在目标微信窗口执行
- 分支：`feature/pywinauto1`

## 目标

- 为 M0 Spike B 提供与记事本 Spike 同构的可重复执行工具：
  `desktop-agent-wechat-spike` / `npm run test:spike:m0:wechat-send`。
- 每轮向**已校准的测试会话**发送唯一文本，并通过 UIA 读回验证；输出 JSON 报告。
- 在控件未校准、会话不匹配、窗口未前台、确认缺失时失败关闭，绝不注入输入。
- 报告不落盘会话名与消息正文。

## 上下文与证据

- `docs/04` M0 退出标准：微信收发必须通过，20 次成功率 ≥90%。
- `docs/07` §12 Spike B：先做只读 UIA 取证，再定位测试会话、读取消息、回复固定文本。
- `docs/08`“未完成”：`wechat_source.py` 读取与 `WECHAT_SEND_TEXT` 发送均已实现，
  但真实控件定位未校准。
- 既有实现：`notepad_spike.py` 与 `notepad_mouse_spike.py` 提供报告结构、CLI 与
  失败关闭范式；`windows_backend.send_chat_text` 使用剪贴板粘贴 + Enter；
  `uia_inspection.RawUiaControlNode` 是控件树记录类型；`find_window` 在多个顶层窗口时
  返回 `MULTIPLE_TARGET_WINDOWS`。
- 关键未知：微信会话标题控件的 AutomationId/ClassName 尚未取证（风险 R-01）。

## 分析与决策

- **不实现会话搜索**：`changelog/2026-10-11` 已确认搜索框控件未知，本工具要求
  操作者先手动打开测试会话，再通过配置的标题定位器校验。
- **标题定位器必须显式配置**：支持 `AutomationId`（要求唯一命中）或
  `ClassName` + 序号；两者都不配置时拒绝启动。这样在取证完成前无法误发。
- **双重会话校验**：激活前校验一次，激活后、发送前再校验一次；不一致即
  `CONVERSATION_CHANGED`，不发消息。
- **发送后读回**：轮询控件树直到唯一探测文本出现在可见节点中，超时即
  `MESSAGE_NOT_OBSERVED`；同时验证“发送成功”和“消息可被读取”。
- **不经过执行器**：直接调用 backend 的 `activate`/`is_foreground`/`send_chat_text`，
  与执行器分支保持相同的失败关闭顺序，但避免把 Spike 与整条命令队列耦合。
- **默认不发送**：仅当 `WECHAT_SPIKE_CONFIRM=1` 时才可能注入输入。
- **隐私边界**：报告只含会话名的 SHA-256 与长度；探测文本只存在内存中。

## 操作记录

1. 阅读 Python Agent 的 Spike、UIA 取证、Windows backend 与协议实现。
   - 结果：成功。确认可复用 `RawUiaControlNode`、`send_chat_text` 与报告范式。
2. 新增 `wechat_spike.py`、单测、入口点与 npm 脚本。
   - 结果：成功。
3. 本机环境缺少 Python 3.11 与 uv：用 `D:/python3.12/python.exe -m pip install uv`
   安装 uv 0.13.8，`uv sync` 由 uv 提供 Python 3.11.18 并安装锁文件依赖。
   - 结果：成功。仅影响本机开发环境，未提交任何环境文件。
4. 运行格式、lint、mypy、全量 pytest 与仓库 Python 质量门。
   - 结果：全部通过；新模块覆盖率 100%。
5. 更新 README、`docs/07` Spike B、`docs/08` M0 状态。
   - 结果：成功。

## 文件变更

- `apps/desktop-agent-python/src/desktop_agent/wechat_spike.py`：新增收发 Spike
  （选项解析、标题定位、双检、读回、脱敏报告、CLI）。
- `apps/desktop-agent-python/tests/test_wechat_spike.py`：新增 34 个用例，覆盖正常、
  误配、未确认、非前台、会话变化、读回失败、释放失败、报告脱敏与 CLI。
- `apps/desktop-agent-python/pyproject.toml`：新增 `desktop-agent-wechat-spike` 入口。
- `package.json`：新增 `test:spike:m0:wechat-send` 脚本。
- `README.md`、`docs/07-windows-test-environment.md`：补充运行方式与失败关闭语义。
- `docs/08-development-status.md`：M0 记录“工具已提供、实机未执行”，更新日期。
- `changelog/2026-11-16-wechat-spike-tool.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `uv run ruff format src/desktop_agent/wechat_spike.py tests/test_wechat_spike.py` | PASSED | 格式化完成。 |
| `uv run ruff check src tests` | PASSED | All checks passed。 |
| `uv run mypy src tests` | PASSED | 31 个源文件无问题（strict）。 |
| `uv run pytest -q` | PASSED | **226 passed, 2 skipped**；总覆盖率 **92.69%**；`wechat_spike.py` **100%**。 |
| `npm run check:python` | PASSED | 仓库 Python 质量门通过（同上）。 |
| `npx prettier --check package.json` | PASSED | 格式符合。 |
| `npm run check:node` | NOT_EXECUTED | 本次未改 Node 源码；仅改 `package.json` 脚本，已用 Prettier 校验。 |
| 微信实机 20 轮 | NOT_EXECUTED | 依赖目标机控件取证、测试账号与已打开的测试会话。 |

## 问题与处理

- 现象：本机 `uv` 不在 PATH，`D:\python3.11\python.exe` 不存在。
- 根因：开发环境未按 `docs/07` 安装 uv；Python 3.11 安装损坏/缺失。
- 处理：用现有 Python 3.12 安装 uv，由 `uv sync` 获取 3.11.18 并安装锁文件依赖。
- 结果：质量门可执行；未修改仓库依赖版本，`uv.lock` 无变化。

## 风险与限制

- **未实机验证**：真实微信是否暴露可定位的标题控件仍是 R-01 的核心未知；若没有
  可用 AutomationId/ClassName，本工具会失败关闭，需要按 `docs/06` 评估备选对象。
- `MESSAGE_NOT_OBSERVED` 同时覆盖“没发出去”和“发出去了但 UIA 读不到”，单轮错误码
  无法区分，需要结合截图或人工复核。
- 微信存在多个顶层窗口时 `find_window` 会返回 `MULTIPLE_TARGET_WINDOWS`，属于预期的
  失败关闭；运行前需关闭多余窗口。
- 发送行为不可逆：工具只能在专用测试会话中使用，`WECHAT_SPIKE_CONFIRM=1` 是最后一道
  人工确认。
- 读回轮询每次遍历最多 4000 个节点；大控件树下单轮可能较慢，超时只保证“至少尝试过”。

## 最终结果

- 已提供可重复执行的微信收发 Spike 工具，具备未校准拒绝、双重会话校验、读回验证与
  脱敏报告。
- 单测与静态检查全部通过；新模块覆盖率 100%。
- 未进行任何真实微信操作；下一步是在目标机完成 UIA 取证 → 配置标题定位器 →
  运行 20 轮并归档报告。
