# 切换 GitHub HTTPS 凭据为 owner 账号并完成推送

## 元信息

- 日期：2026-09-30
- 状态：已完成
- 环境：Windows 11；Git 2.43.0.windows.1；Git Credential Manager 2.4.1
  （`credential.helper=manager`）；远端为 HTTPS

## 目标

- 将本机保存的 GitHub 凭据从无写权限的账号切换为仓库 owner 账号，解除推送阻塞。
- 完成 `main` 与 `archive/main-baseline-20260930` 两个引用的推送。
- 不获取、不记录、不在对话中传递任何口令、令牌或密钥。

## 上下文与证据

- 首次推送失败：`remote: Permission to wanglijie050108/desktop-operator-simulator.git
  denied to wanglijie314.`，HTTP 403。
- `git credential-manager github list` 仅列出 `wanglijie314`；Windows 凭据管理器中
  `LegacyGeneric:target=git:https://github.com` 的 User 同为 `wanglijie314`。
- 只读访问正常（`git ls-remote --heads origin` 可列出全部远端分支），说明网络与地址
  无误，限制仅在写权限。
- 已排除的替代路径：本机唯一 SSH 私钥的指纹注释为 `Gitee SSH Key`，且
  `ssh -T git@github.com` 返回 `banner exchange: Connection refused`（该网络下
  github.com:22 不可达）；`GH_TOKEN`、`GITHUB_TOKEN`、`GIT_ASKPASS` 均未设置。
- 推送结果证据：`8227723..96f2f20 main -> main`；
  `* [new branch] archive/main-baseline-20260930 -> archive/main-baseline-20260930`；
  `git ls-remote` 复核远端 `main` = `96f2f20`、归档分支 = `8227723`。
- 附加发现：GCM 在推送过程中输出
  `SECURITY WARNING - TLS certificate verification has been disabled!`；
  经查该设置来自全局 `~/.gitconfig` 的 `http.sslverify=false`。

## 分析与决策

- 凭据认证必须由账号持有人完成，因此只执行可自动化的部分：登出旧账号、清除缓存
  凭据、发起推送以触发授权流程；实际授权由用户在浏览器中完成，不索取也不代填凭据。
- 选择 GCM 官方登出 + 浏览器 OAuth，而不是让用户在对话中粘贴 Personal Access
  Token：前者不产生明文密钥流转，避免把密钥写入聊天记录或仓库。
- SSH 方案在本次网络与现有密钥条件下不可行，直接排除，不做无意义的反复尝试。
- `http.sslverify=false` 属全局环境配置，未获用户指示前不擅自修改：它可能是为兼容
  特定网络或代理而设置，贸然开启校验可能导致用户其它仓库无法访问。本次仅记录风险
  并给出验证建议。

## 操作记录

1. 核查 GCM 版本、凭据 helper、已存账号、Windows 凭据条目与可用替代认证方式。
   - 结果：成功；确认唯一账号为 `wanglijie314`，SSH 路径不可用。
2. `git credential-manager github logout wanglijie314` 登出旧账号并复核。
   - 结果：成功；GCM 账号列表与 Windows 凭据管理器中该条目均已消失。
3. 在 `GCM_INTERACTIVE=always` 下发起 `git push origin main` 触发授权。
   - 结果：成功；GCM 唤起浏览器授权页并等待回调，用户以 owner 账号完成授权后推送
     成功。
4. 推送归档分支并复核远端引用。
   - 结果：成功；远端 `main` 与 `archive/main-baseline-20260930` 均存在且指向预期提交。
5. 核对推送过程中的 TLS 警告来源。
   - 结果：成功；定位为全局 `http.sslverify=false`，本次不修改。
6. 回填 `changelog/2026-09-30-archive-main-and-merge-pywinauto.md` 中此前记为
   BLOCKED 的推送项与阻塞风险。
   - 结果：成功；该记录的推送结论已更新为 PASSED。

## 文件变更

