# 方案 A → 方案 B 转向：设计冻结与全仓文档对齐

## 元信息

- 日期：2026-10-10
- 状态：已完成（未提交）
- 环境：文档任务，未执行代码；主机 Windows 11 build 26200

## 目标

- 用书面设计冻结"方案 B：LLM 自主决策的操作代理"的边界。
- 修正全仓文档中与方案 B 冲突、以及与代码不符的过时表述，使文档自洽。

## 上下文与证据

- `docs/13` 已识别"AI 在系统里扮演什么角色"的歧义，并给出方案 A / 方案 B 两条路线；
  用户确认走方案 B。
- 只读审计（子智能体，覆盖 `docs/01`–`13`、根 `README`、`contracts/openapi.yaml`、
  守卫 `SKILL.md`、`changelog/README.md`）给出 40 条发现，其中 3 条为"不解锁则其余改动
  不自洽"的硬约束：
  1. `docs/06` ADR-005「确定性工作流优先于自主 Agent」+ 同节"不采用 ReAct/多智能体"；
  2. `docs/02` §5「AI 不得跳过、插入或改写这些步骤」；
  3. `docs/01` FR-03「每个任务使用确定的工作流和白名单动作」（P0 需求级）。
- 源码复核（本次直接核对）：`apps/control-server/package.json` 无任何 LLM 依赖；
  `app.ts` / `server.ts` 只注入 `Unavailable*Adapter`，Fake 适配器只存在于测试；
  `apps/control-server/src` 无 Playwright 引用；`parseProductSearchCommand` 为纯正则，
  预算模式只匹配阿拉伯数字。
- 用户决策（4 项）：观察 = 结构树为主 + 视觉兜底；模型 = 国内 API（OpenAI 兼容）；
  商品链路 = 桌面 GUI（AI 用鼠标键盘操作浏览器）；聊天入口 = 本期不解决，用本地/模拟
  入口驱动闭环。

## 分析与决策

- **决策循环放 Control Server 而非 Python Agent**：白名单、双重策略、幂等、超时、
  急停、留证全在 Server 侧，放这里不改 WebSocket 协议、不动 Agent，且每步决策可持久化、
  可回放、可审计。Agent 保持"只执行白名单动作"的单一职责，安全边界一行不用动。
- **安全边界不放宽，只增加约束**：LLM 只提议不执行；提议走与固定工作流完全相同的
  五级校验链；提示注入按一等威胁处理；成功由确定性 verifier 判定；轮次/时间/token
  三重预算；轨迹脱敏入库并可回放。
- **非确定性用"可复现"化解**：决策轨迹按 `taskId + round` 回放，校验链在回放中不跳过；
  保留原八步工作流作为确定性快捷路径与演示兜底。
- **不新增 npm 包**：OpenAI 兼容协议用内置 `fetch` 实现，减少依赖与注入面。
- ADR-005 采用"状态标注被取代 + 原文保留"的处置（与 ADR-001/008 既有惯例一致），
  而不是改写或删除，以保留决策历史。
- 新增 ADR-011 记录微信通道选型：不采用跨进程读写内存路线，入口通道本期不解决。
- 未采用的做法：把文档重写为"现状描述"（会丢失决策历史）；把 LLM 放进 Python Agent
  （跨进程策略复制、调试成本高）。

## 操作记录

1. 新建 `docs/14-plan-b-design.md`：10 项已决策事项、架构与模块、安全边界重划、
   可靠性措施、P0/P1/P2 文档修正清单、明确不做项、待补决策、实施顺序建议。
   - 结果：成功。该文档定位为"决策记录 + 落地清单"，规格本身仍回归各权威文档，
     以符合守卫 §1"不得建立第二套独立规格"。
2. 解锁三处硬约束：新增 ADR-010（取代 ADR-005，ADR-005 标注被取代并保留原文）、
   修订 ADR-003 的"不引入视觉模型"条款、改写 `docs/02` §5 并新增 §5.1/§5.2
   区分决策循环与快捷路径、改写 `docs/01` FR-03 并把 FR-11~FR-16 立为 P0。
