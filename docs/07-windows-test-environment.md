# Windows 测试环境准备

本文用于搭建人工操作模拟器的专用 Windows 测试环境。目标是让桌面自动化结果可重复、可诊断，并避免测试账号和个人数据混用。

## 1. 环境目标

测试机需要同时承载：

- 微信等被操作的 Windows 桌面应用。
- Python/pywinauto Desktop Agent；迁移期可保留 C#/.NET Agent 用于回归。
- Node.js Control Server。
- Playwright Chromium。
- SQLite 数据库、截图、日志和 Playwright trace。

桌面自动化依赖真实的交互式桌面会话。协议和调度开发可以在 macOS 上进行，但
pywinauto、微信 UIA、鼠标键盘输入和完整端到端测试必须在 Windows 上运行。

## 2. 硬件与系统

推荐配置：

| 项目 | 要求 |
|---|---|
| 设备 | 专用 Windows 实体机优先 |
| 操作系统 | 受支持并完成安全更新的 Windows 11 x64 |
| CPU | 4 核及以上 |
| 内存 | 16 GB 及以上 |
| 磁盘 | 至少 100 GB 可用空间 |
| 显示 | 固定为 1920×1080、缩放 100% |
| 网络 | 可访问目标 AI 和购物站点的稳定网络 |

不建议把虚拟机或普通 RDP 会话作为主要 UI 测试环境。断开 RDP、锁屏、切换分辨率或注销用户都可能使桌面控件不可见并导致测试失败。无人值守运行时应保持物理显示器连接；确有需要时可使用 HDMI 显示模拟器。

## 3. 创建专用 Windows 用户

创建普通本地用户，例如：

```text
automation-test
```

要求：

1. 只在安装系统工具时使用管理员权限。
2. Desktop Agent、微信和浏览器以同一普通用户身份运行。
3. 不在该用户中登录个人微信、邮箱或浏览器账号。
4. 不让目标应用以管理员权限运行，否则普通权限 Agent 可能无法访问其 UI。
5. 为系统盘启用 BitLocker，并为该用户设置独立密码。

不要关闭 UAC、Microsoft Defender 或 Windows 防火墙来解决自动化问题。

## 4. 显示、电源与通知

在 Windows 设置中完成：

- 分辨率固定为 `1920×1080`。
- 显示缩放固定为 `100%`。
- 关闭自动旋转、HDR 和会改变色彩或尺寸的显示模式。
- 测试期间禁用睡眠、休眠和自动锁屏。
- 开启专注模式，避免通知抢占窗口。
- 不在测试运行期间拖动窗口、切换用户或操作鼠标键盘。

