# 建立 AI 开发约束与持久化工作记录

## 元信息

- 日期：2026-09-24
- 状态：进行中
- 环境：macOS 26.4.1 arm64，Git 仓库 `main` 分支

## 目标

- 创建可随仓库同步的项目级 Skill，使新环境中的 AI 助手遵循一致的架构、
  质量、安全和验证规则。
- 建立 `changelog/`，要求 AI 从任务分析开始持续记录操作、联调、失败和结果。
- 提供不依赖特定助手产品的仓库入口，提醒新助手加载项目 Skill。

## 上下文与证据

- 阅读了 `README.md`、`docs/01-requirements-and-scope.md` 至
  `docs/07-windows-test-environment.md`、`contracts/openapi.yaml`。
- 当前仓库处于开发前设计阶段，尚无应用代码或项目级 AI Skill。
- 现有全局 `ragsc-project-guardrails` 针对另一个 Python/RAG 项目，与本仓库
  的 C#、Node.js 和 Windows 桌面自动化架构不一致，因此不能作为本项目规则。
- 仓库初始工作树干净，分支为 `main`，跟踪 `origin/main`。

## 分析与决策

- Skill 采用仓库标准位置
  `.trae/skills/human-operation-simulator-guardrails/SKILL.md`，便于随 Git 在
  不同环境间同步并由 TRAE 发现。
- 增加根目录 `AGENTS.md`，让支持仓库指令文件的其他 AI 助手也能定位并读取
  Skill，避免只依赖某个 IDE 的自动发现机制。
- Skill 引用现有设计文档作为权威来源，不复制完整产品规格，防止出现两套架构。
- 工作记录采用“一项逻辑任务一个 Markdown 文件、执行过程中增量更新”的方式。
- “分析过程”记录可复核的证据、判断和取舍，不保存隐藏思维链、敏感信息或冗长
  原始命令输出。
- 开发主机不固定为 macOS。Windows 可承担完整开发与真实桌面联调；macOS/Linux
  可承担跨平台部分。验证要求按当前主机能力和任务范围决定，但 Windows UIA、微信
  和真实桌面闭环始终必须在符合文档要求的 Windows 交互式会话验证。

## 操作记录

1. 检查仓库状态、提交历史和现有目录。
   - 结果：成功。
   - 影响：只读，无文件改动。
2. 阅读 Skill 创建规范和现有项目守卫规则。
   - 结果：成功；确认项目级 Skill 的标准目录和 frontmatter 要求。
   - 影响：只读，无文件改动。
3. 阅读全部项目设计文档与 OpenAPI 草案。
   - 结果：成功；提取固定架构、安全边界、平台限制和测试要求。
   - 影响：只读，无文件改动。
4. 创建 `.trae/skills/human-operation-simulator-guardrails/` 和 `changelog/`。
   - 结果：成功。
   - 影响：新增两个目录。
5. 创建项目级 Skill 和根目录 AI 入口文件。
   - 结果：成功。
   - 影响：新增 `SKILL.md` 和 `AGENTS.md`。
6. 创建 changelog 规范及本次任务记录。
   - 结果：成功。
   - 影响：新增 `changelog/README.md` 和本文件。
7. 在 `README.md` 增加 AI 协作入口。
   - 结果：成功；Skill、`AGENTS.md` 和 changelog 规范均可从仓库首页发现。
   - 影响：修改 `README.md`。
8. 执行两轮自审与静态验证。
   - 结果：成功；发现并修正验证状态词大小写不一致。
   - 影响：更新 Skill 和本任务记录。
9. 根据后续开发设备将转为 Windows 的信息修正平台表述。
   - 结果：成功；不再预设 macOS 为主力开发机，改为按当前环境能力选择验证范围。
   - 影响：更新 Skill 和本任务记录。
10. 确认本次发布范围与 GitHub 前置条件。
    - 结果：成功；工作树仅包含本任务文件，GitHub CLI 已认证，远端为项目仓库。
    - 影响：准备从 `main` 创建独立发布分支并提交。

## 文件变更

- `.trae/skills/human-operation-simulator-guardrails/SKILL.md`：新增仓库开发、
  安全、跨平台测试、Git 与日志守卫规则。
- `AGENTS.md`：新增跨助手入口，强制优先读取项目 Skill。
- `changelog/README.md`：新增记录范围、命名、更新时机、状态词、模板和隐私边界。
- `changelog/2026-09-24-ai-development-guardrails.md`：记录本次任务过程与结果。
- `README.md`：增加 AI Skill、仓库入口和 changelog 规范链接。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| Ruby YAML/frontmatter 检查 | PASSED | 名称正确、正文非空、description 为 178 个字符 |
| 必需文件存在且非空检查 | PASSED | 四个新增规则与记录文件均存在且非空 |
| 本地 Markdown 链接检查 | PASSED | README、AGENTS 和规则文件中的本地链接均可解析 |
| 人工规则一致性复核 | PASSED | 修正验证状态词大小写，未发现架构与安全规则冲突 |
| 平台中立性复核 | PASSED | Windows 可进行完整开发；macOS/Linux 仅作为可选跨平台环境 |
| `git diff --check` | PASSED | 未发现空白错误 |
| 最终 `git status --short --branch` | PASSED | 预期的 1 个修改项和 3 组未跟踪路径，未提交 |
| Windows 真实环境验证 | NOT_EXECUTED | 本次只修改仓库协作规则，不涉及运行时行为 |

## 问题与处理

- 现象：已有全局仓库守卫 Skill 描述的是不同项目。
- 根因：全局 Skill 与当前仓库绑定信息不一致。
- 处理：不修改全局 Skill，创建当前仓库专用 Skill，并以现有项目文档为权威来源。
- 结果：项目约束不再依赖错误的 Python/RAG 架构。

## 风险与限制

- 非 TRAE 且不识别 `AGENTS.md` 的 AI 工具仍可能不会自动加载 Skill；README 已提供
  显式入口，但仍依赖助手遵守仓库说明。
- 本次仅建立规则，没有应用代码可执行，因此无法验证规则在实际联调中的执行效果。
- 当前发布正在执行；提交、推送和 PR 结果将在完成后补充。
- 后续助手必须检查实际运行环境，不得沿用本记录中的 macOS 环境作为长期假设。

## 最终结果

- 进行中：项目级规则已通过静态检查，正在创建独立分支、提交并上传到 GitHub。
