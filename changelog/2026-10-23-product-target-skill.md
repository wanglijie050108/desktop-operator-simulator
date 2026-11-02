# 固化产品目标 Skill

## 元信息

- 日期：2026-10-23
- 状态：已完成
- 环境：Windows 11；git 状态未确认（工作区无提交要求即不提交）

## 目标

将用户给定的课程设计产品目标固化为仓库级强制 Skill，作为所有开发任务的"北极星需求"，
约束组件职责、闭环主路径与安全红线，避免后续任务偏离目标。

## 上下文与证据

- 用户原话（一字不改）：用一台电脑作为代理人，安装聊天工具、购物工具和 AI 提问平台；
  用户用另一台电脑或手机向聊天工具发出购物指令，代理人电脑接收指令→向 AI 咨询→
  完成购物查询→将最优结果返回用户。
- 现有文档：`README.md`、`docs/01-08`、`docs/14-plan-b-design.md`（ADR-010/011）、
  守卫 Skill（`.trae/skills/human-operation-simulator-guardrails/SKILL.md`）、`AGENTS.md`。
- 该目标与方案 B（ADR-010）一致：单代理机、Control Server 拥有决策循环、Python Agent
  只执行白名单动作、购物默认走桌面 GUI。

## 分析与决策

- 新建独立 Skill 而非仅写进 README：使目标在"每次任务强制阅读"链中，且不与现状文档混淆。
- 角色映射：聊天工具=入口/出口（ADR-011 暂用本地/模拟入口）、购物工具=浏览器（桌面 GUI
  为主、Playwright 快路径/观察）、AI 提问平台=Control Server 决策循环（LLM 只提议不执行）。
- 红线直接引用守卫 Skill §4，重复固化，避免后续被"加个启动动作/放宽是非"削弱。
- 未更改既有架构、文档结论或代码；仅新增约束源并接入强制阅读。

## 操作记录

1. 新增 `.trae/skills/product-target/SKILL.md`：含目标原文、组件映射、闭环、红线、使用规则。
   - 结果：成功。
2. 修改 `AGENTS.md`：将强制阅读链改为先 `product-target` 再 `human-operation-simulator-guardrails`，
   并更新冲突优先级与 CLAUDE.md 通过 `@AGENTS.md` 自动继承。
   - 结果：成功。
3. 本文件记录：与改动一起登记。
   - 结果：成功。

## 文件变更

- `.trae/skills/product-target/SKILL.md`：新建，固化产品目标。
- `AGENTS.md`：强制阅读列表与冲突优先级更新（CLAUDE.md 经 `@AGENTS.md` 同步生效）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 文件存在性 | PASSED | product-target/SKILL.md 与 AGENTS.md 均已写入 |
| 守卫 Skill 未被破坏 | PASSED | 仅在 AGENTS.md 列表前置 product-target，原守卫链路保留 |
| 链路一致性 | PASSED | CLAUDE.md `@AGENTS.md` 继承新阅读顺序 |

## 问题与处理

- 无。

## 风险与限制

- 目标本身依赖 ADR-011 选型的聊天入口尚未最终落地；本 Skill 仅固化目标与红线，不替代理选型决策。
- 真实聊天/购物/AI 通道仍待 M6 与站点冻结后验证，现状见 `docs/08`。

## 最终结果

- 产品目标已固化为仓库级强制 Skill 并接入每次任务强制阅读；后续开发须以该目标为最高层需求校验。
- 未完成项：聊天入口选型（微信 3.9.x / 暴露 UIA 的替代软件）与决策层 M6 仍待开发。