3. 同步守卫 `SKILL.md`：§1 增加 `docs/14` 为权威来源；§3 增加决策循环归属、
   "提议是数据不是命令"、禁止 LLM 产出代码/路径/直发文本、观察树上报归 Agent；
   §4 增加提示注入分层防线与三重预算；§6 增加决策循环测试层。
4. 同步契约与验收：`docs/03` 新增 Observation / DecisionTrace / DecisionBudget 实体、
   `DESKTOP_INSPECT_TREE` 动作及其隐私约束、6 个新错误码、`recover` 与 `statistics`
   端点、决策配置变量；`docs/05` 新增决策循环测试层（8 项不变量）、7 个验收场景
   （AT-17~AT-23）、4 项决策指标、五类载体的提示注入测试集、演示脚本扩展。
5. 同步计划与状态：`docs/04` 新增 M6 里程碑、9 项任务（OBS-01…FAST-01）与
   DoD 决策层条款；`docs/08` 新增"方案 B 转向说明"、M6 未开发清单与限制。
6. 清理过时表述：`docs/02` 标注 Browser Worker 尚未实现；`docs/06` ADR-008 标注失效
   说明；`README` 更正"仅通过 Fake"与"Playwright 抓商品已实现"；`docs/09` 更正
   Fake 适配器误导与新增决策变量；`docs/07` 更正"仅通过跨平台 Fake"并补观察层验收；
   `docs/10`/`docs/11`/`docs/12`/`docs/13` 同步表述与历史标注。
7. 收尾核验时新发现两处**方案 B 落地前的设计缺口**，已记录并（部分）收口：
   - `docs/14` §8 **D11**：Agent 只接管已运行窗口且策略禁止文件路径，因此
     "打开浏览器/目标应用"在方案 B 下**没有合法通路**（R-17）。给出三个候选方案
     （新增白名单进程启动动作 / 人工预开 / AI 点桌面图标）并说明各自的安全代价。
     **用户决定：不新增启动动作，M6 按人工/启动脚本预开 + Agent 只接管已有窗口推进**；
     全自动"从零启动到完成"不在本期承诺范围，已写入 `docs/04` M6 范围边界、
     `docs/08` 前置步骤、`docs/12` 演示准备与答辩口径。
   - `docs/14` §8 **D12**：决策循环步骤数运行前不可知，与 `PLANNED`"已生成固定步骤"
     语义冲突（R-18）；`docs/02` §5 与 `docs/10` §3 已先统一为"已生成执行计划"并
     标注待正式收口。
8. 落实用户对意图解析的决策：**D10 定为"仅对正则解析失败的消息追加一次 LLM 解析
   尝试"**。写入 `docs/14` §1.1、`docs/03`（解析边界与已知限制）、`docs/04`（新增
   LLM-02 任务）、`docs/06` §3.1、`docs/08`（M6 清单）、`docs/12`（答辩口径）。
9. 按保留策略清理 changelog：先逐条确认关键事实已移交长期文档，再把 3 个已提交条目
   移出工作区，并同步索引。清理前发现两处结论**尚未**移交，先补齐再删：
   `fix-unmatched-key-release` 的"其它 WinUI/XAML 应用焦点未验证"写入 `docs/08` 限制节；
   `docs/13` 第 2 节补注该结论描述的是转向之前的状态。
10. 按用户要求，在工作区外生成独立汇总文档（见"文件变更"最后一项）。

## 文件变更

- `docs/14-plan-b-design.md`：新增，方案 B 决策与落地清单。- `docs/06-decisions-and-risks.md`：新增 ADR-010、ADR-011；ADR-003/005/008 修订或
  标注被取代；风险登记新增 R-11~R-16；§3 拆为已冻结与仍未冻结。
- `docs/01-requirements-and-scope.md`：项目目标补 AI 角色；FR-03 改写；新增
  FR-11~FR-16；OCR 兜底移入本期；非功能需求补可复现性与成本；新增 2 项待验证项。
