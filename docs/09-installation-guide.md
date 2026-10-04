# 安装手册

本文说明如何在本机安装并启动人工操作模拟器的三个组成部分：Control Server、
Operator Web 管理台和 Desktop Agent。

- 编写日期：2026-09-28
- 适用版本：仓库 `0.1.0`（Python Desktop Agent 迁移阶段）
- 真实 Windows/微信/站点集成**尚未验证**，涉及步骤均已标注。

## 1. 适用范围

| 使用目的 | 需要的机器 | 可完成内容 |
|---|---|---|
| 逻辑开发与模拟演示 | macOS 或 Linux | Node/Vue、Python 协议层、迁移期 .NET 代码、Fake 闭环、离线夹具 |
| 真实桌面自动化 | Windows 11 x64 实体机 | pywinauto、微信 UIA、真实输入与截图（M0 Spike 通过后才可启用） |

在 macOS 上完成本手册全部步骤后，系统可以在模拟适配器下跑通“消息 → 任务编排 →
模拟结果 → 管理台展示”的闭环，但**不具备**真实微信收发和真实桌面操作能力。

## 2. 环境要求

### 2.1 必需运行时

| 软件 | 版本要求 | 验证命令 |
|---|---|---|
| Node.js | 24 LTS（24.x） | `node --version` |
| npm | 11.x | `npm --version` |
| Python | 3.11.x | `python --version` |
| uv | 当前锁文件兼容版本 | `uv --version` |
| .NET SDK | 10.0.x（仅迁移期 C# 回归与 `npm run check:all` 需要） | `dotnet --version` |
| Git | 任意近期版本 | `git --version` |

仓库根目录的 `.nvmrc` 固定 Node 24，CI 也使用该文件。若本机装有更新的 Node，
可通过 nvm/fnm 切换，或在 macOS 上用 Homebrew 的 keg-only 版本：

```bash
brew install node@24
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --version
```

### 2.2 磁盘与网络

- 首次安装约需 500 MB（npm 依赖、.NET 还原包、Playwright 浏览器按需另算）。
- `better-sqlite3` 为原生模块，安装时需要对应平台的预编译二进制；主流
  macOS/Windows/x64 与 ARM64 平台均提供，无需本机编译工具链。
- 安装阶段需要访问 npm 注册表；运行模拟闭环和离线夹具**不需要外网**。

## 3. 获取代码并安装依赖

```bash
git clone https://github.com/wanglijie050108/desktop-operator-simulator.git
cd desktop-operator-simulator
npm install
uv sync --project apps/desktop-agent-python
```

`npm install` 会通过 workspaces 安装 Node 组件；`uv sync` 按锁文件安装 Python
Agent。pywinauto 使用 Windows 条件依赖，在 macOS/Linux 上不会安装。

## 4. 配置

所有配置通过环境变量提供，**不存在配置文件，也不要在配置中写入账号凭据**。
未提供配置时系统按安全默认值运行（白名单为空、适配器失败关闭）。

### 4.1 Control Server 变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SERVER_HOST` | `127.0.0.1` | 仅允许回环地址（`127.0.0.1`/`localhost`/`::1`） |
| `SERVER_PORT` | `7070` | 1–65535 |
| `DATABASE_PATH` | `./data/automation.db` | SQLite 文件路径，目录会自动创建 |
| `COMMAND_PREFIX` | `#助手` | 指令前缀，1–50 字符 |
| `TRUSTED_SENDER_IDS` | 空 | 逗号分隔的脱敏发送者 ID，单项 ≤200 字符 |
| `ALLOWED_SHOPPING_DOMAINS` | 空 | 逗号分隔的纯主机名，自动转小写 |
| `AGENT_HEARTBEAT_INTERVAL_MS` | `5000` | 心跳间隔，1000–60000 |
| `ARTIFACT_DIR` | `./data/artifacts` | 截图/trace 目录 |
| `ARTIFACT_RETENTION_DAYS` | `7` | 产物保留天数，1–365 |
| `ARTIFACT_MAX_BYTES` | `524288000`（500 MB） | 产物总量预算，≥1024 |
| `ARTIFACT_CLEANUP_INTERVAL_MS` | `3600000` | 清理扫描间隔，≥10000 |
| `TASK_REAPER_INTERVAL_MS` | `10000` | 超时/中断扫描间隔，≥1000 |

