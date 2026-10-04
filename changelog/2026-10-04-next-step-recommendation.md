# 下一步开发建议：M0 实机验证优先（只读分析）

## 元信息

- 日期：2026-10-04
- 状态：已完成
- 环境：Windows 11 主机（即 M0 目标操作系统）；只读分析，未运行构建、测试或桌面自动化

## 目标

- 在 changelog 整理完成后，给出下一步开发的建议路径与优先级依据。
- 只做只读分析，不修改代码、文档或状态。

## 上下文与证据

- `docs/04-implementation-plan.md`：M0 技术 Spike 窗口为 **2026-09-24 至 2026-10-07**
  （今天 10-04，剩 3 天），M1 自 2026-10-08 开始；M0 退出标准为“三条 PoC 路径至少两条
  稳定重复 20 次、成功率不低于 90%；微信收发必须通过”；首批任务表中 SPIKE-01（微信 UIA
  可访问性）估算 2 人日。§1 明确“先验证最不确定的 UI 可自动化性”。
- `docs/08-development-status.md`：跨平台代码与模拟验证已完成，M0 全部 `[ ]`；
  项目级结论“不具备验收条件”；真实微信控件定位未实机校准、pywinauto 执行器无实机证据。
- `docs/07-windows-test-environment.md`：§12 给出 Spike A/B/C 的具体命令与判定标准
  （记事本 20 轮 ≥95%、微信与浏览器 20 轮 ≥90%）；§8 要求专用测试账号与专用普通用户；
  §13 环境验收清单；§14 环境信息归档要求。
- `README.md`：既有可执行命令 `test:spike:m0:notepad`、`test:spike:m0:wechat-inspect`、
  `test:stability:m1`、`check:node`/`check:python`；`AGENT_WINDOWS_AUTOMATION_ENABLED`、
  `AGENT_ALLOWED_PROCESSES`、`AGENT_ALLOWED_ACTIONS`、`AGENT_ARTIFACT_DIR` 等开关。
- 本机实测（只读）：`uv 0.11.14`、`node v24.15.0`、`npm 11.12.1` 可用；
  `apps/desktop-agent-python/.venv` 与根 `node_modules` 已存在；**`dotnet` 不可用**；
  微信在运行（`WeChatAppEx`，路径属于用户级 `xwechat` 安装）；`notepad.exe` 可用。
- `notepad_spike.py`：`SPIKE_ITERATIONS = 20`、`PASS_RATE = 0.95`、固定 `notepad.exe`、
  报告含环境元数据与逐轮耗时/错误码；`config.py` 默认 artifact 目录
  `data/artifacts/desktop-agent`。

## 分析与决策

- 结论：下一步不该继续写静态代码，而应**立即执行 M0 实机验证**。依据：跨平台可开发部分
  已完成且经过 mock/CI 验证，继续加代码不会改变任何验收状态；而 M0 是硬门槛且窗口即将到期。
- 关键有利条件：当前主机就是 Windows 11，Spike A 无外部依赖（不需要账号/站点），
  可立即执行；这与此前“主开发机非 Windows”的记录不同。
- 执行顺序按“风险×成本”排序：
  1. 先提交 changelog 整理，恢复干净基线；本地质量门用 `check:node` + `check:python`
     （本机无 .NET SDK，`npm run check` 会在 `check:dotnet` 步骤失败，C# 回归交由 CI）。
  2. Spike A（记事本 20 轮）：零外部依赖，把“Windows 执行器仅有 Fake 证据”转为实机证据，
     并暴露 pywinauto 在本机系统版本/DPI 下的真实缺陷。
  3. Spike B（微信只读取证）：产出决定后续所有方案。若微信 4.x 不暴露稳定的消息列表/
     输入框 UIA 节点，需改方案或改演示目标，属最高不确定性，必须早做。
  4. 按取证结果校准 `wechat_source.py` 定位器，跑通真实收发 20 次闭环（M0 硬性要求）。
  5. Spike C（浏览器）可后置到 M2/M3 窗口：M0 退出标准只要求三条中两条通过。