- `docs/02-system-architecture.md`：架构图与组件职责新增决策循环、LLM、观察层；
  新增 §5.1/§5.2；§6 意图理解改为两级方案；§9 安全边界补 LLM 与注入条款。
- `docs/03-contracts-and-data.md`：新增 3 个实体、`DESKTOP_INSPECT_TREE` 及其约束、
  6 个错误码、2 个缺失端点、决策配置；删除未实现的配置文件描述与错误的超时变量。
- `docs/05-testing-and-acceptance.md`：新增决策循环测试层、AT-17~AT-23、4 项指标、
  §5.1 注入测试集、演示脚本扩展。
- `docs/04-implementation-plan.md`：新增 M6 里程碑与 9 项任务；DoD 补 3 条。
- `docs/08-development-status.md`：新增方案 B 转向说明；M6 未开发清单；
  限制新增"决策层完全未实现"与"观察层未支撑决策"。
- `docs/07/09/10/11/12/13`、`README.md`、`contracts/openapi.yaml`、
  `.trae/skills/human-operation-simulator-guardrails/SKILL.md`：同步与过时清理。
- `apps/desktop-agent-python/README.md`：补验证状态说明、Plan B 下 Agent 的职责边界
  （无 LLM、无决策逻辑）与观察路径的两条约束；澄清 `uia_inspection.py` 是离线取证
  工具而非决策循环的观察接口。
- `docs/13-architecture-fit-analysis.md`：第 2 节补注"该结论描述转向方案 B 之前的状态"，
  避免被误读为现状。
- `docs/08-development-status.md`：限制节补"窗口激活后的编辑焦点行为未在业务应用上
  校准"，用于承接被移出工作区的 `2026-10-10-fix-unmatched-key-release.md` 的风险结论。
- `changelog/README.md`：索引改为"当前记录 + 已按保留策略移出工作区"两段；移除 3 个
  已提交条目的索引项。
- 移除（仅工作区，git 历史保留）：`changelog/2026-10-05-changelog-policy-and-cleanup.md`、
  `changelog/2026-10-05-wechat-spike-b-readiness.md`、
  `changelog/2026-10-09-stale-doc-cleanup.md`。
- 工作区外：`C:\Users\24996\Desktop\软件代理人项目-总体设计方案与待确认事项.md`（应要求
  生成的独立汇总文档，不属于仓库资产、未纳入版本控制）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 三处硬约束解锁核对（ADR-005 / `docs/02` §5 / `docs/01` FR-03） | PASSED | 均已改写或标注被取代，其余章节与之一致 |
| 冲突表述残留扫描（`AI 只`/`不得跳过`/`ReAct`/`不引入 OCR`/`语言理解`） | PASSED | 仅剩历史记录与"已解除/已作废"说明，无生效冲突 |
| 过时表述残留扫描（`仅通过跨平台 Fake`/`config/default.json`/`TASK_TIMEOUT_SECONDS`） | PASSED | 仅剩显式"已删除/已更正"说明 |
| 跨文档链接核对（`14-plan-b-design` 被 6 个文档引用） | PASSED | 10 处引用路径均可解析 |
| `package.json` 依赖核对（LLM 客户端 0 命中） | PASSED | 与 `docs/08` 新写入的现状一致 |
| 代码侧动作枚举核对（`DESKTOP_INSPECT_TREE` 0 命中） | PASSED | Python `policy.py`/`protocol.py` 与 `packages/contracts` 均无该动作，与"待实现"标注一致 |
| 全仓 Markdown 覆盖核对（`apps/desktop-agent-python/README.md`） | PASSED | 已补 Plan B 职责边界与验证状态 |
| 过期文档二次扫描（`xUnit` / `DotNet.SDK` / `迁移期` / `check:all` / `dotnet`） | PASSED | 无过期可执行指令；残留均为历史记录或"已移除"说明。核对 `.github/workflows/ci.yml` 只剩 `node`/`python`/集成三个 job，无 `dotnet` job |
| 移交长期文档后再清理 changelog（3 个已提交条目） | PASSED | `2026-10-05-changelog-policy-and-cleanup`、`2026-10-05-wechat-spike-b-readiness`、`2026-10-09-stale-doc-cleanup` 已移出工作区；清理前逐条确认其关键事实已存在于 `docs/02`、`docs/04`、`docs/07`、`docs/08`、`docs/11` 与根 `README` |
| changelog 索引与目录一致性 | PASSED | 索引改为"当前记录 + 已移出工作区"两段，无指向不存在文件的链接 |
| `npm run check` | NOT_EXECUTED | 本次无代码改动；仓库存在未提交的既有代码改动（`windows_backend.py` 等），质量门应在提交前由代码改动的作者执行 |
| 真实 Windows / 站点 / LLM 验证 | NOT_EXECUTED | 决策层尚未实现，无可验证对象 |

