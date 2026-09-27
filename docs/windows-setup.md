# Windows 安装与实际运行

目标环境为 Windows 11 x64、PowerShell 7、Node.js 24 LTS、Git。开发依赖及 runtime SDK 固定版本见 package-lock.json。正常运行不需要 WSL、Docker 或 bash。浏览器适配依赖宿主已授权的 Playwright CLI；适配目标版本为 0.1.7，测试使用锁文件指定的 Playwright 和现有 Edge。完整测试还需要 Python 3。

## 本地安装

在源码根目录的 PowerShell 7 运行：

```powershell
npm ci --ignore-scripts
npm run build
pwsh -File .\scripts\relay.ps1 init
pwsh -File .\scripts\install-skill.ps1
pwsh -File .\scripts\relay.ps1 doctor
npm test
```

预期：build 无错误；init 创建私有 YAML 和 ACL；安装到 `$HOME\.agents\skills\mutou-relay`；doctor 分开显示环境、配置、凭证和网页状态。首次配置前 `CREDENTIAL_MISSING`、Tunnel ID `MISSING`、网页 `NOT_CHECKED` 是诚实状态，不是安装完成真实联调。用户级发现位置依据 [Codex Skills](https://developers.openai.com/codex/build-skills)。当前聊天的技能目录快照不保证立即刷新；新聊天输入 `$mutou-relay` 验证宿主发现。

官方 Tunnel 可用以下脚本安装到私有目录（已经安装则不要覆盖）：

```powershell
pwsh -File .\scripts\install-tunnel.ps1
```

脚本锁定官方 0.0.15 Windows amd64 包与 SHA-256，保留 LICENSE/NOTICE/SPDX。没有执行签名验证。升级需更新锁定值并重测，不在启动时自动升级。

## 账号步骤：必须由用户确认

1. 打开 [Platform Tunnel 设置](https://platform.openai.com/settings/organization/tunnels)，创建或选择 Tunnel。管理需要 Tunnels Read + Manage；运行/选择需要 Read + Use。
2. 核对 Tunnel 与目标 Platform organization / ChatGPT workspace 关联。两个权限系统分开，不能根据订阅名称推断权限。
3. 在 [Runtime API Keys](https://platform.openai.com/settings/organization/api-keys) 创建所需运行权限 Key。不要使用长期管理员 Key，不要将 Key 发到聊天。
4. 在你自己的本地终端执行安全输入，程序使用 `Read-Host -AsSecureString` 与当前用户 DPAPI：

```powershell
pwsh -File .\scripts\relay.ps1 credentials set
pwsh -File .\scripts\relay.ps1 connection configure --tunnel-id '<实际 Tunnel ID>' --confirm
```

5. 按 [ChatGPT Developer Mode 文档](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) 核对工作区创建自定义 App 权限。当前官方说明为 ChatGPT Plugins 中创建开发者 App，连接类型选 Tunnel；具体可见菜单以账号界面为准。App 名称 `Mutou Relay`。
6. 首次只暴露无秘密 fixture。用户确认具体 fixture 范围后，由 Codex 选择项目、创建任务并获取限时 capability，再运行 start。App 工具扫描应只看到七个 `relay_*` 工具。schema 更新后停止旧实例、更新构建并在 App 的工具/连接设置刷新或重新连接，重新检查七个工具，不能假定缓存已更新。

官方依据：[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。没有平台权限或账号连接条件时停在 E2E_NOT_VALIDATED，不回退公网入口或 API。

## 项目与任务

源码的 tests/fixtures/node、tests/fixtures/python 是故意含错误的小样例。将所选样例复制到单独的临时目录作为项目；证据仍在 `%LOCALAPPDATA%\MutouRelay`，不要放入样例或源码仓库。Codex 创建带 task goal、scope、acceptance_ids 的任务文件：

```powershell
pwsh -File .\scripts\relay.ps1 workspace select --path '<明确项目绝对路径>'
pwsh -File .\scripts\relay.ps1 task create --file '<本地任务 JSON>'
pwsh -File .\scripts\relay.ps1 task grant --confirm-exposure
pwsh -File .\scripts\relay.ps1 start --confirm-exposure
```

grant 的 capability 是短期读取授权，不能贴到日志、截图或最终报告；只交给已确认任务。start 在前台运行，Ctrl+C 停止。Codex 需要并行终端时保留该前台会话，不安装服务或自启。配置好一个实例不会自动在网页启用 App；必须实际验证网页调用。

浏览器由 Codex 按技能 reference 现场读取 DOM 并填写私有选择器配置，用户不需要写适配器代码。需要登录/验证码时用户自己操作。第一次网页暴露必须另行确认，不将开发本工具的授权推断成暴露真实项目。

`task prepare`、`browser send_message`、`task accept`、`task execute`、`check` 的具体 schema 和顺序见已安装 Skill。build 必须先完成网页研究并保留来源，再创建项目任务进入 PLAN/实施/REVIEW；review/plan 不执行检查写入；research 不启动项目 Runtime。

## 停止、升级、卸载

```powershell
pwsh -File .\scripts\relay.ps1 stop
pwsh -File .\scripts\relay.ps1 status
pwsh -File .\scripts\install-skill.ps1 -Update
pwsh -File .\scripts\uninstall-skill.ps1
```

升级只覆盖校验为本产品旧版本且未被用户修改的文件。未知同名技能、增加文件或已编辑内容均拒绝覆盖/卸载。卸载只删除该技能，保留源码、证据和加密凭证；如需撤销平台 Key/App，用户在 Platform 与 ChatGPT 设置执行，`credentials remove` 只移除本机加密副本。

`cleanup` 预览到期任务，`cleanup --apply` 删除可识别的到期已结束任务；当前任务保留。它不清理用户项目。
