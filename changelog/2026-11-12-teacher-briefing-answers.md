# 回复导师下发材料的三问：方向一致性、服务器部署方式、Token 用法

## 元信息

- 日期：2026-11-12
- 状态：已完成（只读分析交付；无代码、文档、契约改动）
- 环境：Windows 11；仅读取本地材料，未运行构建与测试
- 分支：`feature/pywinauto1`

## 目标

- 依据导师下发的三个 txt（`建议.txt`、`说明.txt`、`腾讯云psw.txt`）以及
  `网络综合工程设计选题报告.docx`、`人工操作模拟器软件设计和实现_*.docx`，
  回答三个问题：
  1. 当前项目方向是否与导师一致；`openclaw`、`workbuddy` 是否被使用。
  2. 项目编号 `gcsj-2` 是否通过 WinSCP 上传到 `raddh` 后访问
     `www.raddh.com/gcsj-2/`。
  3. `腾讯云psw.txt` 是否为免费 token，以及如何使用。

## 上下文与证据

- 只读材料：`C:\Users\Huuard\Desktop\综合工程设计\{建议,说明,腾讯云psw}.txt`、
  仓库根目录两份 docx（`网络综合工程设计选题报告.docx`、`人工操作模拟器软件设计
  和实现_20260920060508A011.docx`、`网络综合工程设计-1-选题报告-改进版.docx`）。
- 仓库证据：`docs/02-system-architecture.md` §10、`apps/control-server/src/config.ts`
  （回环强制）、`apps/operator-web/vite.config.ts`（根路径 + `/api` 代理）、
  `docs/08-development-status.md`、`README.md`、`package.json` 脚本。
- 关键词检索：`grep -ril -E "openclaw|workbuddy|codebuddy|qoder"` 在整个仓库
  （排除 `node_modules`、`.git`）**零命中**。

## 分析与决策

### 问题 1：方向一致性

- 课题方向（Windows 桌面 UI 自动化代理、聊天入口、AI 问答 + 商品查询、不含支付）
  与 `人工操作模拟器软件设计和实现` 任务书、选题报告一致。
- `openclaw`、`workbuddy/codebuddy`、`qoder` 只出现在导师 `建议.txt` 的“至少安装”
  清单中，属**开发辅助工具**，不是任务书或选题报告里的交付要求；仓库未使用。
- `建议.txt` 中的 `winscp` 是上传工具，与课程服务器配套。
- 需要向导师确认的点：任务书原文要求“掌握 C#、nodejs”，而项目已按
  ADR-008/A 版选题报告迁移为 Python 3.11 + pywinauto，C# 仅作协议参考基线。
  若导师仍按原始任务书检查 C# 实现，需说明迁移理由或以选题报告为准。

### 问题 2：服务器部署

- `说明.txt` 明确 nginx 转发路径为 `/gcsj1/ → 8020`、`/gcsj2/ → 8030`、
  `/gcsj3/ → 8040`，**无连字符**；因此访问地址更可能是
  `http://www.raddh.com/gcsj2/`，而不是 `gcsj-2`。需向导师确认目录名。
- 该转发是**反向代理到本机端口**，不是静态目录托管：上传文件后还需要在服务器上
  启动一个监听 8030 的进程，否则页面打不开。
- 关键结论：本项目是 **Windows 桌面自动化系统**，`pywinauto`/UIA 无法在 Linux
  服务器运行。可上传的只有 Operator Web 静态构建（以及理论上可选的 Control Server），
  桌面代理必须留在 Windows 代理机上演示。
- 仓库当前状态与公网部署直接冲突：
  - `docs/02` §10：MVP 全部组件同机，**不建议部署到公网**。
  - `config.ts:22-26`：`SERVER_HOST` 非回环时直接抛错，认证未实现前不允许对外监听。
  - `operator-web` 以站点根路径构建、`/api` 代理到 `127.0.0.1:7070`，放到
    `/gcsj2/` 子路径需改 `base` 与 API 前缀。
- 因此若导师要求“把项目文件传上去”，应理解为**交付物归档/演示页面**，而不是
  整套系统在服务器上运行。

### 问题 3：Token

