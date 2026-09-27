# 本地命令与证据

所有命令通过本技能 scripts/relay.ps1 或 Runtime 源码 scripts/relay.ps1 执行。业务逻辑在 TypeScript。读取 Runtime docs/windows-setup.md 进行首次设置。

任务文件：`{"goal":"修复问题","scope":["src"],"acceptance_ids":["A1"],"mode":"build"}`。
build 创建任务前先完成 Skill 的网页研究；实际 goal 应包含用户目标、研究结论和来源摘要。研究由宿主 Skill 编排，Runtime 的状态机从项目任务开始，不能把 Runtime 的 DONE 单独解释为研究已验收。
检查文件：`{"executable":"node","arguments":["--test"],"cwd":"","acceptance_ids":["A1"],"kind":"tests","timeout_seconds":120}`。
检查命令由 Codex 依据项目及用户授权决定，不能执行模型或仓库随意指定的命令。exe/参数数组不经过隐式 shell；npm.cmd 需明确使用已获授权的 PowerShell 命令入口。

限时授权返回值只用于当前已批准任务的网页消息。若需临时文件，放私有数据根目录，调用后删除该确切文件。不要把 capability 放普通项目或截图。授权默认 30 分钟，最多 120 分钟；到期需本地确认后重授，旧游标失效。

`task prepare --phase plan|review --file observation.json` 接受当前宿主浏览器观察。`task accept --file reply.json` 接受适配器提取的完整输出，不接受“模型说通过”的人工总结。协议 schema 随请求发送，源定义在 Runtime src/protocol.ts。

`task execute` 消费已验证 PLAN 一次。`task recover` 只检查和转 NEEDS_USER，不重发或重执行。取消用 `task cancel`，停止用 `stop`。状态文件中断或锁异常，不直接删除锁；检查所属进程与证据后按 Runtime 排障流程处理。

证据在私有根目录 sessions/<task_id>，包含基线、逐轮快照、实际检查、消息请求、结构化回复、MCP 读取记录；审计仅记录元数据。没有测试、零测试、超时、失败、代码漂移都不能宣称功能验收通过。首次检查失败后保留失败证据；重跑成功只覆盖同一命令和验收范围的旧结果，不能抹除别的失败。
