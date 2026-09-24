# 搭建跨平台工程基础

## 元信息

- 日期：2026-09-24
- 状态：已完成
- 环境：macOS；Node.js 26.0.0、npm 11.12.1、.NET SDK 10.0.401

## 目标

- 依据既有实施计划，选取可在 macOS 验证的首个开发增量并完成实现。
- 建立可复现的构建、静态检查和自动化测试基线。

## 上下文与证据

- 已阅读 `AGENTS.md`、项目守卫 Skill、`README.md` 和 `changelog/README.md`。
- 当前仓库处于开发前设计基线，根目录尚无 `apps/`、`packages/` 或测试工程。
- 任务开始时 Git 工作区干净，当前分支为 `codex/add-ai-development-guardrails`。
- 规范要求 Node.js 24 LTS；当前主机为 Node.js 26，因此工程声明
  `24.x`，当前机器仅用于尽可能早地发现兼容性问题。

## 分析与决策

- 开发范围限定为 INFRA-01 的跨平台子集和 `/health`：npm
  workspace、严格 TypeScript、质量工具、Fastify 应用工厂和契约测试。
- 不在 macOS 上尝试伪造 FlaUI 或真实 Windows UI 验证。
- 服务在认证实现前只允许绑定回环地址，显式拒绝对局域网或公网监听。
- 依赖使用精确版本；TypeScript 采用 `6.0.3`，以满足 `typescript-eslint@8.70.1` 的 `<6.1.0` peer
  dependency 约束。

## 操作记录

1. 完成仓库入口、强制规范、当前状态与文件清单检查。
   - 结果：成功。
   - 影响：仅新增本任务工作记录。
2. 阅读全部规范文档、OpenAPI 契约和最新历史记录，确认开发边界。
   - 结果：成功。
   - 影响：选择不依赖 Windows Spike 的工程骨架与健康检查作为实现范围。
3. 创建 npm workspace、TypeScript/ESLint/Prettier/Vitest 配置和 Control Server。
   - 结果：成功。
   - 影响：新增根工程配置、`apps/control-server` 实现与测试。
4. 首次安装依赖。
   - 结果：失败；TypeScript 7.0.2 超出 typescript-eslint 的兼容范围。
   - 影响：未生成可用依赖树，改用最新兼容版 TypeScript 6.0.3 后重试。
5. 安装兼容依赖并生成 `package-lock.json`。
   - 结果：成功；生产依赖审计未发现漏洞。
   - 影响：依赖版本和传递依赖树可由 `npm ci` 重现。
6. 执行首轮格式化和质量检查。
   - 结果：部分完成；发现格式化范围过宽、类型导入错误、Vitest 5 配置变化和一个
     未覆盖默认分支。
   - 影响：恢复已有文档的纯格式改动，收窄格式化脚本，并修复全部配置与测试问题。
7. 增加 Node.js 24 CI、`.nvmrc` 和统一 `npm run check` 入口。
   - 结果：成功。
   - 影响：Pull Request 和 `main` 推送将执行干净安装与完整 Node 质量门。
8. 在临时 Node.js 24.21.0 环境执行干净安装和完整质量检查。
   - 结果：成功；20 项测试全部通过，目标模块四项覆盖率均为 100%。
   - 影响：确认工程满足规定的 Node.js 24 LTS 运行时。
9. 启动构建产物并执行 HTTP 冒烟测试。
   - 结果：成功；`/health` 返回 200 与契约 JSON，未声明路由返回 404，SIGTERM
     触发正常关闭。
   - 影响：验证编译产物可作为真实进程运行。
10. 执行两轮 diff、依赖、安全边界与忽略规则自审。
    - 结果：成功；补充 profile 和 SQLite 产物忽略，并确认非回环监听失败关闭。
    - 影响：未发现越权动作、敏感数据或无关文档改动。
11. 按用户要求提交当前开发成果并合入本地主分支。
    - 结果：成功；工程提交为 `7284947`，本地 `main` 通过 fast-forward 更新。
    - 影响：同时纳入该开发分支已有的两笔仓库守卫规则提交；未推送远端。

## 文件变更

