# 整理并提交微信 Spike 相关改动

## 元信息

- 日期：2026-11-17
- 状态：已完成（本地提交与 GitHub 推送均成功）
- 环境：Windows 11；Git 2.53.0.windows.2；Clash 本地端口 7897
- 分支：`feature/pywinauto1` → `origin/feature/pywinauto1`

## 目标

- 将微信收发 Spike、发送路径修复、进程名默认值调整、文档与 changelog 整理为一个
  本地提交，并推送到 GitHub。

## 上下文与证据

- 工作区改动：5 个既有源码文件、4 个测试文件、`pyproject.toml`、`package.json`、
  `README.md`、`docs/07`、`docs/08`、`docs/09`，以及新增的 `wechat_spike.py`、
  `test_wechat_spike.py` 和 10 个 changelog 文件。
- 不应提交：`pywinauto_test/`（个人实验与 `.venv`）、仓库根目录的 docx/pdf 原始材料。
- 远端：`origin` 为 `github.com/huuard/desktop-operator-simulator.git`。
- 首次推送失败：`Failed to connect to github.com port 443`。
- 连通性排查：
  - 校园 DNS 将 `github.com` 解析为 `20.6.7.17`，该地址 443 不可达；
  - 本地 Clash 已监听 `127.0.0.1:7897`，经代理访问 Google/Baidu 正常；
  - 经代理访问 GitHub 仍在 TLS 握手失败；切换到全局模式后结果相同；
  - `curl --connect-to github.com:443:140.82.112.3:443` 经代理返回 **200**；
  - 直连真实 IP `140.82.112.3` 也返回 **200**。
- 结论：不是代理或 TLS 问题，而是 **`github.com` 的域名解析被污染**；代理侧同样使用
  了错误解析结果。

## 分析与决策

- 按守卫规则只暂存明确路径，不使用 `git add -A`，避免把实验目录和原始材料带入提交。
- 提交前检查暂存内容不含密钥、账号或令牌（结果：无匹配）。
- 推送改用 Git 2.53 支持的 `http.curloptResolve`，把 `github.com:443` 固定解析到
  真实可用 IP `140.82.112.3`，绕过被污染的 DNS，不改 hosts、不改 Clash 配置。
- 该配置只写入本仓库的 `.git/config`（`--local`），不影响其它仓库；IP 变更时需更新。

## 操作记录

1. 检查远端、分支跟踪与工作区状态。
   - 结果：成功。分支与远端同步点为 `da30dcb`。
2. 检查 GitHub 连通性、DNS、代理端口与系统代理。
   - 结果：代理可用，GitHub 域名解析不可用。
3. 按显式路径暂存并审查暂存差异、扫描密钥。
   - 结果：成功。26 个文件，未发现敏感值。
4. 创建本地提交 `54494f5`。
   - 结果：成功。26 files changed，+2420/−36。
5. 使用 `git -c http.curloptResolve=github.com:443:140.82.112.3 fetch origin`。
   - 结果：成功，远端无新提交（ahead 1 / behind 0）。
6. 使用同一解析配置推送。
   - 结果：成功。`da30dcb..54494f5 feature/pywinauto1 -> feature/pywinauto1`。
7. 将解析配置写入仓库本地配置并验证。
   - 结果：成功。`git ls-remote origin` 无需额外参数即可访问。

## 文件变更

- 提交 `54494f5` 包含：
  - 新增：`apps/desktop-agent-python/src/desktop_agent/wechat_spike.py`、
    `apps/desktop-agent-python/tests/test_wechat_spike.py`；
  - 修改：`windows_backend.py`（发送焦点/粘贴校验）、`config.py`/`uia_inspection.py`/
    `wechat_source.py`/`windows_executor.py`（默认 `Weixin.exe`）、`pyproject.toml` 与
    `package.json`（入口与脚本）、`README.md`、`docs/07`、`docs/08`、`docs/09`；
  - 新增 changelog：方向简报、导师材料答复、下一步建议、Spike 工具、进程名默认值、
    运行步骤、测试号风险、发送焦点修复、M0 通过记录、本记录。
- 本记录在推送后更新为“推送成功”，将作为后续提交记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 暂存内容密钥扫描 | PASSED | 未发现 `sk-`、`AKID`、`SecretKey` 值或密码字面量。 |
| `git diff --cached --stat` | PASSED | 26 个文件，范围与预期一致。 |
| `git commit` | PASSED | 本地提交 `54494f5`。 |
| `git fetch origin`（带 curloptResolve） | PASSED | 远端无新提交。 |
| `git push origin feature/pywinauto1`（带 curloptResolve） | PASSED | `da30dcb..54494f5`。 |
| `git ls-remote origin`（仓库本地配置） | PASSED | 无需额外参数即可访问。 |
| `npm run check:python` | NOT_EXECUTED | 本次仅提交与推送，无代码改动；上一任务为 237 passed。 |

## 问题与处理

- 现象：直连与经代理都无法访问 GitHub；代理访问其它站点正常。
- 根因：`github.com` 被解析到不可达地址 `20.6.7.17`，代理同样受影响。
- 处理：用 `http.curloptResolve` 固定到真实 IP `140.82.112.3`，仅对本仓库生效。
- 结果：fetch / push / ls-remote 全部成功。

## 风险与限制

- 固定 IP 是临时绕行：GitHub 变更 IP 后需要更新
  `git config --local http.curloptResolve <新IP>`，或改用可用的 DNS/代理配置。
- 未提交 `pywinauto_test/` 和根目录 docx/pdf；它们仍是未跟踪文件。
- `main` 分支本地领先 `origin/main` 48 个提交，本次未处理。

## 最终结果

- 本地提交已推送到 `origin/feature/pywinauto1`，分支与远端同步。
- 仓库本地已保存 DNS 绕行配置，后续 git 操作可直接使用。
- 未被跟踪的实验目录与原始材料保持原样。
