# 架构与实现边界

Mutou Relay 从任务需求独立实现，没有读取或纳入其他同类 Skill。源码为一个 TypeScript 工程，PowerShell 仅用于入口、DPAPI、Windows ACL、Job Object 与宿主浏览器入口。

```text
Codex + installed Skill
  ├─ local CLI: config / binding / tasks / snapshots / collector
  ├─ host playwright-cli: confirmed ChatGPT Chat session DOM
  └─ official tunnel-client 0.0.15 foreground child (owned Windows Job)
       └─ sanitized PowerShell launcher → seven-tool stdio MCP
ChatGPT App → official Tunnel → authorized read-only project/evidence
```

本地控制面与远程 MCP 分离。MCP 只注册七个只读工具，不注册远程资源、执行器、安装器或可切换根目录的工具。服务进程一次冻结一个 project；每次请求重读当前授权、绑定代次与配置指纹。

模块有效来源：

| 文件 | 职责 |
|---|---|
| src/core.ts / preferences.ts | strict schema、默认值、YAML、原子状态、信任偏好 |
| src/security.ts | 相对路径、真实边界、链接/硬链接、打开后 inode 检查、文本编码 |
| src/store.ts | 唯一项目、任务基线、限时 bearer 授权与撤销 |
| src/evidence.ts | 受控快照、任务 diff、固定 Git 读取操作 |
| src/mcp.ts | 七工具的输入/输出 schema、分页、读取收据、响应限制 |
| src/collector.ts | 实际进程输出、退出码、测试数、前后快照、检查来源 |
| src/protocol.ts | 模型策略、请求关联、状态机、一次执行、修复上限、DONE 闸门 |
| src/browser.ts | 通过宿主 playwright-cli 操作指定网页 DOM |
| src/runtime.ts | 固定版 Tunnel、单实例、stdio 探测、健康检查、停止 |
| src/install.ts | 本产品技能安装、已知版本升级和保守卸载 |

源码与私有数据分离。默认 `%LOCALAPPDATA%\MutouRelay`，可用 `MUTOU_RELAY_HOME` 指定绝对目录；拒绝 Git 内目录、链接和项目重叠。私有配置中保留路径和 Tunnel ID；仓库只保留无秘密示例。schema_version 当前只有 1，未知版本显式拒绝；尚无历史格式，因此没有猜测式自动迁移。

Windows MSIX 宿主可能将逻辑 LocalAppData 重定向到另一磁盘。读取现有私有根目录时解析真实路径，原子写入先解析现有父目录，再在同一真实目录创建临时文件并 rename；不以 copy/delete 回退掩盖 EXDEV 或破坏原子性。回归测试在独立 LocalAppData 临时目录验证原子写入。

普通偏好优先级：任务输入 → 经过内容指纹信任的 `.mutou-relay.yaml` → 私有全局 YAML → schema 默认值。项目文件仅能设置模型策略及默认模式，不能设置根目录、凭证、命令或安全过滤；改变后重新信任。

Git 与非 Git 使用同样的任务快照。task 差异以本次任务开始为基线，原有用户修改不归因于本次。重命名表示为 deleted + added，不假定内容相似即同一文件。Git working/staged 需指定安全相对文件；不使用 git diff HEAD 冒充任务差异。

每个检查按 check_key（实际命令、参数、cwd、kind、验收 ID）关联；重复检查保留全部证据，闸门对同一轮同一 check_key 使用最新结果。不同失败检查不会被一个成功命令覆盖。测试数未知或零不能作为 tests 类验收；普通 build/lint/custom 仅证明自身命令结果。

不是沙箱或多用户服务。Runtime 无模型 API、无公网 MCP、无开机任务、无自动发布；仅支持明确的单项目和单任务。测试与真实网页联调的范围见 [验证说明](validation.md)。
