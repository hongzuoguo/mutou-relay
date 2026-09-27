# 调用示例

```text
$mutou-relay
mode: build
model-policy: current

修复当前项目中已复现的问题。先让 ChatGPT 网页检索相关官方资料并提供来源，再结合研究结论规划，由 Codex 修改并检查，最后独立审查。
不要改动与该问题无关的文件。
```

```text
$mutou-relay
mode: review
model-policy: exact
model-label: <从当前网页复制的完整模型标签>

只审查当前项目的未提交变化，不修改文件。分别列出确认缺陷、证据不足和可选建议。
```

```text
$mutou-relay
mode: research
model-policy: current

研究指定问题，优先使用官方资料，标明日期与来源。不访问本地项目。
```