接通电源时可执行：

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
```

这些设置只建议用于专用测试机。测试结束后应根据实际使用恢复节能配置。

## 5. 安装开发工具链

以管理员身份打开 PowerShell，执行：

```powershell
winget install --id Git.Git -e
winget install --id Microsoft.PowerShell -e
winget install --id Python.Python.3.11 -e
winget install --id astral-sh.uv -e
winget install --id Microsoft.DotNet.SDK.10 -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Microsoft.VisualStudioCode -e
```

关闭并重新打开终端，然后验证：

```powershell
git --version
python --version
uv --version
dotnet --info
node --version
npm --version
pwsh --version
```

项目基线：

```text
Python 3.11.x
uv
Node.js 24.x LTS
Git 2.x
PowerShell 7.x
.NET SDK 10.x（仅迁移期 C# 回归需要）
```

如果 `OpenJS.NodeJS.LTS` 安装的不是 Node.js 24，应从 Node.js 官方发行包安装 24 LTS。不要在同一测试机混用多个全局 Node.js 版本。

## 6. 安装检查和目标软件

### 6.1 UI Automation 检查工具

至少安装一个：

- Accessibility Insights for Windows。
- Windows SDK 中的 `Inspect.exe`。
- pywinauto `py_inspect`。

它们用于比较 pywinauto 的 `uia`/`win32` backend，并确认目标窗口是否暴露
`Name`、`AutomationId`、`ControlType`、Value Pattern 和 Text Pattern。

### 6.2 目标应用

安装并记录确切版本：

- Windows 微信桌面端。
- 项目选定的 AI 页面所需浏览器。
- 项目选定的购物网站所需浏览器。

不要随意关闭应用自动更新。每次应用升级后重新运行 Adapter smoke test；答辩前一周冻结演示环境并记录所有版本。

## 7. 目录与数据隔离

在 PowerShell 中执行：

```powershell
New-Item -ItemType Directory -Force C:\work\human-operation-simulator
New-Item -ItemType Directory -Force C:\automation-data\profiles
New-Item -ItemType Directory -Force C:\automation-data\artifacts
New-Item -ItemType Directory -Force C:\automation-data\logs
New-Item -ItemType Directory -Force C:\automation-data\environment
```

目录用途：

| 目录 | 内容 |
|---|---|
| `C:\work\human-operation-simulator` | Git 工作区 |
| `C:\automation-data\profiles` | Playwright 持久化浏览器会话 |
| `C:\automation-data\artifacts` | 截图、录像和 trace |
| `C:\automation-data\logs` | 运行日志 |
| `C:\automation-data\environment` | 环境版本和验证记录 |

`C:\automation-data` 只能由测试用户和系统管理员访问。该目录不得提交到 Git，也不得复制到公开网盘。

## 8. 准备测试账号

建议准备：

1. 一个微信测试账号和一个受信任测试联系人。
2. 一个不绑定银行卡、不保存支付方式的购物测试账号。
3. 一个独立的 AI 页面测试账号。
4. 仅用于自动化的浏览器 Profile。

禁止使用：

- 个人主账号和真实工作聊天。
- 保存了银行卡、收货隐私或支付密码的账号。
- 需要绕过验证码、设备验证或站点风控的账号。

登录失效或出现验证码时，系统必须暂停并等待人工处理。

## 9. 安装 Playwright

在 Node.js 工程骨架创建后执行：

```powershell
cd C:\work\human-operation-simulator
npm install
npx playwright install chromium
npx playwright --version
```

浏览器自动化使用 Playwright 管理的 Chromium，不依赖用户日常使用的默认浏览器。持久化 Profile 必须指向：

```text
C:\automation-data\profiles
```

## 10. 网络和端口

- Control Server 默认监听 `127.0.0.1:7070`。
- 管理台默认只允许本机访问。
- SQLite、截图和 Agent 指令不得通过文件共享公开。
- 首期不配置公网端口转发。
- 如果必须从局域网打开管理台，需要增加身份认证并限制防火墙来源地址。

检查本地服务：

```powershell
Test-NetConnection 127.0.0.1 -Port 7070
```

## 11. M1 骨架验证（不含桌面动作）

在仓库根目录执行：

```powershell
npm ci
npm run check
```

`npm run check` 验证 Node 与 Python 的格式、静态检查、构建及单元/契约测试，并运行
Control Server 与 Python Agent 的注册、心跳、服务重启重连和紧急停止状态检查；它不依赖
.NET SDK。需要同时覆盖迁移期 .NET 回归时使用完整质量门：

```powershell
npm run check:all
```

`npm run check:all` 追加 `check:dotnet`（.NET 格式/构建/单测）与 Node/.NET 集成回归，
两者与 CI 的 `dotnet` job 保持一致。完整两小时连接检查以 Python Agent 为目标，需单独执行：

```powershell
npm run test:stability:m1
```

当前 Python Agent 已包含 WebSocket 客户端、安全调度和默认关闭的 Windows 基础
执行器；C# `DesktopAgent` 仍使用 `PlaceholderDesktopActionExecutor`。Python
基础执行器的窗口激活、前台校验、输入、剪贴板、截图和输入释放仅通过跨平台 Fake，
必须完成下述 M0 实机步骤后才能视为可用；不得把骨架检查当作 UI 自动化验收。

## 12. M0 技术 Spike

### Spike A：Windows 基础操作

目标：

- 启动并激活记事本。
- 使用 pywinauto 的 `uia` 或经验证的 `win32` backend 查找编辑控件。
- 输入指定文本。
- 设置和读取剪贴板。
- 截取目标窗口。
- 支持紧急停止。

连续运行 20 次，成功率应不低于 95%，且不能误操作其他窗口。

运行前必须关闭**全部**记事本窗口，并确保没有未保存内容。Windows 11 的记事本已改为商店应用
（`Microsoft.WindowsNotepad`），它：在同一进程内持有多个文档窗口；新文档可能以标签页形式并入
已有实例；并且**用文档第一行作为未保存文档的标题**（修改后带 `*` 前缀）。最后一点意味着
**窗口标题不能作为定位依据**——Spike 自己输入的文本会把标题改掉，例如
`无标题 - Notepad` → `*M0-NOTEPAD-SPIKE-01 - Notepad`。因此定位规则是：

1. 启动前确认记事本进程**没有任何窗口**；若仍有残留窗口，直接以
   `NOTEPAD_WINDOWS_ALREADY_OPEN` 失败且**不启动新进程**（硬性前置条件：新文档可能被并入
   已有实例，导致目标窗口随即消失）；
2. 固定启动 `notepad.exe`，不启动外部传入的程序；
3. 只接受**连续多次轮询都稳定存在且标题非空**的新窗口作为目标，避免把启动瞬间的临时窗口
   当成目标；
4. 以该窗口的**句柄与进程 ID** 锁定目标（`pin_target`），后续每一轮按句柄复核存活，不再使用
   标题；标题只作为回退路径的辅助条件；
5. 在跑满 20 轮之前先按句柄复核一次存活，失败立即以对应错误码结束（见下）。

失败码与含义：

| `setup_error` | 含义 | 处理 |
|---|---|---|
| `NOTEPAD_WINDOWS_ALREADY_OPEN` | 运行前已有记事本窗口 | 关闭全部记事本窗口后重试 |
| `NOTEPAD_WINDOW_NOT_FOUND` | 启动后没有出现稳定的新窗口（或临时窗口已消失） | 关闭全部记事本窗口后重试；确认没有会话恢复 |
| `NOTEPAD_WINDOW_AMBIGUOUS` | 一次出现多个新窗口 | 同上，并检查是否有会话恢复或其它脚本在操作记事本 |
| `TARGET_WINDOW_LOST` | 已锁定的窗口在运行中被关闭或替换 | 重跑；若反复出现说明该应用会重建窗口，需要改用它自己的稳定定位键 |
| `TARGET_WINDOW_NOT_FOUND` / `MULTIPLE_TARGET_WINDOWS` | 回退路径下标题无命中／命中不唯一 | 说明未锁定句柄时的标题条件失效 |

这些情况均**不执行任何输入**。然后在仓库根目录执行：

```powershell
$env:AGENT_ARTIFACT_DIR = "C:\automation-data\artifacts"
npm run test:spike:m0:notepad
```

工具固定运行 20 轮“激活窗口、全选、设置并读取剪贴板、粘贴、读取编辑区、截图、
释放输入”，19 轮及以上成功才返回成功退出码。JSON 报告保存在
`$env:AGENT_ARTIFACT_DIR\reports`，截图保存在 `$env:AGENT_ARTIFACT_DIR`；报告不含
测试文本。运行后人工确认：

- 记事本窗口未发生目标外输入，且最终只包含固定 Spike 文本。
- 20 张截图均为目标记事本窗口。
- 报告中的系统、Python、pywinauto、分辨率和 DPI 与实际环境一致。
- 触发急停时没有按键或鼠标按钮保持按下。

### Spike A2：鼠标动作（含坐标兜底）

前置条件与 Spike A 相同：**运行前必须关闭全部记事本窗口**，且没有未保存内容；必须使用
物理控制台或不会断开桌面的会话（Spike 会真实移动鼠标并点击）。

```powershell
$env:AGENT_ARTIFACT_DIR = "C:\automation-data\artifacts"
npm run test:spike:m0:notepad-mouse
```

工具固定运行 20 轮，每轮都执行并**逐项验证**（验证手段是 UIA 文本读回与剪贴板读回，
而不是"事件已发送"）。所有探测点都取**定位到的控件矩形的比例**（而不是手工标定的像素偏移）：
Windows 11 记事本可能把标签栏并入该矩形，贴边坐标会落在非文本区域上，比例坐标则始终落在
文本区内。文档内容固定为 30 行、每行 130 字符，**高于且宽于**编辑区，因此每个探测点下方
必有文字。

1. `MOUSE_MOVE`：读回 `GetCursorPos`，指针必须落在语义定位控件的中心（容差 2 px）。
2. `MOUSE_CLICK`：在控件矩形 35% 与 75% 高度处各单击一次（同一 x=30%），每次插入一个
   独有标记并读回文档；两次的插入位置必须满足 `索引(35%) < 索引(75%)`，证明插入点跟着
   鼠标走，而不是停在粘贴后的原位。
3. `MOUSE_CLICK_POSITION`：把 75% 高度那个点换算成**窗口相对坐标**再点一次，指针必须落在
   `窗口原点 + (x,y)`，且插入位置必须与上面的语义点击**完全相同**。
4. `MOUSE_DRAG`：从 (30%, 40%) 拖到 (45%, 70%)，然后在选区上粘贴一个标记——被选中的字符会被
   **整体替换**，因此用文档长度差即可反推"选区字符数"，要求 `0 < 选区字符数 < 全文长度`。
   该判定只依赖鼠标产生的状态，不受剪贴板换行编码影响（剪贴板用 CRLF、UIA 文本用 LF）；
   `Ctrl+C` 的复制结果仅作为**证据**记录，不参与判定。
5. `MOUSE_SCROLL`：文档固定为 150 行（远高于任何视口，保证"有东西可滚"），先把视图**钉到底部**
   （向下滚 10 刻），再在与点击探测点**相同**的位置（x=30%、y=35%，已被证明能落到文本上）
   插入标记得到行号；向上滚动 5 刻后行号必须变小，再向下滚动 5 刻后行号必须变大。钉底这一步
   是必要的：视图可能本来就在顶部或底部，不先归一化就无法区分"滚轮无效"和"已经到底"。
   每次探测还会做**落点自检**：若标记出现在文档末尾，说明这一击没有移动插入点，此时会报
   `MOUSE_SCROLL_PROBE_NOT_ON_TEXT` 而不是把问题算到滚轮头上。若"向上"无效，工具会再试一次
   反向滚动来区分"滚轮方向接反"（`MOUSE_SCROLL_DIRECTION_INVERTED`）与"滚轮没送达应用"
   （`MOUSE_SCROLL_UP_NOT_OBSERVED`），两者都不会被判成通过。
6. 每轮截取目标窗口截图，并在轮末调用急停释放输入。

报告为 `notepad-mouse-spike-<时间戳>.json`，包含显示档 `1920x1080@96`、逐轮耗时、错误码计数，
以及每轮的**诊断数据**：实测窗口矩形与控件矩形、三个点击的插入位置、拖拽选区字符数、
剪贴板复制长度与是否匹配文档、文档换行约定（crlf/lf/none）、滚动重置后的文档长度、
三次滚动探测的标记行号/字符位置/文档长度——只含几何、整数与短枚举，**不含文档文本**。
19 轮及以上成功才返回成功退出码。

失败码：

| 错误码 | 含义 |
|---|---|
| `MOUSE_CURSOR_MISMATCH` | 语义移动后的指针位置与控制中心不符 |
| `MOUSE_CLICK_CARET_MISMATCH` | 两次点击的插入位置不满足"越低越大"，插入点没跟着鼠标走 |
| `COORDINATE_CLICK_POINT_MISMATCH` | 坐标点击的指针落点与计算值不符 |
| `COORDINATE_CLICK_CARET_MISMATCH` | 坐标点击的插入位置与等价语义点击不一致 |
| `MOUSE_CLICK_MARKER_MISSING` / `MOUSE_SCROLL_MARKER_MISSING` | 标记字符没出现在文档里，无法判断插入位置 |
| `MOUSE_DRAG_SELECTION_MISMATCH` | 拖拽没有产生非空且非全文的选区（诊断见 `selectedCharacters`） |
| `MOUSE_SCROLL_PROBE_NOT_ON_TEXT` | 滚动探测点的点击没有移动插入点，无法用该点观察滚动 |
| `MOUSE_SCROLL_DIRECTION_INVERTED` | 正刻度实际向下滚动，与契约（正值=向前/向上）不符 |
| `MOUSE_SCROLL_UP_NOT_OBSERVED` / `MOUSE_SCROLL_DOWN_NOT_OBSERVED` | 滚轮没有改变可见文本（两个方向都无效） |
| `DISPLAY_PROFILE_MISMATCH` / `COORDINATE_OUT_OF_WINDOW` | 运行环境与显示档不一致，或坐标越界 |

排查顺序：先看报告里的 `documentBounds`/`windowBounds` 是否合理（控件矩形是否远大于或远离
窗口）、再看三个 `caretIndices` 是否相等（相等 = 点击根本没落到文本上）、`selectedCharacters`
是否为 0（0 = 拖拽没产生选区）、`clipboardSelectionMatches` 是否为 false 而
`selectedCharacters > 0`（说明拖拽成功但复制未生效，属剪贴板路径问题）。滚轮失败时看
`scrollResetLength`（应等于完整文档长度；偏小说明重置粘贴没生效、残留了全选）与
`scrollLines`/`scrollIndices`（两次探测相等 = 视图没滚动；变小方向相反 = 滚轮方向接反）。
若坐标点击反复偏移，先核对分辨率、缩放与多显示器排列，再更新
`AGENT_COORDINATE_MOUSE_PROFILE`；**不要**通过放宽校验来"修好"坐标路径。

### Spike B：微信消息收发

先关闭无关微信窗口，在专用测试账号中停留于不含真实聊天内容的测试会话，然后运行
只读 UIA 结构取证：

```powershell
$env:WECHAT_PROCESS_NAME = "WeChat.exe"
$env:AGENT_ARTIFACT_DIR = "C:\automation-data\artifacts"
npm run test:spike:m0:wechat-inspect
```

`WECHAT_PROCESS_NAME` 仅允许 `WeChat.exe` 或 `Weixin.exe`，且禁止路径；其他发行名
必须先经代码评审加入固定白名单。存在多个顶层窗口时可用
`WECHAT_WINDOW_TITLE_CONTAINS` 收窄。报告最多记录 2000 个节点；窗口标题和控件 Name
仅保存每次运行临时 HMAC 与长度，AutomationId/ClassName 只在安全字符集内保留。
`truncated=true` 表示达到节点上限或读取部分控件失败，不能据此冻结 selector。

目标：

- 定位指定测试会话。
- 读取最新消息文本和可用元数据。
- 判断是否包含 `#助手` 前缀。
- 在同一会话回复固定文本。
- 对重复读取的消息进行去重。

