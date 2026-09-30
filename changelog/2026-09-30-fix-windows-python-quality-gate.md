# 修复 Python 质量门在 Windows 上的平台可移植性缺陷

## 元信息

- 日期：2026-09-30
- 状态：已完成
- 环境：Windows 11（NT 10.0.26200）；uv 0.11.14 + CPython 3.11.6；Ruff 0.16.9、
  mypy 2.3.1、pytest 9.1.1（均由 `uv.lock` 锁定）；Node.js 24.15.0

## 目标

- 使 `npm run check:python` 在 Windows 主机上通过，消除随迁移合并进入 `main` 的
  3 项缺陷（2 项 mypy、2 项 pytest 失败，其中 mypy 失败会中断整条质量门）。
- 不削弱 mypy `strict`、不删除或弱化任何断言、不改变产品运行行为。
- 保持 macOS/Linux 开发主机上的类型检查结论不变。
- 同步受影响的状态文档与工作记录后方可交付。

## 上下文与证据

- 变更前基线（合并后的 `main`，同一工作树）：
  - `npm run check:python` → `FAILED`；Ruff format/lint 通过，mypy 报
    `windows_backend.py:152` 与 `:163` 的 `Unused "type: ignore" comment [unused-ignore]`。
  - `npm run test:python` → 107 通过、2 失败、2 跳过，覆盖率 91.45%；
    `test_config.py::test_enables_windows_automation_with_explicit_process_allowlist` 与
    `test_uia_inspection.py::test_loads_and_validates_inspection_options` 断言
    `str(Path) == "C:/automation-data/artifacts"` 失败。
- CI 证据：`.github/workflows/ci.yml` 的 `python` job 运行于 `windows-latest`，命令为
  `ruff format --check .`、`ruff check .`、`mypy src tests`、`pytest`。因此该缺陷会被
  推送 `main` 后的 CI 直接判红。
- 取证范围：全仓 Python 源码与测试中 `# type: ignore` 仅 2 处，均位于
  `windows_backend.py`；`str(Path)` 形式的路径断言仅 2 处。
- `config.py` 第 131 行以 `Path(artifact_directory_text)` 构造目标值，证明断言改为
  比较 `Path` 对象语义等价。

## 分析与决策

- **ignore 处理方式**选择 mypy 按模块 override，而非改用 `getattr(ctypes, "windll")`
  或删除 ignore：
  - `getattr` 方案会把 `user32` 弱化为 `Any`，Windows 上对 `GetSystemMetrics`、
    `GetDpiForSystem`、`keybd_event` 的静态检查会一并丢失，属真实的能力退化。
  - 删除 ignore 会破坏 macOS/Linux 上的类型检查（该属性在非 Windows 存根中不存在）。
  - override 仅关闭该 Windows 专属模块的 `warn_unused_ignores`，既保留 Windows 上的
    类型化访问，也保留非 Windows 平台所需的 ignore，且不触碰全局 `strict`。
- 测试断言改为比较 `Path` 对象：同一平台内 `PurePath` 比较会对分隔符归一，断言意图
  （环境变量被解析为指定路径）完全不变，仅在 Windows 与 POSIX 上都成立。
- 明确不做的事：不放宽 `strict`、不改 `coverage.omit`、不调整 CI 运行平台、不修改
  `windows_executor.py` 等产品逻辑。

## 操作记录

1. 复核 CI 的 `python` job 命令、全仓 ignore 与路径断言分布。
   - 结果：成功；确认缺陷范围精确为 2 处 ignore + 2 处断言。
2. 在 `pyproject.toml` 增加 `desktop_agent.windows_backend` 的 mypy override。
   - 结果：成功。
3. 修改两处测试断言为比较 `Path` 对象，并为 `test_config.py` 增加 `pathlib.Path` 导入。
   - 结果：成功。
4. 分层验证：先跑两条定向用例，再跑 mypy（win32 与 linux 两种平台），最后跑完整
   `check:python`。
   - 结果：成功；全部通过。
5. 同步 `docs/08-development-status.md` 的日期与 Python 验证口径。
   - 结果：成功；区分了 Windows 实测与 macOS 既有结论。

