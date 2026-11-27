# M0 Spike B 微信发送与读回 20 轮实机通过

## 元信息

- 日期：2026-11-17
- 状态：已完成（实机证据归档；接收侧未验证）
- 环境：Windows 11 build 26200、2560×1600、DPI 144、Python 3.11.18、pywinauto 0.6.9、
  微信 4.x（`Weixin.exe`）
- 分支：`feature/pywinauto1`

## 目标

- 记录 `desktop-agent-wechat-spike` 在目标微信上的 20 轮发送 + UIA 读回结果，并据实
  更新开发状态，明确它与“接收侧”验证的边界。

## 上下文与证据

- 工具：`npm run test:spike:m0:wechat-send`（`wechat_spike.py`）。
- 测试会话：文件传输助手（会话名长度 6，不向真人发送）。
- 报告：`C:\automation-data\artifacts\reports\wechat-spike-20261117-132448514655.json`。
- 报告摘要：
  - `passed = true`，`success_count = 20`，`requested_iterations = 20`，
    `success_rate = 1.0`；
  - `setup_error = null`，`error_counts = {}`；
  - 单轮 369–410 ms（均值 386.8 ms，中位数 387 ms）；
  - 每轮 `observed_matches = 1`；
  - 前置 1 轮试跑 `wechat-spike-20261117-132305231134.json` 同样通过（397 ms）。
- 控件依据：同日只读取证报告 `wechat-uia-20261117-130849441774.json`（152 节点、
  `truncated=false`）显示 `chat_input_field`、`current_chat_name_label`、
  `chat_message_list` 等稳定 AutomationId。

## 分析与决策

- 本结果证明的链路：定位并校验会话标题 → 定位 `chat_input_field` → 验证键盘焦点
  （必要时点击后备）→ 剪贴板粘贴 → 读回输入框 → 回车 → 从 UIA 控件树读回探测文本。
- 本结果**不**证明：他人发来的新消息可被读取、`extract_conversation` 的扁平启发式
  在真实控件树上正确、消息去重/指纹有效、完整“接收 → 处理 → 回复”闭环。
- 因此 M0 的“微信收发必须通过”暂按**发送侧通过、接收侧未验证**记录，不整体勾选为
  完成；`docs/08` 已拆成两条，避免用一条证据覆盖两类能力。
- 操作者目视核对 20 条探测消息尚未补记，状态文档中明确标注。

## 操作记录

1. 读取并统计 20 轮报告。
   - 结果：成功。确认 20/20、无错误、耗时稳定。
2. 更新 `docs/08`：M0 拆分为“发送 + 读回已通过”和“接收待验证”，同步当前结论、
   当前不可运行能力与当前限制。
   - 结果：成功。
3. 归档本记录。
   - 结果：成功。

## 文件变更

- `docs/08-development-status.md`：按实机证据更新 M0、M2、当前结论与限制，日期改为
  2026-11-17。
- `changelog/2026-11-17-m0-wechat-spike-passed.md`：本记录（新建）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 解析 `wechat-spike-20261117-132448514655.json` | PASSED | 20/20、`error_counts={}`、369–410 ms。 |
| `npm run check:python` | NOT_EXECUTED | 本次无代码改动；上一任务同一工作区已通过（237 passed）。 |
| 操作者目视核对消息条数 | NOT_EXECUTED | 待补记。 |
| 微信接收侧验证 | NOT_EXECUTED | 需要第二账号或手机端发消息。 |

## 风险与限制

- 测试环境为 2560×1600、DPI 144，与 `docs/07` 推荐的 1920×1080、100% 不同；本次为
  UIA 语义路径，不受坐标缩放影响，但坐标兜底路径不可据此宣称已验证。
- 文件传输助手是自聊会话；一对一联系人和群聊的标题控件可能不同，需在 M2 单独校准。
- 发送成功与读回成功不能排除“消息其实没送达服务端”的极端情况；目视核对与后续
  接收侧测试可补强。
- 20 轮为单次样本，尚无第二次独立重复。

## 最终结果

- 微信发送 + 已发送消息读回取得 20/20（100%）实机证据，报告已归档。
- 接收侧、去重与双端闭环仍未验证，M0 不整体宣布完成。
- 下一步：准备第二账号或手机端，校准 `extract_conversation` 与 `current_chat_name_label`，
  完成“接收 → 去重 → 回复”的真实链路。