连续运行 20 次，成功率应不低于 90%。如果微信不暴露稳定消息 ID，使用会话、发送者、规范化文本、时间窗口和可见顺序生成消息指纹。

### Spike C：浏览器自动化

目标：

- 打开 AI 页面并完成一次问答。
- 打开购物站点并搜索一个商品。
- 提取至少三个候选商品的名称、价格和链接。
- 对登录失效、页面超时和验证码返回明确状态。
- 保存失败截图和 Playwright trace。

AI 和购物流程各运行 20 次，成功率应不低于 90%。不得通过自动识别或绕过验证码提高成功率。

## 13. 环境验收

全部满足后，Windows 环境才可进入正式开发：

- [ ] Windows 11 x64 已完成安全更新。
- [ ] 使用独立普通测试用户。
- [ ] 分辨率为 1920×1080，缩放为 100%。
- [ ] 测试期间不会睡眠、锁屏或断开桌面会话。
- [ ] Python 3.11、uv、Node.js 24、Git 和 PowerShell 7 可用。
- [ ] UIA 检查工具能识别目标应用控件。
- [ ] 微信、AI 页面和购物站点使用独立测试账号。
- [ ] `C:\automation-data` 已隔离且不进入 Git。
- [ ] 三个 Spike 均完成 20 次重复测试。
- [ ] 失败时能获得截图、trace 或明确错误码。
- [ ] 支付、验证码绕过和凭据读取测试均被拒绝。

