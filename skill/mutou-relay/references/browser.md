# Windows 宿主浏览器路线

已实现路线：宿主 shell 工具 → 已安装 `playwright-cli` → 指定已确认 session → DOM。
当前工具名为 `functions.exec` 内 `tools.exec_command`；后续宿主名称可能不同，必须先确认实际可用工具。无可用浏览器工具就 HOST_BROWSER_UNAVAILABLE，不读 cookie、存储或私有接口。

默认后台无头运行，不使用 `--headed`，并在 Windows 核实浏览器主进程带 `--headless`、无可见窗口。辅助子进程同样需隐藏控制台；Node 设置 windowsHide，PowerShell 后台启动设置 Hidden。只有用户明确需要可见登录/交互时才打开窗口。无头会话遇到访问验证，不绕过验证、不自动切换可见窗口；记录阻塞的网页步骤，继续互不依赖的本地工作。登录配置只复用本产品已获确认的专用 profile。

用户同意后台桌面模式后，可调用 Runtime 的 `scripts/start-background-browser.ps1 -Artifacts <私有 artifacts 逻辑路径> -Profile <原专用 profile>`。先正常关闭同名 CLI 会话；此入口启动标准有界面 Edge，但把它放在未切换到的 Windows 独立桌面，核对当前输入桌面没有变化。后续 CLI 操作仍使用原 session 和 artifacts 工作目录。它不是无头模式，不得写成无头验收通过；不修改浏览器指纹、不自动处理验证码。已授权的本次模式选择继续有效，不因每次重启重新询问。关闭使用同一 session 的 `close`，不按浏览器进程名称全局杀进程。

所有本产品 Playwright CLI 操作的工作目录统一为私有根目录的 `artifacts`（默认 `%LOCALAPPDATA%\MutouRelay\artifacts`），防止会话按工作目录分组后接错实例，也避免原始工具产物进入源码。首次读取 `playwright-cli --version` 与 `playwright-cli list`。不要连接列表中无关会话。用户确认专用会话后，由宿主创建 `playwright-cli -s=mutou-relay open https://chatgpt.com --browser=msedge`。登录用户自己完成；不迁移其他浏览器配置。

在所选 session 优先使用 `--raw run-code` 读取所需控件的可见 DOM，避免整页快照保存任务 capability。创建或选定 `/c/<id>` 的官方 Chat 会话，记录完整 URL。不得盲点固定坐标。根据实际可见元素填写私有 `browser.json` 输入：

```json
{
  "session":"mutou-relay",
  "conversation_url":"https://chatgpt.com/c/实际会话ID",
  "confirmed_at":"实际确认时间 ISO8601",
  "selectors":{
    "surface":"实际 Chat 模式标签定位器",
    "model":"实际当前模型按钮定位器",
    "model_options":"实际模型候选项定位器",
    "app":"实际已启用 Mutou Relay 标签定位器",
    "composer":"实际输入框定位器",
    "send":"实际发送按钮定位器",
    "stop":"实际停止生成按钮定位器",
    "errors":"实际错误/限额提示定位器",
    "tool_evidence":"实际工具调用详情定位器"
  }
}
```

存在思考控件才添加 reasoning 定位器。选择器通过当前 DOM 得到，由 Codex 填写，不需要用户编写代码。不确定 Chat/当前 App/模型状态时停止，不能填一个匹配页面正文的宽泛选择器冒充控件。

以下为界面适配示例，必须以实时 DOM 核对：初始页明确选择“聊天”，进入固定会话后可用 `surface_kind: "chatgpt-composer"` 验证带 `data-chatgpt-composer` 与 `data-composer-placement="thread"` 的表单。菜单式模型增加 `model_trigger`、`model_expand`，`model` 指向可见且 `aria-checked="true"` 的模型项，`model_options` 仅匹配可见选项。思考强度单独读取；“最新”是网页选择策略，不声称固定后端型号。

应用通过输入框提及时，使用 `composer_app_mention: true`，`app` 定位实际 `app-mention-display-name` / `plugin-mention-display-name` 节点。每次发送前通过真实菜单添加提及；程序保留该节点并拒绝已有用户草稿。已发送消息中的旧提及不能当作下一次请求启用状态。可配置 `user_messages`、`assistant_messages` 与 `completion`：实际新版消息节点使用搜索单元与 assistant Markdown 属性，发送后空输入框显示语音按钮，不能要求发送按钮常驻。

恢复会话后显示名可能变为小写 slug。已观察到实际 `app-mention-path` 时，填写 `app_uri` 为该确切 `app://asdk_app_...` 身份，`app` 仅定位该输入框提及，按 URI 核对而非名称猜测。菜单定位器排除 `[inert]` 内元素；思考标签仅在菜单中可见时设 `reasoning_in_menu: true`。菜单可能保留展开状态或延迟挂载，不能反复盲点展开按钮。

模型菜单还可能记住 `advanced` 列表视图，重新打开也不恢复思考滑块。此时必须重新核对实时 DOM：若按钮内 `[class*="ModelPickerTriggerLabel-"]` 显示可见思考标签，可将 reasoning 定位到此处并关闭 reasoning_in_menu；不要读取相邻 `aria-hidden` 测量文字或从内部属性推断后端型号。关闭菜单需等待展开状态及菜单内容都结束，避免动画期间反复开关。实际界面没有可信标签就明确阻塞，不能填默认 Pro。

MSIX 环境可添加 `host_artifacts_dir`，值为创建宿主会话时的逻辑 artifacts 路径。Runtime 必须验证其 realpath 与私有 artifacts 完全相同，仅用于满足宿主路径允许列表，不扩大文件权限。宿主 run-code 沙箱没有 Node 全局 URL 构造器；序列化操作不得依赖它。

`browser configure --file <private.json> --confirm-session` 保存确认。Runtime 的 browser 子命令实际生成有限 DOM 操作，通过 PowerShell 参数数组调用 `playwright-cli --raw -s=<session> run-code --filename=<private.js>`，执行后移除脚本。

支持 probe_capabilities、inspect_chat_surface、discover_model_options、apply_model_policy、ensure_app_available、create_or_resume_conversation（验证指定现有会话）、send_message、wait_for_completion、extract_response、inspect_tool_call_evidence。初次创建会话由宿主 DOM 操作完成，不能凭接口名字宣称自动创建成功。

发送需要 task prepare 生成的请求和独立 capability；例：`browser send_message --capability-file <私有根目录/grant.json>`。Runtime Key 永不进入该文件或网页。程序先持久化发送意图，然后填入消息并确认 user 消息中的 message_id。超时 UNKNOWN 不自动重发。

等待每次仅查询可见生成/错误/assistant 状态；由 Skill 每 3–10 秒调用，最多 10 分钟。提取时要求已发 user 消息和唯一匹配完整 assistant 消息；Runtime 再验证严格 JSON schema 和 MCP reads.jsonl。DOM 工具提示不能替代服务端读取证据。

协议回复要求一个 JSON 代码块；提取优先使用该 assistant 内唯一匹配标记的 `pre code` 文本，保留 JSON 转义。普通 Markdown 会消耗反斜杠，不能用字符串补丁伪造模型结果。对已有未加代码围栏的回复，可由宿主在核对该 assistant 的身份后点击网页“复制”，仅当复制结果自身为有效 JSON 且请求标记完全匹配时保存其原文；记录该提取方法。复制失败或内容不匹配立即停止，不回显无关剪贴板内容。

各账号与界面版本均须现场校准并完成自己的真实 PLAN/REVIEW 验证。界面改变报 BROWSER_UI_CHANGED，不切换 API、账号或公网 Tunnel。