- 隐私与账号边界：只读取证工具本身已脱敏（Name/窗口标题仅临时 HMAC + 长度、2000 节点上限、
  `truncated` 标记），但取证会读取屏幕上可见的会话结构，因此必须使用专用测试微信账号、
  仅保留测试会话；不得用个人主账号或真实聊天内容做自动化。
- 未采纳：用个人微信账号直接联调（账号风险高于技术收益）；跳过 Spike 直接做 M2/M3 适配器
  （与 `docs/04` §1 的“先验证最不确定项”相反，且 M2/M3 退出标准依赖真实环境）。

## 操作记录

1. 只读核对实施计划、Windows 环境要求、开发状态与 README 命令。
   - 结果：成功；确认 M0 窗口、退出标准与可用命令。
2. 只读检查本机工具链、依赖目录、微信与记事本可用性。
   - 结果：成功；见“上下文与证据”。发现 `dotnet` 缺失。
3. 只读查看 `notepad_spike.py` 判定参数与 `config.py` 默认 artifact 目录。
   - 结果：成功；确认 20 轮 / 95% 门槛与默认目录。
4. 形成并记录建议路径。
   - 结果：成功。

## 文件变更

- `changelog/2026-10-04-next-step-recommendation.md`：本记录。
- 未修改任何代码、测试、契约、`docs/` 或状态文档。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 读取 `docs/04` / `docs/07` / `docs/08` / `README.md` | PASSED | 确认 M0 窗口与退出标准、环境要求、现状缺口与可用命令。 |
| 本机工具链只读检测（`uv`/`node`/`npm`/`dotnet`） | PASSED | 前三者可用；`dotnet` 不可用，故本地不改跑完整 `npm run check`。 |
| 桌面应用可用性检测（微信进程、`notepad.exe`） | PASSED | 微信在运行（用户级安装）；`notepad.exe` 存在。 |
| `npm run check:node` / `check:python` | NOT_EXECUTED | 本次为只读分析，未运行任何质量门。 |
| M0 Spike A/B/C 实机执行 | NOT_EXECUTED | 需用户在场并授权（会接管键鼠、需专用微信账号）。 |

## 问题与处理

- 现象：本机 `Get-CimInstance Win32_OperatingSystem` 被拒绝访问，无法程序化读取系统版本。
  - 根因：当前沙箱权限限制 WMI 读取。
  - 处理：以既有环境记录与 `notepad.exe`/微信进程探测代替，系统版本待 Spike A 报告中的
    环境元数据确认。
  - 结果：不影响建议结论。
- 现象：`pwsh` 在当前沙箱 PATH 中不可直接调用。
  - 处理：记为环境差异；不影响 `npm run test:spike:*` 的可用性判断。
  - 结果：待实机执行时确认。

## 风险与限制

- 本记录结论基于文档与本机只读探测，未运行任何 Spike，未验证 pywinauto 在本机能否稳定
  定位记事本或微信控件；实际成功率未知。
- Spike A 会接管前台窗口、键盘与剪贴板约 1–2 分钟，需在无人操作且无未保存记事本内容时运行。
- Spike B 涉及真实微信界面，必须先落实专用测试账号与会话隔离，否则有隐私与账号风险。
- M0 计划窗口仅剩 3 天，三条路径全做不现实；按退出标准应聚焦“微信 + 记事本”两条。

## 最终结果

- 已完成：给出下一步开发建议——以 M0 实机验证为唯一优先项，顺序为提交基线 → Spike A
  （记事本 20 轮）→ Spike B 只读取证 → 校准 `wechat_source.py` 并跑通真实收发 → 浏览器
  Spike 后置到 M2/M3；并记录本机可用性、账号/隐私边界与本地质量门替代命令。
- 未完成：所有 Spike 与质量门均未执行，等待用户授权与在场。
- 下一步建议：先授权执行 Spike A；Spike B 需先确定专用微信测试账号与隔离会话。
