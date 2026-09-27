# 验证范围

## 本地回归

在 Windows 11 x64、Node.js 24、PowerShell 7、Git、Python 3 和 Microsoft Edge 环境运行 `npm ci --ignore-scripts`、`npm test`。测试创建自己的临时目录，不要求初始化个人 Runtime 或登录 ChatGPT。原生重解析点用例需要支持该操作的 Windows 文件系统；报错应视为未通过，不能伪装成功。

回归涉及安装冲突、路径与授权边界、Git/非 Git 基线、真实子进程采集、MCP 协议、状态机和本地 HTML 的浏览器 DOM 行为。合成的密钥字符串和 `/c/fixture-*` 等聊天地址仅为无秘密测试数据。测试不登录线上账号，也不启动真实 Tunnel。

## 使用者自己的真实联调

1. 完成安装与账号配置，运行 doctor。网页 NOT_CHECKED 或缺少凭证不能视为可用。
2. 把 tests/fixtures/node 或 python 复制到独立临时目录；只授权这个无秘密样例。
3. 核对专用会话、可见模型与思考标签、启用的 App，以及仅七个只读 relay 工具。
4. 使用 build 模式，实际完成网页研究与来源 → PLAN → Codex 修复 → 真实检查 → 网页 REVIEW；保留研究原文和来源、关联一致的 PLAN/REVIEW 原文及 MCP 读取证据，确认任务 DONE 后停止连接。Runtime DONE 仅验证项目阶段；缺少真实研究仍不能验收完整 build。
5. 分别检查 research、缺失模型、授权到期、连接中断和重复实例等相关行为；失败时保留真实错误，不用手写响应替代网页输出。

证据保存在外部私有数据目录。公开仓库不附带任何开发者账号的验收历史，也不保证其他账号的菜单、权限或网站访问验证条件相同。真实联调未完成时明确记录 E2E_NOT_VALIDATED。
