# 架构与方案评估：目标 vs 当前架构

> 本文档整理自对 `desktop-operator-simulator` 项目源码与需求文档的通读分析，用于澄清一个核心疑问：**当前架构能否实现"让 AI 模拟人去购物网站查询并返回最优结果"这一最终目标，是否已经偏离。**
>
> 参考依据：[`docs/01-requirements-and-scope.md`](01-requirements-and-scope.md)、[`contracts/openapi.yaml`](contracts/openapi.yaml)、[`packages/contracts/src/index.ts`](packages/contracts/src/index.ts)、[`apps/control-server/src/application/product-search-workflow.ts`](apps/control-server/src/application/product-search-workflow.ts)、[`apps/control-server/src/domain/product-search-command.ts`](apps/control-server/src/domain/product-search-command.ts)、[`apps/desktop-agent-python/src/desktop_agent/protocol.py`](apps/desktop-agent-python/src/desktop_agent/protocol.py)。

## 1. 最终目标（用户陈述）

用一台"代理人电脑"安装三类软件：聊天工具、购物工具（浏览器 + 购物网站）、AI 提问平台。用户用另一台电脑/手机向聊天工具发出购物指令，代理人电脑收到后，**让 AI 去模拟人的操作**在购物网站查询、点击、复制粘贴，根据查询结果把最优结果返回用户。

## 2. 一个关键歧义：AI 在系统里到底扮演什么角色

目标中"让 AI 模拟人的操作"存在两种完全不同的解读，而当前架构对应的是其中一种：

- **（操作员视角）** AI 是一个会看屏幕、自主决定"点哪里 / 复制什么"的智能体（即 LLM computer-use agent）。
- **（被操作对象视角）** AI 只是"被驱动的页面之一"，真正操作 GUI 的是代理程序；AI 问答网页与购物网站是并列的两个"被操作目标"。

经源码核查：整个仓库**没有任何 LLM 客户端库或 agent 决策循环**（`openai` / `anthropic` / `langchain` / `ai-sdk` 等均为 0 命中）。AI 在系统里只是"被提问并取回文本的那个网页"。因此需求文档与现有代码采用的是**被操作对象视角**。

## 3. 目标与当前架构对照

| 目标期望 | 当前架构实际 | 匹配度 |
|---|---|---|
| 远程发购物指令 | `ChatMessageReceived` + 微信适配器 + 受信任联系人白名单（FR-01） | ✅ 已具备 |
| 代理人操作购物网站 | `ProductSearchWorkflow` 为**硬编码 8 步**固定流程 | ⚠️ 程序化，非 AI 自主 |
| AI 自主查询 / 点击 / 复制粘贴 | 动作基元已定义（`DesktopCommand` 含 `MOUSE_CLICK` / `CLIPBOARD_SET_TEXT` / `INPUT_KEY_CHORD` 等），但"由谁决定何时点、点哪里"是硬编码的；执行器仍为占位 `PlaceholderDesktopActionExecutor` | ❌ 缺 AI 决策层 |
| 返回最优结果 | 排序使用可解释规则 `rankProducts`，非 AI 判断 | ⚠️ 规则驱动 |
| 自然语言指令 | 指令解析用正则（`product-search-command.ts`），非 LLM 理解 | ⚠️ 规则解析 |

## 4. 两个具体缺口的核对

1. **"如何让 AI 在购物网站自主查询"** —— 缺口属实。当前没有"感知屏幕 → 推理 → 操作"的循环，购物查询是确定性工作流 + 程序化 adapter（传统 RPA 思路）。
2. **"点击 / 复制粘贴如何与 AI 结合"** —— 缺口属实。动作基元已作为协议层备好（等于给 AI 预留了"动作空间"），但**缺一个"用 AI 编排这些动作"的层**；当前编排者是写死的工作流。

附带相关缺口：自然语言理解、最优结果判断当前均为规则，而非 AI。

## 5. 结论：是否偏离

取决于"AI 模拟人操作"的准确含义——这是必须在继续开发前澄清的需求张力点。

### 方案 A（未偏离）：用自动化代替人手去操作 GUI

- **含义**：系统不需要一个会思考的 AI 来"开车"，而是把"购物操作流程"提前写死成确定的程序步骤，由程序按序操控微信、浏览器、购物网站。AI 网页只是"被打开询问的知识源"之一（如同人打开 ChatGPT 提问），程序代替人去打开它、输入问题、读取答案。整体是一个**有明确流程的自动化机器人（RPA）**，而不是会自己看屏幕决策的 AI 智能体。
- **如何确定"点哪里"**：不靠 AI 判断，靠**预先写好的定位规则 / 选择器**（FR-04 要求的 UIA / DOM / 坐标三类定位），与工作流步骤分离、放在 adapter 中：
  - UIA（Windows UI Automation）：在控件树里按 `automationId` / `name` / `controlType` 定位按钮、输入框。
  - DOM（浏览器）：按网页元素属性 / 选择器定位搜索框、商品卡片。
  - 坐标：最后兜底，按固定像素点。
  - UI 变化时只升级 adapter 版本（`adapterVersion`，FR-10），不动工作流。
- **如何"定向查询"**：
  - 指令解析：用正则从聊天文本提取结构化参数（如 `BUDGET_PATTERNS` 提预算、`COUNT_PATTERN` 提数量、`PREFERENCE_PATTERN` 提偏好、`normalizeQuery` 清洗关键词），把口语变成 `query / maxPrice / candidateCount / preferences`。
  - 定向执行：工作流拿参数调 adapter——先 `open`（仅允许白名单域名 `ALLOWED_SHOPPING_DOMAINS`）、再 `search`（填词 + 点搜索）、再 `extract`（抓商品卡片）、再 `rankProducts`（按预算过滤 + 偏好加权排序，取前 N 款）。
- **特点**：可靠、可预测、可审计；但对 UI 变化脆弱、无法处理未预见过的情况；"理解"是浅层规则而非真语义。

### 方案 B（偏离）：用 LLM agent 自主看着屏幕操作购物网站

- 需把核心从确定性工作流改为"observation → reasoning → action"循环，把 `DesktopCommand` 当作 AI 可调用工具、把截图 / 可访问性树当作 AI 的 observation。
- 当前**缺决策层**：`ProductSearchWorkflow` 是硬编码流程，未引入 LLM。

## 6. 若转向方案 B 需补充的（现有地基不浪费）

- 加 **observation 层**：把 `TAKE_SCREENSHOT` + UIA 可访问性树作为 AI 的"眼睛"。
- 加 **决策循环**：LLM 把"当前屏幕状态"映射到"下一个 `DesktopCommand`"，循环至任务完成。
- 改 **执行层**：从硬编码工作流退化为"AI 调用工具的编排"，`ProductSearchWorkflow` 之类变为可选的"有把握时的快捷路径"。
- **保留**：安全白名单、紧急停止、状态机、截图留证、脱敏日志——对 AI 操作员反而更重要（AI 乱点比人乱点更危险）。

## 7. 下一步建议

将设计文档中"AI 角色"重新明确为方案 A 或方案 B，并以书面形式与导师确认。二者技术路线、工作量、风险差别很大，方向定错则后续返工成本最高。
