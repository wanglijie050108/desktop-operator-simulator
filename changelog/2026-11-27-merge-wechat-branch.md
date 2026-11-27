# 以 `main` 为基合并 `feature/pywinauto1`（微信收发 Spike）

## 元信息

- 日期：2026-11-27
- 状态：已完成（代码合并与全门验证；微信接收仍为未验证）
- 环境：Windows 11 build 26200；Node 24 / npm 11；Python 3.11（uv）；mypy 2.3.1

## 目标

- 把组员分支上的微信收发 Spike、发送焦点修复与 20/20 实机证据吸收进 `main`，
  同时保留 `main` 已有的 ADR-009（移除 C#）与 M6 决策层。

## 上下文与证据

- `main`（`4920318`）含 09-24 起 9 个后续提交：ADR-009 移除 C#、M6 观察层/verifier/
  轨迹回放；`docs/08` 已按 11-02 状态改写。
- `feature/pywinauto1`（`5134367`，Huuard，2026-11-17）基于 `da30dcb`（2026-10-04），
  分叉后仅 4 个提交：微信收发 Spike 工具（`wechat_spike.py` + 562 行测试）、发送焦点
  修复、20/20 发送读回证据、中期评估；其 `docs/08` 仍停留在"C# 冻结保留/占位执行器"的
  10-04 口径。
- 直接快进不可行：两线都有 `docs/08`、`README`、`windows_backend.py` 的改动。

## 分析与决策

- 采用 `git merge --no-ff`，保留分支作者与提交历史；不 rebase，避免改写组员已推送的提交。
- 冲突只在 `docs/08`，共 5 处。处理原则：**以 `main` 的骨架与既有结论为准，把分支的微信
  事实植入对应段落**，不采纳分支中已被 ADR-009 废弃的 C# 表述：
  1. 日期改为 2026-11-27；
  2. "当前阶段"写入微信发送 20/20，并把"4.1.15.13 空壳"结论标为待复核；
  3. "不可运行能力"收窄为"微信接收与双端闭环"；
  4. M0 清单拆成"发送 + 读回已通过"与"收发连续测试未通过（接收侧）"，保留 10-05 取证背景；
  5. "当前限制"保留 M6 与焦点校准条目，更新 Windows 验证记录与 ADR-011 待复核口径。
- 代码区自动合并：`windows_backend.send_chat_text` 的焦点校验/粘贴读回、`Weixin.exe`
  默认进程名、Spike 工具与测试均保留；`window_wrapper` 协议成员与 Spike 工具无交集。
- 顺带修正 `README` 两处与仓库现状矛盾的表述："方案 B 代码尚未实现"、"决策层待 M6 实现"，
  并补上微信发送 20/20 与接收未验证的边界。
- 分支带来的 12 条 changelog 原样保留并在索引中单列，未按保留策略清理：其中的微信事实
  仍是本任务依据，清理应另立任务。

## 操作记录

1. `git merge --no-ff origin/feature/pywinauto1`。
   - 结果：部分完成。1 个文件冲突（`docs/08`），其余 27 个文件自动合并。
2. 手工解决 `docs/08` 5 处冲突，修正 README 过期表述，补充 changelog 索引。
   - 结果：成功。
3. 复跑完整质量门与 Python 测试。
   - 结果：通过（详见验证表）。

## 文件变更

- 吸收：`wechat_spike.py`、`test_wechat_spike.py`、`windows_backend.py`（发送焦点与读回）、
  `windows_executor.py`/`config.py`/`wechat_source.py`/`uia_inspection.py`（默认进程名
  `Weixin.exe`）、`tests/test_windows_backend.py`、`tests/test_config.py`、
  `tests/test_uia_inspection.py`、`package.json`（`test:spike:m0:wechat-send`）、
  `pyproject.toml`（入口点）、`docs/07`、`docs/09`、12 条 changelog。
- 手工编辑：`docs/08`（冲突解决与日期）、`README.md`（两处过期表述）、
  `changelog/README.md`（索引）。
- 未改动：`contracts/`、Control Server 与 Operator Web 源码。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npm run check`（合并后，含 Node + Python + M1 集成） | PASSED | exit 0；Node 373 + 10 项、Python 289 通过 / 2 跳过、覆盖率 93.39%、`mypy src tests` 0 错误 |
| `git diff --check` | PASSED | 无空白错误与冲突标记残留 |
| 微信收发 Spike 实机复跑 | NOT_EXECUTED | 需目标机微信 4.x、专用测试会话与操作者确认；本轮只合并代码 |
| 微信接收侧验证 | NOT_EXECUTED | 仍需第二账号或手机端，属 M2 后续任务 |

## 问题与处理

- 现象：`docs/08` 在 5 处冲突，分支版本含 ADR-009 已删除的 C# 描述。
- 根因：分支基于 10-04 的提交，未跟进 10-09 之后的架构收口。
- 处理：以 `main` 为骨架逐段合并，仅植入微信事实；分支的 C# 段落整体丢弃。
- 结果：`docs/08` 同时保留 C# 移除结论与微信发送 20/20 证据。

- 现象：分支把默认微信进程名从 `WeChat.exe` 改为 `Weixin.exe`。
- 处理：接受该变更（目标机为微信 4.x），并在 `docs/07`、`docs/09` 保留 3.x 的
  `WeChat.exe` 说明与白名单约束。

## 风险与限制

- 分支的 20/20 报告位于另一台机器（`C:\automation-data\...`），本机只合并代码与证据记录，
  未在本机复跑；发送侧能力仍以该报告为准。
- 微信接收、AI 页面、购物站点均未验证；`docs/08` 的"不具备验收条件"结论不变。
- ADR-011（微信 4.1.15.13 不作为演示通道）与新证据存在张力，需产品/导师侧决定是否修订，
  本次未改决策文档。
- 合并后 `feature/pywinauto1` 的 12 条历史记录仍驻留工作区，未按保留策略清理。

## 最终结果

- 微信收发 Spike 工具、发送焦点修复、20/20 实机证据与 12 条记录已进入 `main`；
  同时保留 M6 决策层与 ADR-009 的 C# 移除结论。
- 全门复跑通过，`docs/08` 与 `README` 的微信结论已统一。
- 下一步：微信接收侧校准（第二账号 → "读取 → 去重 → 回复" 20 轮），随后 AI 页面 20 轮。
