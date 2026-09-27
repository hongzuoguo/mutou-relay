# Mutou Relay 

让 ChatGPT 官方网页负责研究、规划和审查，让 Codex 在本地完成获授权的实现与检查。这个 Windows 框架包含 Codex Skill、TypeScript Runtime、只读 MCP 和浏览器适配；不调用模型 API。

## 四种协作模式

| 模式 | 用途 |
| --- | --- |
| `research` | 网页研究并提供实际来源，不读取本地项目 |
| `plan` | 只读获授权项目并输出方案 |
| `build`（默认） | 网页研究与来源 → PLAN → Codex 实施与检查 → 网页 REVIEW |
| `review` | 审查已有改动和证据 |

默认使用 `build`（研制）模式。每次先完成网页研究，再规划、实施和审查；研究受阻时明确报告。研究由 Skill 编排，Runtime 验证后续项目协议，单独的 Runtime DONE 不证明研究已完成。

## 专用网页是什么

它是你自己账号中的普通 ChatGPT 会话。Codex 通过宿主 Playwright CLI，在独立浏览器配置目录中打开官方网页，读取实时 DOM，创建或继续你确认的聊天。ChatGPT 负责生成会话地址；本工具记录地址及界面定位器。它不创建账号，也不提供共享账号或模型权限。

项目片段经你授权后，通过自己的 ChatGPT App 与官方 Secure MCP Tunnel 供网页只读访问。登录、验证、平台关联和首次数据暴露需要你确认。默认使用无头浏览器；网站可能要求交互验证。经同意可使用 Windows 独立后台桌面上的标准浏览器，它不是无头模式，不绕过网站验证。

## 安装

需要 Windows 11 x64、PowerShell 7、Node.js 24、Git、Microsoft Edge，以及 Codex 宿主可用的 Playwright CLI。完整回归还使用 Python 3。依赖锁定在 `package-lock.json`。

在克隆后的仓库根目录运行：

```powershell
npm ci --ignore-scripts
npm run build
pwsh -File .\scripts\relay.ps1 init
pwsh -File .\scripts\install-skill.ps1
pwsh -File .\scripts\relay.ps1 doctor
npm test
```

然后按[安装与账号设置](docs/windows-setup.md)配置自己的 Tunnel、Runtime Key 和 ChatGPT App。不是所有账号都具有所需权限；缺少账号条件时会明确报告阻塞。不能仅复制 SKILL.md：安装器会写入本地 Runtime 路径，技能需要完整 Runtime。

新建 Codex 聊天后，可以说：

> 用 $mutou-relay，build 模式，先让网页研究相关资料并提供来源，再规划、实施并让网页审查。首次先使用无秘密样例验证连接。

其他示例：

- `用 $mutou-relay，research 模式，研究这个技术问题并提供来源。`
- `用 $mutou-relay，review 模式，只审查当前项目的这次改动。`

模型默认沿用网页当前选择。可以要求 `exact` 精确匹配网页完整模型标签，或 `prefer` 按明确候选顺序选择；任务中途变化会暂停。实际可用模型以你账号的可见菜单为准，详见[模型选择](docs/model-selection.md)。

## 公开框架的范围

仓库仅包含通用代码、Skill、占位配置、无秘密测试样例和依赖许可。没有登录状态、Key、账号关联、真实聊天链接、项目证据或原开发机器的验收记录。每位使用者自行配置、授权并验证自己的环境。

`npm test` 覆盖本地协议、安全边界、进程、安装和浏览器 DOM 适配；其中网页响应是明确的模拟样例，不能证明你的账号已完成真实 PLAN/REVIEW。实际联调步骤及判定见[验证说明](docs/validation.md)。

- [架构](docs/architecture.md) · [安全边界](docs/security.md) · [排障](docs/troubleshooting.md)
- [Skill 入口](skill/mutou-relay/SKILL.md) · [使用示例](skill/mutou-relay/examples/usage.md)
- [贡献说明](CONTRIBUTING.md) · [MIT 许可](LICENSE) · [第三方许可](THIRD-PARTY-NOTICES.md)
