# 微信 Spike B 实机运行步骤说明（只读交付）

## 元信息

- 日期：2026-11-17
- 状态：已完成（说明性交付；未执行任何微信实机操作）
- 环境：Windows 11；uv 位于 `D:\python3.12\Scripts`（不在系统 PATH）
- 分支：`feature/pywinauto1`

## 目标

- 向用户说明在本机完成 M0 Spike B 的具体操作顺序：环境准备 → 只读取证 →
  定位标题控件 → 单轮试跑 → 20 轮正式运行 → 解读报告与错误码。

## 上下文与证据

- 工具已实现：`wechat_spike.py`、`npm run test:spike:m0:wechat-send`；
  取证为 `npm run test:spike:m0:wechat-inspect`。
- 默认进程名为 `Weixin.exe`（2026-11-16 变更），3.x 可用
  `WECHAT_PROCESS_NAME=WeChat.exe` 覆盖。
- 默认 artifact 目录为 `data/artifacts/desktop-agent`（相对 `uv run --directory`
  的工作目录），报告写入其下 `reports/`。
- 本机 `uv` 不在系统 PATH；`D:\python3.12\Scripts` 需在会话内加入 PATH，否则
  npm 脚本会报 `uv: command not found`。
- 取证报告对控件 Name 与窗口标题做临时 HMAC，只保留长度；`AutomationId` /
  `ClassName` 在安全字符集内保留。因此**按明文名称在报告中搜索不可行**。

## 分析与决策

- 推荐用 Inspect.exe / Accessibility Insights 直接读取标题控件的
  `AutomationId` / `ClassName` / `Name`，再与取证报告交叉核对
  （`name_length` 等于会话名长度、`visible=true` 的节点）。
- 先跑 1 轮确认消息真实出现，再跑 20 轮，避免一次产生大量误发。
- 通过标准按 M0：成功率 ≥90%（20 轮中 ≥18 轮）。
- 对话标题控件若既无 AutomationId 且 ClassName 与侧边栏重复，现有 class + 序号
  定位可能不可靠；届时需要按取证结果扩展定位策略，而不是放宽校验。

## 操作记录

1. 核对入口点、默认 artifact 路径、环境变量名与错误码。
   - 结果：成功。`desktop-agent-wechat-spike.exe` 已安装；PATH 不含
     `D:\python3.12\Scripts`。
2. 编写步骤说明并交付用户。
   - 结果：成功。

## 文件变更

- `changelog/2026-11-17-wechat-spike-runbook.md`：本记录（新建）。
- 产品代码、文档、契约：无改动。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `grep`/`ls` 核对入口点与 PATH | PASSED | 入口点存在；uv 目录不在 PATH。 |
| `npm run check:python` | NOT_EXECUTED | 本任务无代码改动。 |
| 微信实机步骤 | NOT_EXECUTED | 说明性交付，未操作微信。 |

## 风险与限制

- 标题控件是否能稳定定位仍取决于实机取证（R-01）；步骤说明不构成可行性证明。
- ClassName + 序号策略对侧边栏同类控件敏感，可能需要改用 AutomationId 或扩展工具。
- 收发 Spike 会真实发送消息，只能在专用测试会话使用。

## 最终结果

- 已给出可直接照做的步骤、错误码对照与通过标准。
- 未改动任何代码或文档，未执行微信实机操作。
