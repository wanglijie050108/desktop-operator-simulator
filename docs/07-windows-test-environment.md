# Windows 测试环境准备

本文用于搭建人工操作模拟器的专用 Windows 测试环境。目标是让桌面自动化结果可重复、可诊断，并避免测试账号和个人数据混用。

## 1. 环境目标

测试机需要同时承载：

- 微信等被操作的 Windows 桌面应用。
- C#/.NET Desktop Agent。
- Node.js Control Server。
- Playwright Chromium。
- SQLite 数据库、截图、日志和 Playwright trace。

桌面自动化依赖真实的交互式桌面会话。开发可以在 macOS 上进行，但 FlaUI、微信 UIA、鼠标键盘输入和完整端到端测试必须在 Windows 上运行。

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
winget install --id Microsoft.DotNet.SDK.10 -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Microsoft.VisualStudioCode -e
```

关闭并重新打开终端，然后验证：

```powershell
git --version
dotnet --info
node --version
npm --version
pwsh --version
```

项目基线：

```text
.NET SDK 10.x
Node.js 24.x LTS
Git 2.x
PowerShell 7.x
```

如果 `OpenJS.NodeJS.LTS` 安装的不是 Node.js 24，应从 Node.js 官方发行包安装 24 LTS。不要在同一测试机混用多个全局 Node.js 版本。

## 6. 安装检查和目标软件

### 6.1 UI Automation 检查工具

至少安装一个：

- Accessibility Insights for Windows。
- FlaUInspect。
- Windows SDK 中的 `Inspect.exe`。

它们用于确认目标窗口是否暴露 `Name`、`AutomationId`、`ControlType`、Value Pattern 和 Text Pattern。

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

该命令会验证 Node 和 .NET 格式、静态检查、构建、单元/契约测试，以及真实
Control Server 与占位 Desktop Agent 的注册、心跳、服务重启重连和紧急停止状态。
完整两小时连接检查单独执行：

```powershell
npm run test:stability:m1
```

当前 `DesktopAgent` 使用 `PlaceholderDesktopActionExecutor`，不声明真实桌面能力，
所有桌面动作返回 `NOT_IMPLEMENTED`。只有 M0 通过后，才能新增 Windows-targeted
执行器并接入 FlaUI、前台窗口、输入、剪贴板和截图；不得把上述骨架检查当作 UI
自动化验收。

## 12. M0 技术 Spike

### Spike A：Windows 基础操作

目标：

- 启动并激活记事本。
- 使用 UIA 查找编辑控件。
- 输入指定文本。
- 设置和读取剪贴板。
- 截取目标窗口。
- 支持紧急停止。

连续运行 20 次，成功率应不低于 95%，且不能误操作其他窗口。

### Spike B：微信消息收发

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
- [ ] `.NET 10`、`Node.js 24`、Git 和 PowerShell 7 可用。
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

dotnet --info |
  Out-File C:\automation-data\environment\dotnet-info.txt

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

### Playwright 无法使用已登录会话

确认启动时使用了固定的持久化 Profile，且没有两个浏览器进程同时占用该目录。

### 出现验证码

立即暂停任务并转为人工处理。不要增加验证码识别或绕过逻辑。
