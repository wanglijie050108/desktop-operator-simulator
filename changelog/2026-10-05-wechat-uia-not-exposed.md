# 微信 Spike B 取证：4.1.15.13 为 Qt 无障碍未激活的“空壳”状态（结论修正）

## 元信息

- 日期：2026-10-05
- 状态：已完成（取证 + 外部资料核对；结论已修正；替代方案待用户决定）
- 环境：目标机 Windows 11 build 26200、1920×1080、缩放 100%；微信 `D:\Weixin\Weixin.exe`
  4.1.15.13；venv Python 3.11.6、pywinauto 0.6.9

## 目标

- 分析微信只读取证报告并判定其正确性；确认微信路径是否可行。

## 取证事实

- 操作者执行 `WECHAT_PROCESS_NAME=Weixin.exe npm run test:spike:m0:wechat-inspect`，输出
  `{"nodeCount":3,"truncated":false,...}`；报告
  `apps/desktop-agent-python/data/artifacts/desktop-agent/reports/wechat-uia-20261005-164751547550.json`。
- **报告正确**：`process_id=91512`、`window_handle=1904844`、`window_title_length=2`，与
  `Get-Process` 实测（pid 91512、句柄 1904844、标题“微信”）一致；`truncated=false` 表示遍历
  自然结束，3 个节点即全部。
- 控件树：`Window/Qt51514QWindowIcon`（主窗口，矩形 `512,220 896×648`，属已登录主窗口）→
  `Pane/Qt51514QWindowIcon`（`1399,859 1×1` 占位）+ `Pane/MMUIRenderSubWindow`
  （矩形 `520,220 880×640`，覆盖整个客户区）。无会话列表、消息区、输入框节点。
- 六路只读探测一致：pywinauto UIA（3 节点）、`EnumChildWindows`（恰好 2 个后代窗口）、托管 UIA
  `FindAll(Descendants, TrueCondition)`（Raw View，2 个 Pane）、MSAA 顶层（`accChildCount=2`）、
  MSAA 内容面（`accChildCount=0`）、内容面模式枚举（空集）；`EnumWindows` 显示该进程 7 个顶层
  窗口中仅 1 个可见，无隐藏内容窗口。

## 外部证据核对（关键，修正了原判定）

- 社区项目 wechatauto-replica 的文档明确描述：**“微信 4.1.x 聊天界面使用自绘渲染
  （`MMUIRenderSubWindow*`），冷启动对 UIAutomation 只暴露 `Qt51514QWindowIcon` 空壳”，
  需通过“热激活 Qt accessibility gate（写 Weixin.dll 内读屏标志位，从 `qt.accessibility.core`
  引用扫描 RVA）”才物化 `mmui::*` UIA 树**；其消息读取仍走**本地数据库解密**。
  另注明兼容范围为“微信 **4.1.12+（已在 4.1.15.13 验证**）”——与本机版本完全相同。
- 上游 wxauto v4.0 文档写明“基于 Windows UI Automation”，支持微信 **4.1**；其 3.9→4.x 适配说明
  指出 4.x 改为**实时渲染**（只有屏幕可见范围内的消息才加载 UI 对象，滚出即销毁、滚回重建），
  并为此引入回调式取消息、取完关闭窗口、自动拉高窗口等变通。
- 因此：**本次测到的 3 节点不是“该版本不可自动化”，而是“Qt 无障碍门未激活”的冷启动空壳状态**，
  与社区文档描述的冷启动表现逐字吻合。

## 结论修正

- 原判定（“微信 4.1.15.13 在 UIA/MSAA/Win32 下不可自动化、M0 微信项无法达成”）**过度**，予以更正。
  准确结论是：
  1. 微信 4.1.15.13 的 UIA 树**存在但默认不物化**；纯 UIA 客户端（本项目当前路径）只能看到空壳；
  2. 社区通行做法有两条，且**都不是“语义化 UIA + 不碰其它进程”**：
     - 热激活：向微信进程内存写入 Weixin.dll 内的 Qt accessibility gate 标志位（跨进程写内存）；
     - 读消息：从微信进程内存提取 SQLCipher 密钥后解密本地数据库（跨进程读内存）。
  3. 两条都超出本项目当前安全边界（`SKILL.md` §4 与 `docs/04` DoD 第 3 条“不新增通用脚本执行或
     越权能力”），也违背“语义定位优先、不额外侵入目标进程”的设计取向；且社区文档显示每个微信
     小版本都要重做适配（gate RVA 表、布局常量、搜索入口形态变化），维护成本高。
- 修正后的判断：**微信路径需要重新选型，但原因从“技术不可行”变为“可行手段超出本项目边界且不
  稳定”**。降级到原生暴露 UIA 控件的 3.9.x 仍是保住现有架构与安全边界的最优解。

## 对现有实现的影响