- `changelog/2026-09-24-bootstrap-foundation.md`：记录本次分析、开发与验证过程。
- `package.json`、`tsconfig.base.json`、`eslint.config.mjs`、Prettier/EditorConfig：建立 workspace 和统一质量基线。
- `.gitignore`：排除依赖、构建产物、运行数据、日志、凭据覆盖和 IDE 文件。
- `apps/control-server/`：新增健康检查、启动配置、服务入口和单元测试。
- `.github/workflows/ci.yml`、`.nvmrc`：新增 Node.js 24 持续集成和版本入口。
- `package-lock.json`：锁定完整 npm 依赖树。
- `README.md`：更新当前开发阶段、质量命令、启动方式和监听限制。

## 验证

| 命令或检查                                         | 状态         | 结果                                                         |
| -------------------------------------------------- | ------------ | ------------------------------------------------------------ |
| `git status --short --branch`                      | PASSED       | 任务开始前工作区干净。                                       |
| 首次 `npm install`                                 | FAILED       | TypeScript 7.0.2 与 typescript-eslint peer dependency 冲突。 |
| 修正后的 `npm install`                             | PASSED       | 安装成功，审计 0 个漏洞。                                    |
| 首轮 `npm run lint/typecheck/test/build`           | FAILED       | 暴露类型导入、配置 API 与覆盖率问题，均已修复。              |
| Node 26 下格式、lint、类型、测试、构建             | PASSED       | 20 项测试通过，覆盖率 100%。                                 |
| Node 24.21.0 下 `npm ci && npm run check`           | PASSED       | 干净安装及全部质量门通过。                                   |
| `GET http://127.0.0.1:7070/health`                 | PASSED       | 返回 `{"status":"ok","version":"0.1.0"}`。                   |
| 未声明路由 HTTP 冒烟检查                           | PASSED       | 返回 404。                                                   |
| 非回环 `SERVER_HOST` 进程检查                      | PASSED       | 进程以状态 1 退出并记录明确配置错误。                        |
| `npm audit --omit=dev`                             | PASSED       | 未发现生产依赖漏洞。                                         |
| CI YAML 解析、`git diff --check`、忽略规则检查     | PASSED       | 语法、空白和敏感/生成产物排除均符合预期。                    |
| Windows UIA、微信和真实桌面验证                    | NOT_EXECUTED | 本次范围不包含 Windows 桌面能力，且当前为 macOS。            |

## 问题与处理

- 现象：首次 `npm install` 返回 `ERESOLVE`。
- 根因：`typescript-eslint@8.70.1` 要求 TypeScript `<6.1.0`。
- 处理：将 TypeScript 精确锁定为兼容的 `6.0.3`，不绕过依赖校验。
- 结果：安装与 Node 24/26 质量检查均通过。
- 现象：首次 `prettier --write .` 改写了已有规范文档格式。
- 根因：格式化脚本范围包含整个仓库。
- 处理：仅恢复该次产生的既有文档格式改动，并将脚本收窄到工程配置和源码。
- 结果：最终 diff 不含无关规范文档格式变化。
- 现象：首轮质量检查报告类型导入、Vitest 5 配置和覆盖率错误。
- 根因：严格 ESM 类型导入要求、已移除的 `coverage.all` 选项及默认版本分支未测试。
- 处理：使用 type-only import，删除失效配置，并新增默认版本测试。
- 结果：20 项测试通过，四项覆盖率均为 100%。

## 风险与限制

- 主机默认 Node.js 仍为 26.0.0；已通过临时 Node.js 24.21.0 完成干净安装和完整复验，
  CI 也固定使用 24，但目标 Windows 主机尚未验证。
- 本次只完成 INFRA-01 的 Node 工程基线与 Control Server 健康检查，不包含 SQLite、
  WebSocket、.NET solution 或业务工作流。
- M0 的微信、AI 页面和购物站点 Spike 尚未执行；真实 Windows 桌面自动化仍不可判定。

## 最终结果

- 已建立可复现的 npm monorepo、严格 TypeScript 质量门、Node.js 24 CI 和最小
  Control Server。OpenAPI 中的 `/health` 已实现并通过单元、覆盖率、构建和真实进程
  冒烟验证。工程提交 `7284947` 已合入本地 `main`，尚未推送远端；后续仍应先在目标
  Windows 环境完成 M0 Spike，再扩展剩余 M1 能力。
