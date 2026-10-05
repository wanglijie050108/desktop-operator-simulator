# 微信 Spike B 前置可行性核对（只读分析）

## 元信息

- 日期：2026-10-05
- 状态：已完成
- 环境：Windows 11 主机（M0 目标机）；uv 0.11.14、Node.js v24.15.0、npm 11.12.1、
  venv Python 3.11.6 + pywinauto 0.6.9；系统 `dotnet` 8.0.206。只读分析，未跑构建/测试/桌面自动化。

## 目标

- 核对 main 状态，回答“下一步是否应做微信验证”，并确认本机前置条件。

## 分析结论

- main 与 `origin/main` 同为 `da30dcb`，**无需拉取**。
- **下一步确为微信验证（M0 Spike B），且它是 M0 唯一硬性必过项**：`docs/04` 的 M0 窗口为
  2026-09-24 至 **10-07**（今天 10-05，剩 2 天），退出标准要求“微信收发必须通过”、
  三条 PoC 路径至少两条 ≥90%。记事本 20/20、鼠标 19/20 已取得实机证据，浏览器 Spike C
  可后置到 M2/M3，故“微信 + 记事本”两条即可满足退出标准。
- 微信缺口是**三层递进缺口，不是“缺代码”**（相关代码层早已实现且仅有 mock/fake 单测）：
  1. 从未取得真实微信控件树证据（`wechat-inspect` 从未执行）；
  2. 不存在 20 轮收发 Spike 工具（仓库只有只读取证入口），退出标准**当前无法测量**；
  3. `wechat_source.py` 定位常量（`CHAT_TITLE_AUTOMATION_IDS` 空集、
     `MESSAGE_ITEM_CONTROL_TYPES={ListItem,Text}`）与 `send_chat_text` 定位均未按真实控件树校准。
- 因此顺序固定为：只读取证 → 按报告校准定位 → 补 20 轮工具 → 跑 20 轮达标并人工复核。
  跳步会产生无法验证的定位假设，或向真实微信窗口注入未校准输入。

## 本机前置事实

- 微信为 4.x（`xwechat`）架构：主程序 **`D:\Weixin\Weixin.exe`（进程名 `Weixin.exe`，
  版本 4.1.15.13）**，调查时**未运行**，仅 4 个 `WeChatAppEx.exe` 小程序容器在跑。
- `docs/07` §12 示例的 `WECHAT_PROCESS_NAME="WeChat.exe"` 在本机必然 `TARGET_APP_NOT_FOUND`；
  取证工具白名单 `{wechat, weixin}` 允许 `Weixin.exe`。
- `windows_backend.find_window` 按规范化进程名在 `visible_only=True, enabled_only=True` 的顶层
  窗口中匹配并**要求恰好一个**：0 个 → `TARGET_APP_NOT_FOUND`；标题过滤后 0 个 →
  `TARGET_WINDOW_NOT_FOUND`；多个 → `MULTIPLE_TARGET_WINDOWS`。
  `collect_control_tree` 读不到任何节点 → `UI_ELEMENT_NOT_FOUND`（本身即关键结论）。
- 取证工具全程只读：不激活窗口、不注入输入；报告对 Name 与窗口标题只存**每次运行随机**的
  HMAC 与长度，故隐私安全但**跨报告不可比对**、看不到明文。
- venv 已是 Python 3.11.6 且装有 pywinauto；系统 `python` 3.14.4 不用于本项目。
- `dotnet` 8.0.206 < `global.json` 要求的 .NET 10：本地 `check:all` 的 .NET 步骤仍 BLOCKED。

## 第一步执行手册（交付操作者，须在交互式桌面执行）

本 Agent 会话无交互式桌面（UIA 枚举为 0），实机命令必须由操作者在其自己的 PowerShell 中执行。

```powershell
Get-Process -Name Weixin -ErrorAction SilentlyContinue |
  Select-Object Id, MainWindowHandle, MainWindowTitle   # MainWindowHandle 必须非 0
cd D:\course_design\desktop-operator-simulator
$env:WECHAT_PROCESS_NAME = "Weixin.exe"
npm run test:spike:m0:wechat-inspect
```

- 前置：专用测试账号已登录、停留于不含真实聊天内容的测试会话、关闭无关微信窗口、窗口不最小化。
- 成功输出 `{"nodeCount":N,"truncated":false,"report":"...wechat-uia-<时间戳>.json"}`；报告默认落在
  `apps/desktop-agent-python/data/artifacts/desktop-agent/reports/`。
- `truncated=true`（节点超 2000 或有控件读取失败）时**不得据此冻结选择器**。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git rev-list --left-right --count main...origin/main` | PASSED | `0 0`，HEAD 与 `da30dcb` 一致 |
| 阅读 SKILL、`docs/04/05/07/08`、`README.md` 与近期记录 | PASSED | 确认 M0 窗口、退出标准与缺口 |
| 微信进程与主程序定位（快捷方式 + 版本信息） | PASSED | `D:\Weixin\Weixin.exe` 4.1.15.13，未运行 |
| venv 与 pywinauto 可用性 | PASSED | Python 3.11.6；pywinauto 0.6.9 已装 |
| `windows_backend` 窗口查找与错误码核对 | PASSED | 见“本机前置事实” |
| `npm run test:spike:m0:wechat-inspect` | NOT_EXECUTED | 需操作者在交互式桌面执行 |
| Spike B 20 轮收发 | NOT_EXECUTED | 工具不存在，需先实现 |

## 问题与处理

- `docs/07` §12 示例进程名过时（`WeChat.exe` vs 本机 `Weixin.exe`）：已记录，待实机结论后在该
  文档补版本差异说明。
- `docs/08` 第 53–55 行仍写“鼠标动作…目标机 20 轮实机证据仍缺失”，与同文档 31–34、145–154、
  285–286 行的 19/20 实机证据矛盾（A2 通过后总述段漏改）。建议单独修订。

## 风险与限制

- M0 仅剩 2 天，而 Spike B 需四步、其中 20 轮工具尚不存在；按 `docs/04` 原估 SPIKE-01 为
  2 人日，需优先投入或明确接受 M0 延期。
- 报告 HMAC 每次随机：若微信 4.x 消息文本节点无稳定 AutomationId/Class，可能无法据此冻结可靠
  选择器，需改用“可见顺序 + 文本指纹”，会直接影响 `docs/05` 的识别率口径。
- 微信 4.1.15.13 的 UIA 可访问性在本项目从未验证，不排除需用 Inspect.exe/py_inspect 比对
  Win32 与 UIA backend。
- 未运行任何 Spike，pywinauto 能否定位微信任何控件、实际成功率均未知。

## 最终结果

- 已完成：确认 main 无待拉取、下一步为微信 Spike B 且为 M0 唯一必过项、给出四步顺序，并登记
  本机前置事实与两处文档缺陷。
- 未完成：Spike 与质量门均未执行；20 轮收发工具不存在；定位未校准；两处文档缺陷未修。
- 下一步：操作者按上述命令跑只读取证，回报报告路径后由 Agent 校准定位并实现 20 轮工具。