- `wechat_source.py` 的 `{ListItem, Text}` 定位与 `windows_backend.send_chat_text` 依赖的
  `Edit`/`Document` 控件，在**未热激活**的 4.1.15.13 上不存在；若采用热激活路线，则需按
  `mmui::*` 命名重做定位（社区实测类名如 `mmui::MainWindow`、`mmui::XValidatorTextEdit`、
  `chat_input_field`、`search_list`），并在每次微信小版本升级后重新校准。
- 若采用“读本地数据库”路线，则接收侧完全不走 UIA，需新增解密与密钥提取模块，且涉及跨进程读内存，
  与本项目现有 `wechat_ingress` 的 UIA 取向冲突，须先做架构与安全边界决策（ADR）。

## 文件变更

- `docs/08-development-status.md`：“最后更新”改为 2026-10-05；“当前阶段”“当前不可运行能力”
  “当前限制”与 M0 未完成项写入修正后的结论；同时修正第 53–55 行遗留的“鼠标动作…实机证据仍缺失”
  表述（与同文档 19/20 实机证据矛盾）。
- `changelog/2026-10-05-wechat-uia-not-exposed.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npm run test:spike:m0:wechat-inspect`（操作者实机） | PASSED | 工具执行成功，`nodeCount=3`、`truncated=false` |
| 报告与 `Get-Process` 交叉验证 | PASSED | pid、句柄、标题长度一致 |
| `EnumChildWindows` / `EnumWindows` 窗口枚举 | PASSED | 2 个后代窗口；7 个顶层窗口仅 1 可见 |
| 托管 UIA Raw View 独立枚举 | PASSED | 2 个 Pane，与 pywinauto 一致 |
| MSAA（顶层与内容面） | PASSED | `accChildCount` 分别为 2 与 0 |
| 内容面 UIA 支持模式枚举 | PASSED | 空集（无 Text/Scroll/Selection/ValuePattern） |
| 外部资料核对（wxauto / wechatauto-replica 文档） | PASSED | 冷启动空壳 + 热激活机制；4.1.15.13 已被社区验证可自动化 |
| `QT_ACCESSIBILITY=1` 重启后复查 | NOT_EXECUTED | 建议补做：若该环境变量即可物化 UIA 树，则可不写内存 |
| 用第三方 UIA 工具（Inspect.exe/`uiautomation`）对照 | NOT_EXECUTED | 建议补做，用于确认“纯 UIA 客户端无法激活”这一点 |
| 20 轮收发 Spike | NOT_EXECUTED | 前提未定，无法执行 |

## 问题与处理

- 现象：我依据六路探测一致，判定“该版本不可自动化”，并已写入 `docs/08`。
  - 根因：探测本身正确，但**把“当前客户端看到的树”等同于“该版本的可自动化工况”**，遗漏了
    “无障碍门需激活”这一前提；缺乏对社区既有实现的核对。
  - 处理：补充外部资料核对，发现社区文档逐字描述了同一现象（冷启动只暴露
    `Qt51514QWindowIcon` 空壳），据此修正结论并回改 `docs/08`，避免把过度结论留在权威文档里。
  - 结果：结论与证据边界一致——现象成立、原因更正、能力判断从“不可行”改为“可行但越界”。
- 现象：UIA 仅 3 个节点，疑似“读漏”或后端偏差。
  - 处理：用四条独立路径 + Raw View + 窗口枚举交叉验证，确认“当前客户端确实看不到内容节点”。
  - 结果：该部分结论不变且证据充分。

## 风险与限制

- 本次只在微信 **4.1.15.13** 取证；社区文档显示 4.x 各小版本结构差异大，需按版本适配。
- 未做 `QT_ACCESSIBILITY=1` 与第三方 UIA 工具的对照实验，“纯 UIA 客户端一定无法激活”目前依据
  社区文档而非本地实测。
- 热激活/读库两条路线的可行性、稳定性与账号风险均未在本项目验证；跨进程写内存有触发微信风控与
  安全软件拦截的现实风险，社区文档亦记录过一次账号被要求重新登录。
- M0 窗口至 2026-10-07 仅剩 2 天，微信路径需重新选型，时间极紧。

## 最终结果

- 已完成：确认取证输出正确；查明“3 节点空壳”是 Qt 无障碍门未激活的冷启动状态，而非版本不可
  自动化；据此修正原过度结论并回改 `docs/08`；记录社区两条可行路线及其越界性质。
- 未完成：`QT_ACCESSIBILITY=1` 与第三方工具对照实验未做（`NOT_EXECUTED`）；替代方案未定；
  M0 微信项仍为 `[ ]`。
- 下一步：优先做两个对照实验（`QT_ACCESSIBILITY=1` 重启复查、Inspect.exe/`uiautomation` 对照）；
  若纯 UIA 客户端确认无法激活，则在“降级 3.9.x / 放宽安全边界走热激活 / 更改演示通道”三选一，
  并同步 `docs/01`、`docs/04`、`docs/06`（ADR）。