## 文件变更

- `apps/desktop-agent-python/pyproject.toml`：新增 Windows 专属模块的 mypy override。
- `apps/desktop-agent-python/tests/test_config.py`：导入 `Path`，断言改为比较 `Path`。
- `apps/desktop-agent-python/tests/test_uia_inspection.py`：断言改为比较 `Path`。
- `docs/08-development-status.md`：更新日期，补充 Windows 实测结论与两处缺陷说明，
  并把跨进程集成验证明确标注为 macOS 已完成、Windows 未执行。
- `changelog/2026-09-30-fix-windows-python-quality-gate.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 变更前 `npm run check:python` | FAILED | 基线：mypy 2 项 `unused-ignore`，质量门中断。 |
| 变更前 `npm run test:python` | FAILED | 基线：107 通过、2 失败、2 跳过。 |
| 定向：两条此前失败用例 | PASSED | `2 passed`；单独复跑退出码为 0。 |
| `uv run ... mypy src tests`（win32） | PASSED | `Success: no issues found in 25 source files`。 |
| `uv run ... mypy --platform linux src tests` | PASSED | 同样 0 问题，确认非 Windows 平台所需的 ignore 仍被使用。 |
| `uv run ... ruff format --check .` | PASSED | `26 files already formatted`。 |
| `uv run ... ruff check .` | PASSED | `All checks passed!`。 |
| `npm run check:python` | PASSED | 退出码 0；109 通过、2 跳过，覆盖率 91.82%（门槛 90%）。 |
| `npm run check:node` | NOT_EXECUTED | 未安装 Node 依赖（`node_modules` 不存在），且与本次改动无关。 |
| `npm run check:dotnet` | NOT_EXECUTED | 本机仅有 .NET 8 SDK，低于 `global.json` 要求的 10.0.401。 |
| `npm run test:integration:m1:python` | NOT_EXECUTED | 需要先安装 Node 依赖并构建控制服务；与本次改动无因果关系。 |
| 真实 Windows 微信/桌面动作验证 | NOT_EXECUTED | 本次仅修复跨平台可移植性，未接入真实 Adapter。 |

## 问题与处理

- 现象：定向测试首次经管道输出时整体返回退出码 1，但 pytest 自身打印 `2 passed`。
- 根因：PowerShell 管道包装导致退出码被上游 `uv` 的告警输出干扰，非测试失败。
- 处理：去掉管道直接复跑并显式打印 `$LASTEXITCODE`。
- 结果：退出码为 0，确认测试通过，未把管道假象当作失败或通过。

## 风险与限制

- 本机无 macOS/Linux 主机，非 Windows 平台结论由 `mypy --platform linux` 近似验证，
  并非真实在该平台执行；“删除 ignore 会破坏 macOS”的判断属推理。
- `coverage.omit` 仍排除 `windows_backend.py`，91.82% 只覆盖跨平台逻辑，真实
  pywinauto 代码路径仍无覆盖率证据。
- Windows 上跳过的 2 项是“仅非 Windows 适用”的平台守卫用例，属预期跳过，不代表
  未验证的遗留项。
- mypy override 使该模块的 `unused-ignore` 不再报告；若将来在该模块新增真正多余的
  ignore，不会被发现。该取舍已在 `pyproject.toml` 注释中说明。
- 整仓 `npm run check` 仍不可达绿：`check:dotnet` 需要 .NET 10，`check:node` 需要
  安装依赖。

## 最终结果

- 已完成：3 项 Windows 平台缺陷已修复，`npm run check:python` 在 Windows 主机上
  实测通过（退出码 0，覆盖率 91.82%），且未放宽 strict、未弱化断言、未改变产品行为。
- 未完成：`check:node`、`check:dotnet`、跨进程 Python 集成测试与全部真实环境验证
  均未执行。
- 下一步建议：安装 .NET 10 SDK 与 Node 依赖后运行整仓 `npm run check`；随后按既定
  计划执行只读微信 UIA 取证（需用户授权）以推进 M0。
