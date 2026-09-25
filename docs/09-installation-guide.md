# 安装手册

本文说明如何在本机安装并启动人工操作模拟器的三个组成部分：Control Server、
Operator Web 管理台和 Desktop Agent。

- 编写日期：2026-09-24
- 适用版本：仓库 `0.1.0`（M1–M4 跨平台代码 + M5 可跨平台部分）
- 真实 Windows/微信/站点集成**尚未验证**，涉及步骤均已标注。

## 1. 适用范围

| 使用目的 | 需要的机器 | 可完成内容 |
|---|---|---|
| 逻辑开发与模拟演示 | macOS 或 Linux | 全部 Node/Vue/跨平台 .NET 代码、Fake 闭环、离线夹具 |
| 真实桌面自动化 | Windows 11 x64 实体机 | FlaUI、微信 UIA、真实输入与截图（M0 Spike 通过后才可启用） |

在 macOS 上完成本手册全部步骤后，系统可以在模拟适配器下跑通“消息 → 任务编排 →
模拟结果 → 管理台展示”的闭环，但**不具备**真实微信收发和真实桌面操作能力。

## 2. 环境要求

### 2.1 必需运行时

| 软件 | 版本要求 | 验证命令 |
|---|---|---|
| Node.js | 24 LTS（24.x） | `node --version` |
| npm | 11.x | `npm --version` |
| .NET SDK | 10.0.x | `dotnet --version` |
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
```

`npm install` 会通过 workspaces 同时安装 Control Server、Operator Web 和共享包。

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
| `AGENT_NAME` | `placeholder-agent` | 节点显示名 |
| `AGENT_ALLOWED_ACTIONS` | 空 | 逗号分隔的 Agent 端动作白名单 |

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

```bash
dotnet run --project apps/desktop-agent/src/DesktopAgent/DesktopAgent.csproj
```

启动后 Agent 自动连接并注册，管理台“执行节点”视图出现该节点。当前 Agent 使用
**占位执行器**，日志会明确提示所有桌面动作返回 `NOT_IMPLEMENTED`。

## 6. 验证安装

| 检查 | 操作 | 预期 |
|---|---|---|
| 健康检查 | 浏览器打开 `http://127.0.0.1:7070/health` | 返回服务状态 JSON |
| 管理台 | 打开 `http://127.0.0.1:4173` | 显示三视图与节点计数 |
| Agent 在线 | 管理台“执行节点”视图 | 节点状态为“在线” |
| 离线夹具 | 打开 `http://127.0.0.1:4173/offline-demo.html` | 显示六场景演示页 |
| 完整质量门 | `npm run check` | 格式、类型、测试、构建全部通过 |

也可以直接用文件方式打开离线夹具，无需任何服务：

```bash
open apps/operator-web/public/offline-demo.html
```

## 7. Windows 真实执行节点（未验证）

以下步骤属于真实环境接入，当前**尚未执行、未验证**，必须在 M0 Spike 通过
（PoC 成功率 ≥90%）后按 [`07-windows-test-environment.md`](07-windows-test-environment.md)
实施：

1. 在 Windows 11 x64 安装 .NET 10 SDK 与 Node.js 24 LTS。
2. 确认物理桌面会话、1920×1080 分辨率、100% 缩放，不使用 RDP 断开式会话。
3. 构建 `apps/desktop-agent/src/DesktopAgent.Windows`（计划中的 FlaUI 驱动，尚未开发）。
4. 替换占位执行器并启用微信 UIA 适配器。
5. 固化目标软件版本和专用演示账号。

在以上步骤完成前，不得把系统用于真实微信或真实桌面操作。

## 8. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 启动报 `SERVER_HOST must resolve to the local machine` | 认证完成前只允许回环监听，改回 `127.0.0.1` |
| 任务结果为 `ADAPTER_NOT_CONFIGURED` | 真实适配器未配置，属预期；开发/演示使用 Fake 或离线夹具 |
| 桌面动作返回 `NOT_IMPLEMENTED` | 当前是占位执行器，真实 Windows 驱动尚未接入 |
| `better-sqlite3` 加载失败 | 删除 `node_modules` 后重新 `npm install`，确认 Node 为 24.x |
| 管理台数据加载失败 | 确认 Control Server 已启动且端口为 7070 |
| Node 版本与 `.nvmrc` 不一致 | 切换到 Node 24，再执行安装与质量门 |

## 9. 卸载与数据清理

- 程序本身没有系统级安装；删除仓库目录即移除代码。
- 运行数据位于 `./data`（SQLite 数据库与产物目录），可直接删除，删除前确认
  其中没有需要留存的实验记录。
- npm 与 .NET 的全局缓存不会因删除目录而自动清理，如需彻底清空间可分别执行
  `npm cache clean --force` 和 `dotnet nuget locals all --clear`。