- `changelog/2026-09-30-switch-github-credentials-and-push.md`：新增本记录。
- `changelog/2026-09-30-archive-main-and-merge-pywinauto.md`：把首次推送的 BLOCKED
  结论更新为已解除，并补充重试后的 PASSED 证据。
- 未修改任何产品代码、测试、配置或依赖。
- 环境侧变更：Windows 凭据管理器中 GitHub 凭据由 `wanglijie314` 变为 owner 账号
  （凭据内容不入库、不记录）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git credential-manager github list` | PASSED | 变更前仅 `wanglijie314`；登出后为空。 |
| `git credential-manager github logout wanglijie314` | PASSED | 账号与缓存凭据均被移除。 |
| `cmdkey /list`（仅核对表项与用户名） | PASSED | `git:https://github.com` 条目在登出后消失。 |
| `ssh -T git@github.com` | FAILED | 连接被拒；确认 SSH 路径不可用（本机密钥属 Gitee）。 |
| `git push origin main` | PASSED | `8227723..96f2f20  main -> main`。 |
| `git push origin archive/main-baseline-20260930` | PASSED | 新建远端分支，指向 `8227723`。 |
| `git ls-remote --heads origin` | PASSED | 远端 `main` = `96f2f20`，归档分支 = `8227723`。 |
| `git status --short --branch` | PASSED | `main...origin/main`，无领先/落后，工作树干净。 |
| GitHub Actions CI 结果 | PASSED（部分） | Node ✓、Python agent ✓、.NET ✗。Python job 在 `windows-latest` 通过，实证了同日的质量门修复；`.NET` 失败为独立缺陷，另见 `changelog/2026-09-30-diagnose-dotnet-ci-failure.md`。 |
| 真实微信/桌面验证 | NOT_EXECUTED | 与本次环境变更无关。 |

## 问题与处理

- 现象：`git push` 已成功输出 `main -> main`，但整条命令返回退出码 1。
- 根因：GCM 的 TLS 警告写入 stderr，PowerShell 将其包装为 `NativeCommandError`，
  因此外层退出码非 0；git 自身的推送结果是成功的。
- 处理：以 git 输出中的 `old..new -> ref` 结果行和 `git ls-remote` 复核为准，不以
  PowerShell 退出码判定成败。
- 结果：确认推送成功，避免把成功误判为失败。
- 现象：GCM 报告 TLS 证书校验已被禁用。
- 根因：全局 `~/.gitconfig` 设置了 `http.sslverify=false`。
- 处理：记录并向用户披露风险，未擅自修改全局配置。
- 结果：待用户决定；建议在确认网络无 TLS 拦截后移除该设置。

## 风险与限制

- **`http.sslverify=false` 是真实安全风险**：它使 Git 的 HTTPS 连接不再校验证书，
  推送、拉取与凭据交换均可能被中间人拦截。若该设置是为绕过代理或自签证书而加，
  移除前需先验证网络环境，否则可能影响其它仓库的访问。
- CI 结论：推送已触发构建，Node 与 Python agent 两个 job 通过；`.NET quality checks`
  失败，原因与本记录无关，已在 `changelog/2026-09-30-diagnose-dotnet-ci-failure.md` 定位。
- 凭据现已缓存于 Windows 凭据管理器，后续推送无需重复授权；同一台机器上的其它
  账号操作需注意此缓存归属。

## 最终结果

- 已完成：本机 GitHub HTTPS 凭据已切换为仓库 owner 账号，`main`（含合并提交与质量门
  修复）与归档分支均已推送到远端，推送阻塞解除。
- 未完成：`http.sslverify=false` 未处理（待用户决定）；`.NET quality checks` 仍失败
  （独立缺陷，已定位待修）。
- 下一步建议：在网页端确认 CI 三个 job 的结论；如条件允许，移除全局
  `http.sslverify=false` 并验证推送仍正常；随后执行只读微信 UIA 取证推进 M0。