## 14. 环境信息归档

在基线配置完成后执行：

```powershell
Get-ComputerInfo |
  Select-Object WindowsProductName, WindowsVersion, OsBuildNumber,
    CsSystemType, CsTotalPhysicalMemory |
  Out-File C:\automation-data\environment\computer-info.txt

python --version |
  Out-File C:\automation-data\environment\python-version.txt

uv --version |
  Out-File C:\automation-data\environment\uv-version.txt

node --version |
  Out-File C:\automation-data\environment\node-version.txt

winget export `
  --output C:\automation-data\environment\winget-packages.json `
  --include-versions
```

另外人工记录：

```text
日期：
测试人员：
Windows 版本：
分辨率与 DPI：
微信版本：
AI 页面：
购物站点：
Agent 版本：
Control Server 版本：
三项 Spike 成功率：
已知限制：
```

## 15. 常见问题

### Agent 找不到目标控件

先确认 Agent 和目标应用权限级别一致，再用 Accessibility Insights 检查控件树。不要立即退回固定坐标。

### 断开远程桌面后任务失败

RDP 断开可能改变或锁定桌面会话。改为物理控制台测试，或使用能保持当前交互式会话的管理方式。

### 坐标点击偏移

检查分辨率、显示缩放、窗口尺寸和多显示器排列。固定坐标只能作为兜底，并必须验证目标窗口。
坐标路径默认关闭：只有配置了 `AGENT_COORDINATE_MOUSE_PROFILE=宽x高@DPI` 且实时显示档与之
一致时才允许执行，`x`/`y` 一律相对目标窗口左上角。优先改用语义定位
（`controlType`/`automationId`/`name` + 相对偏移）。

### Playwright 无法使用已登录会话

确认启动时使用了固定的持久化 Profile，且没有两个浏览器进程同时占用该目录。

### 出现验证码

立即暂停任务并转为人工处理。不要增加验证码识别或绕过逻辑。