- `腾讯云psw.txt` 是课程下发的**腾讯云 Token Plan** 凭据与配置片段：
  `baseUrl = https://tokenhub.tencentmaas.com/v1`，模型含 `hy3`、`glm-5.3`、
  `kimi-k3`；另含主/子用户 `SecretId/SecretKey`、控制台登录 URL 和一个闲置 key。
- 它是 OpenAI 兼容的模型 API 额度，**不是 WorkBuddy 账号密码**，也未标注“免费”，
  应视为课程配额。
- 文件内已给出预期用法：`openclaw config set 'models.providers.tokenhub' --json ...`
  → `openclaw config set models.mode merge` → `openclaw models set <模型>`，
  其中 `${KEY}` 替换为 Token Plan 密钥或闲置 key。
- WorkBuddy/CodeBuddy 是独立编码助手；只有在它支持“自定义 OpenAI 兼容模型”时，
  才填入上述 baseUrl + key，而不是填腾讯云账号密码。

### 补充：四个可选模型的取舍

- `腾讯云psw.txt` 实际列出四个模型：`hy3`、`deepseek-v4-pro`、`glm-5.3`、
  `kimi-k3`；配置片段默认 `openclaw models set .../hy3`。
- 未取得任何官方基准数据，也未实测；以下为基于模型家族定位的工程判断，不是评测结论。
- 建议：编码与工具调用优先 `deepseek-v4-pro`；长文档/长上下文优先 `kimi-k3`；
  中文写作与综合均衡选 `glm-5.3`；`hy3` 作为默认/轻量备选。
- 本项目运行时不调用这些模型（固定工作流 + Playwright 网页问答），它们只服务于
  开发辅助，因此选择标准是“编码与代理工具调用能力”，不是项目功能依赖。

## 操作记录

1. 读取三个 txt 并脱敏输出（长密钥替换为占位符）。
   - 结果：成功。
2. 用 python-docx 将三份 docx 转为 UTF-8 文本到仓库外临时目录后阅读。
   - 结果：成功。未在仓库内生成中间文件。
3. 核对仓库的部署约束、前端构建路径与工具关键词。
   - 结果：成功。确认回环强制、根路径构建、工具零命中。
4. 撰写本记录并给出答复。
   - 结果：成功。

## 文件变更

- `changelog/2026-11-12-teacher-briefing-answers.md`：本记录（新建）。
- 产品代码、`docs/`、契约：**无改动**。
- 仓库外临时文件：`~/.claude/tmp/docx-dump/*.txt`（docx 文本抽取，供阅读）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git status --short --branch` | PASSED | 仅新增本 changelog；产品代码与文档未改动。 |
| `grep -ril -E "openclaw\|workbuddy\|codebuddy\|qoder"` | PASSED | 零命中，确认仓库未使用这些工具。 |
| 读取 `docs/02` §10 与 `config.ts:22-26` | PASSED | 确认“不部署公网 + 回环强制”的既有约束。 |
| `npm run check` | NOT_EXECUTED | 无代码改动，按守卫规则无需运行质量门。 |
| raddh 服务器实际连通/部署 | NOT_EXECUTED | 未连接服务器，属只读咨询，未验证路径与端口。 |

## 风险与限制

- 未登录 `raddh` 验证 nginx 实际配置；`/gcsj2/` 与 `gcsj-2/` 的差异仅依据
  `说明.txt` 文字推断，需导师或实机确认。
- `说明.txt` 里三个私钥文件名均写作 `gcsj-1.pem`，疑为笔误；实际文件名需与
  本地文件核对。
- 未验证腾讯云 Token Plan 的剩余额度、有效期与限流策略。
- 未验证 WorkBuddy/CodeBuddy 是否支持自定义模型供应商。

## 最终结果

- 已形成三问的答复：方向一致但辅助工具未使用；服务器路径应为 `/gcsj2/` 且
  Linux 服务器不能运行桌面代理；psw 文件是 OpenAI 兼容的模型 Token，按 openclaw
  配置片段或任意兼容客户端使用，不是 WorkBuddy 登录凭据。
- 下一步：向导师确认目录命名、交付形式（归档还是运行）以及是否要求使用
  openclaw/workbuddy 工具链。