### 4.2 Desktop Agent 变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CONTROL_SERVER_WS_URL` | `ws://127.0.0.1:7070/ws/agent` | 必须是回环地址、ws/wss 协议 |
| `AGENT_ID` | 内置固定 GUID | 建议每台机器显式指定唯一 GUID |
| `AGENT_NAME` | `python-placeholder-agent` | Python 节点显示名 |
| `AGENT_ALLOWED_ACTIONS` | 六类受限动作 | 逗号分隔的 WebSocket 动作名，如 `WINDOW_ACTIVATE,TAKE_SCREENSHOT`；未知值会拒绝启动 |
| `AGENT_WINDOWS_AUTOMATION_ENABLED` | `false` | 仅在 Windows M0 测试机显式设为 `true` |
| `AGENT_ALLOWED_PROCESSES` | 空 | 启用 Windows 动作时必填；逗号分隔纯进程名，禁止路径 |
| `AGENT_ARTIFACT_DIR` | `data/artifacts/desktop-agent` | Agent 窗口截图目录 |
| `WECHAT_PROCESS_NAME` | `WeChat.exe` | 仅允许 `WeChat.exe`/`Weixin.exe`，禁止路径 |
| `WECHAT_WINDOW_TITLE_CONTAINS` | 空 | 多顶层窗口时用于收窄只读取证目标 |

## 5. 启动

需要三个终端，全部在仓库根目录执行。

### 5.1 Control Server

```bash
TRUSTED_SENDER_IDS=demo-sender-id npm run dev
```

看到 Fastify 监听 `127.0.0.1:7070` 即启动成功。生产方式可先 `npm run build` 再
`npm start`。

### 5.2 Operator Web 管理台

```bash
npm run dev:web
```

管理台位于 `http://127.0.0.1:4173`，开发服务器把 `/api` 代理到 Control Server。

### 5.3 Desktop Agent

默认启动 Python Agent 的失败关闭执行器：

```bash
uv run --directory apps/desktop-agent-python desktop-agent-python
```

启动后 Agent 自动连接并注册，管理台“执行节点”视图出现该节点。默认执行器不会
操作桌面，日志会明确提示所有桌面动作返回 `NOT_IMPLEMENTED`。在专用 Windows M0
测试机可显式启用基础动作：

```powershell
$env:AGENT_WINDOWS_AUTOMATION_ENABLED = "true"
$env:AGENT_ALLOWED_PROCESSES = "notepad.exe"
$env:AGENT_ALLOWED_ACTIONS = "WINDOW_ACTIVATE,CLIPBOARD_SET_TEXT,INPUT_KEY_CHORD,TAKE_SCREENSHOT,MOUSE_MOVE,MOUSE_CLICK,MOUSE_DRAG,MOUSE_SCROLL"
$env:AGENT_ARTIFACT_DIR = "C:\automation-data\artifacts"
uv run --directory apps/desktop-agent-python desktop-agent-python
```

基础执行器只连接已运行且唯一匹配的白名单进程窗口，不负责启动任意程序。按键、
剪贴板和截图要求最近激活的目标窗口仍处于前台；微信读写仍返回 `NOT_IMPLEMENTED`。
鼠标动作同样要求目标窗口前台，并优先使用语义定位（`controlType`/`automationId`/`name` +
控件相对偏移）。窗口内相对坐标点击属于兜底路径，**默认关闭**，只有显式声明校准过的显示档
才启用：

```powershell
$env:AGENT_COORDINATE_MOUSE_PROFILE = "1920x1080@96"
```

