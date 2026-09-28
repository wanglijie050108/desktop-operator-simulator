# 微信 UIA 隐私取证工具

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS；Python 3.11、Node.js 24；Windows/微信未验证

## 目标

- 提供只读的 Windows 微信 UIA 控件树取证命令，为真实 Adapter 选择器设计提供证据。
- 报告保留控件类型、类名、AutomationId、层级和可见/启用状态。
- 窗口标题和控件 Name 仅输出临时 HMAC 与长度，不保存聊天正文或联系人名称。
- 对节点数量、字段长度、输出目录和平台进行失败关闭限制。

## 上下文与证据

- 微信消息接收跨平台基础层已提交并推送为 `b57bcdc`。
- 当前缺少目标 Windows 微信版本和控件树证据，不能可靠实现真实 UIA selector。
- `docs/07-windows-test-environment.md` 要求使用 Inspect.exe/py_inspect 比较目标控件
  的 Name、AutomationId、ControlType、Value Pattern 和 Text Pattern。
- 当前环境为 macOS，不能运行真实微信取证。
- 工作区另有两份无关未跟踪 changelog，本任务不修改。

## 分析与决策

- 工具只连接已运行的纯进程名目标，不启动微信，不执行点击、按键或剪贴板操作。
- Name 和窗口标题可能包含个人信息，使用每次运行随机生成且不落盘的 HMAC 密钥。
- 结构字段仅在匹配安全字符集时明文保存，否则改为不可逆摘要。
- 默认节点上限 2000，防止异常控件树造成无界内存或报告增长。
- 运行时进程名仅允许 `WeChat.exe`/`Weixin.exe`，其他发行名必须经代码评审加入固定
  白名单，不能把工具泛化为任意进程检查器。

## 操作记录

1. 核对 Windows 后端、微信消息基础层、M0 取证要求和隐私边界。
   - 结果：成功。
   - 影响：确定只读结构报告范围。
2. 实现 UIA 控件树采集、结构脱敏和报告写入。
   - 结果：成功；Name/标题使用临时 HMAC，结构字段不安全时转摘要，节点上限 2000。
   - 影响：新增 `uia_inspection.py`，扩展 `windows_backend.py`。
3. 注册 Windows 取证命令并增加配置校验。
   - 结果：成功；非 Windows 失败关闭，进程名限制为两个微信发行名。
   - 影响：修改 `pyproject.toml` 和 `package.json`。
4. 增加隐私、路径、截断、异常节点和平台守卫测试。
   - 结果：成功；Python 测试由 103 项增加至 111 项，覆盖率 92.58%。
5. 完成两轮对抗复核。
   - 结果：成功；修复节点读取异常被误报为完整报告，并收紧任意纯进程名检查风险。
   - 限制：当前工具约束不允许启动独立审查代理，使用定向回归代替独立交叉审查。
6. 同步 README、Windows 环境、安装和开发状态文档。
   - 结果：成功；真实 Windows 取证仍明确标记为阻塞。
7. 执行全仓质量门并复核最终差异。
   - 结果：成功；Node 207 项、Python 111 项、C# 58 项测试和双 Agent 集成通过。
   - 影响：只读取证命令未改变默认 Agent 运行或现有协议。

## 文件变更

- `changelog/2026-09-28-wechat-uia-inspection.md`：记录本任务。
- `apps/desktop-agent-python/src/desktop_agent/uia_inspection.py`：取证配置、结构脱敏、
  JSON 报告和 CLI。
- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`：有界 UIA 树遍历。
- `apps/desktop-agent-python/tests/test_uia_inspection.py`、
  `tests/test_windows_backend.py`：隐私和后端行为测试。
- `apps/desktop-agent-python/pyproject.toml`、`package.json`：注册取证命令。
- `README.md`、`docs/07-windows-test-environment.md`、
  `docs/08-development-status.md`、`docs/09-installation-guide.md`：同步运行方式和状态。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| Python 定向测试 | PASSED | 111 项通过，覆盖率 92.58%。 |
| `npm run check:python` | PASSED | Ruff、mypy 和 pytest 全部通过。 |
| `uv lock --check --directory apps/desktop-agent-python` | PASSED | 锁文件一致。 |
| `npm run test:spike:m0:wechat-inspect`（macOS） | PASSED | 返回 `WINDOWS_REQUIRED`。 |
| `npm run check` | PASSED | Node 207、Python 111、C# 58 项测试和双 Agent 集成通过。 |
| Windows 微信 UIA 取证 | BLOCKED | 缺少目标 Windows 微信和交互式桌面。 |

## 问题与处理

- 现象：首轮质量门中测试和 mypy 通过，Ruff 报导入顺序错误。
- 根因：新增 `Mapping` 导入位置不符合项目排序规则。
- 处理：按 Ruff 规则调整标准库导入。
- 结果：Python 质量门通过。

## 风险与限制

- 结构报告不能替代人工使用 Inspect.exe/py_inspect 复核 Pattern 和动态行为。
- HMAC 仅避免报告直接泄露文本，不证明控件树本身稳定。

## 最终结果

- 微信 UIA 隐私取证工具已实现并通过跨平台测试，报告不会保存明文 Name、窗口标题或
  不安全结构字段。
- 下一步在目标 Windows 测试账号运行取证命令并人工复核未截断报告；取得证据后才能
  冻结真实微信读取/回复 selector。