## 问题与处理

- 现象：`pwsh` 在本工作区完全无法启动，报 `SetNamedSecurityInfoW failed (Win32 5):
  grantWrite(D:\course_design)`，导致无法执行 git 等命令。
  - 根因：工作区目录缺少有效 `WRITE_OWNER` 权限，DSH 无法建立写入授权。
  - 处理：按 `diagnose-windows-sandbox-acl` 技能运行一次诊断修复，为当前用户补上
    完全控制权限并验证通过；备份与回滚脚本在 `D:\course_design\.dsh-acl-recovery\`。
  - 结果：`pwsh` 恢复正常；`git` 未加入 PATH，改用完整路径调用。该项与仓库无关。
- 现象：多次 `edit` 报"file changed since it was read"。
  - 处理：重新读取后重试，均成功；未发现内容被意外改写。
  - 结果：改动完整。

## 风险与限制

- 本次为**纯文档改动**，未改任何代码；因此文档描述的方案 B 仍是设计而非实现，
  容易被误读为已完成能力——已在 `docs/08`、`README`、`docs/12` 三处显式声明
  "决策层未实现"。
- 多数**行号锚点**在实施中会漂移（`docs/14` §6 的 `:145`、`:27` 等）；清单的语义是
  "改哪一处"，引用行号仅供定位参考。
- 预算具体数值、视觉兜底模型型号、目标站点均未冻结（`docs/06` §3.2）。
- **"打开目标应用/浏览器"已决定不新增启动动作（`docs/14` §1.2 D11 / R-17）**：
  代价是真实环境验证与演示必须人工预开浏览器与 AI 页面，"从零启动应用"的全自动闭环
  不在本期范围；答辩时必须如实说明这一前置人工步骤。若后续要求全自动，需重新评估并
  扩大 Agent 能力面。
- 状态机 `PLANNED` 语义仅做了文字统一，尚未正式收口（`docs/14` §8 D12 / R-18）。
- 守卫 `SKILL.md` 的修改扩大了允许的架构范围（LLM 提议），该文件是 AI 行为约束，
  其放宽需人工复核；本次已把"LLM 无执行权"等约束一并写入，未放宽禁止动作与
  安全红线。
- 未提交：所有改动仍在工作区，未 `git add` / commit。

## 最终结果

- 已完成：方案 B 设计冻结（ADR-010/011 + `docs/14`，含 D10/D11 两项本轮追加决策）；
  三处硬约束解锁；20 个文件共 896 行插入、110 行删除的文档对齐；守卫 Skill 同步。
- 未完成：M6 全部实现（观察层、LLM 适配器与意图解析补足、决策循环、verifier、预算、
  轨迹回放、注入测试集、快捷路径切换、管理台展示）；预算数值、视觉兜底模型与目标站点
  冻结；D12 的正式收口。
- 下一步：按 `docs/14` §9 的顺序，先用 Fake LLM 在跨平台环境实现并验证决策层的
  不变量（提议校验链、循环终止、注入防线、verifier、轨迹回放），再进入真实环境校准；
  真实环境验证前需人工预开浏览器与 AI 页面（D11）。