该变量格式为 `宽x高@DPI`，仅在实时分辨率与 DPI 完全一致时才允许
`MOUSE_CLICK_POSITION`；未配置时该动作返回 `POLICY_DENIED`，不一致返回
`DISPLAY_PROFILE_MISMATCH`。`AGENT_ALLOWED_ACTIONS` 不包含 `MOUSE_CLICK_POSITION`
时，该动作在执行器之前就会被策略拒绝。
迁移期间仍可用
`dotnet run --project apps/desktop-agent/src/DesktopAgent/DesktopAgent.csproj`
启动 C# 回归基线，但不得与使用相同 `AGENT_ID` 的 Python Agent 同时运行。

## 6. 验证安装

| 检查 | 操作 | 预期 |
|---|---|---|
| 健康检查 | 浏览器打开 `http://127.0.0.1:7070/health` | 返回服务状态 JSON |
| 管理台 | 打开 `http://127.0.0.1:4173` | 显示三视图与节点计数 |
| Agent 在线 | 管理台“执行节点”视图 | 节点状态为“在线” |
| 离线夹具 | 打开 `http://127.0.0.1:4173/offline-demo.html` | 显示六场景演示页 |
| 日常质量门 | `npm run check` | Node 与 Python 的格式、类型、测试、构建全部通过（无需 .NET SDK） |
| 完整质量门 | `npm run check:all` | 追加 .NET 格式/构建/单测与 C# Agent 集成回归（需 .NET 10 SDK） |
| Windows 基础动作 | `npm run test:spike:m0:notepad` | 20 轮完成且报告通过率 ≥95% |
| Windows 鼠标动作 | `npm run test:spike:m0:notepad-mouse` | 20 轮完成且报告通过率 ≥95%，指针/插入点/选区/滚动均被读回验证 |
| 微信 UIA 取证 | `npm run test:spike:m0:wechat-inspect` | 生成脱敏结构报告，人工确认未截断 |

也可以直接用文件方式打开离线夹具，无需任何服务：

```bash
open apps/operator-web/public/offline-demo.html
```

## 7. Windows 真实执行节点（未验证）

以下步骤属于真实环境接入，当前**尚未执行、未验证**，必须在 M0 Spike 通过
（PoC 成功率 ≥90%）后按 [`07-windows-test-environment.md`](07-windows-test-environment.md)
实施：

1. 在 Windows 11 x64 安装 Python 3.11、uv 与 Node.js 24 LTS；迁移期保留 .NET 10。
2. 确认物理桌面会话、1920×1080 分辨率、100% 缩放，不使用 RDP 断开式会话。
3. 使用 Inspect.exe/py_inspect 比较 `uia` 与 `win32` backend 的微信控件树。
4. 在目标机验证 Python 基础执行器，并根据控件树实现微信 Adapter。
5. 固化目标软件版本和专用演示账号。

在以上步骤完成前，不得把系统用于真实微信或真实桌面操作。

## 8. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 启动报 `SERVER_HOST must resolve to the local machine` | 认证完成前只允许回环监听，改回 `127.0.0.1` |
| 任务结果为 `ADAPTER_NOT_CONFIGURED` | 真实适配器未配置，属预期；开发/演示使用 Fake 或离线夹具 |
| 桌面动作返回 `NOT_IMPLEMENTED` | Python 未显式启用 Windows 基础执行器，或动作属于尚未实现的微信 Adapter |
| `better-sqlite3` 加载失败 | 删除 `node_modules` 后重新 `npm install`，确认 Node 为 24.x |
| 管理台数据加载失败 | 确认 Control Server 已启动且端口为 7070 |
| Node 版本与 `.nvmrc` 不一致 | 切换到 Node 24，再执行安装与质量门 |

## 9. 卸载与数据清理

- 程序本身没有系统级安装；删除仓库目录即移除代码。
- 运行数据位于 `./data`（SQLite 数据库与产物目录），可直接删除，删除前确认
  其中没有需要留存的实验记录。
- npm、uv 与 .NET 的全局缓存不会因删除目录而自动清理；不要在不确认其他项目影响
  的情况下清理全局缓存。
