# 网页模型选择

只处理实际可见完整标签，不维护型号等级或订阅层级表。

| 策略 | 初始化 | 中途变化 |
|---|---|---|
| current | 读取并锁定当前标签 | 暂停 |
| exact | 必须有唯一完整匹配 | 暂停，不替换 |
| prefer | 按用户明确候选顺序选首个唯一可用项 | 暂停，不改用次选 |

reasoning_label 独立；未指定不调整，有要求却无法识别控件就阻塞。Auto 只能记录为 Auto/自动路由，不能假称固定型号。没有核实的选项为 unknown，不能从历史模型列表补齐。

每次 PLAN/REVIEW 前需新鲜（60 秒内）浏览器观察：conversation_url、surface=chat、selected_label、available_options、reasoning_label、app_available、observed_at、verification_status=verified、source=host-browser。Runtime 请求保存策略、选择及会话关联。模型或思考标签中途改变禁止静默续跑，保留现场，由用户决定是否新建任务。
