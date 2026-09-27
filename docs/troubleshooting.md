# 错误与恢复

错误为结构化 JSON：code、layer、reason、next、needs_user。任务的已完成状态用 `task status` 查询。错误信息不包含原始密钥、堆栈或项目正文。

| 错误 | 含义与下一步 |
|---|---|
| DEPENDENCY_MISSING | 核对 Node 24、PowerShell 7、Git 与固定版本 Tunnel |
| CONFIG_INVALID / PROJECT_TRUST_REQUIRED | 修复私有 YAML；项目偏好仅允许模型/模式，变化后本地重新确认 |
| WORKSPACE_UNSAFE / WORKSPACE_MISMATCH | 路径、链接、代次或运行中配置改变；不要放宽到磁盘根 |
| CREDENTIAL_MISSING | 在本地终端安全输入 Runtime Key |
| TUNNEL_PERMISSION_DENIED | 检查 Tunnel ID、Read+Use 和组织/工作区关联，不切换账号绕过 |
| TUNNEL_NOT_READY | 查看私有脱敏日志；alive 不等于健康、ready 或网页 MCP 成功 |
| CHATGPT_APP_UNAVAILABLE | 在明确 Chat 会话确认已启用 Mutou Relay App |
| MODEL_NOT_AVAILABLE / MODEL_SELECTION_UNVERIFIED | 核对完整可见标签及思考控件，不静默改模型 |
| HOST_BROWSER_UNAVAILABLE / BROWSER_UI_CHANGED | 连接经用户确认的宿主 session，重新读取实时 DOM；不读 cookie |
| SEND_STATUS_UNKNOWN | 检查原会话中的 message_id 和 marker；不要自动重发 |
| REPLY_MISMATCH / EVIDENCE_MISSING | 完整回复与当前请求字段或 MCP 读取收据不符；不进入实施 |
| EVIDENCE_STALE | 代码或基线改变，保留现场，重新检查/审查 |
| VERIFICATION_FAILED | 检查失败、零测试、未知测试覆盖或验收缺证据 |
| REPAIR_LIMIT_REACHED | 已完成一次修复仍未通过；保留结果，用户决定新任务 |
| INSTANCE_BUSY / STOP_NOT_CONFIRMED | 不删未知锁、不按进程名全局结束；先核对所属实例 |

中断后运行 `task recover`。它会核对当前项目快照并进入 NEEDS_USER，不自动重放实施。发送已确认但回复未提取时，宿主先打开原会话、观察当前模型与 message_id，提取现有完整回复；不生成新的请求规避原关联。

当前恢复命令只负责安全暂停，尚未提供自动解锁/从任意中间状态继续的命令。需要 Codex 核实原进程已退出、锁内实例与 PID/启动时间、页面消息及证据后人工修复本产品状态；不可为图省事删除其他进程锁。它是当前明确限制，不是自动恢复已验收。

Windows 任务终止由 Job Object 限制到本工具进程树。若系统策略不允许嵌套 Job，wrapper 显式失败，不以普通未受控启动回退。checks 输出为空或执行失败应查看该 check 的实际 stderr/status；不得手工改 passed。

响应超限时缩小 count、line_count 或相对目录。长单行、过大的单文件 before/after 或 Git diff 可能仍被拒绝；第一版尚未提供任意大型差异块流式传输。所有未返回部分都不能算已审查。
