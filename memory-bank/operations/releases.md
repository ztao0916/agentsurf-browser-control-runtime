# Operations & Release Log

> 记录已核验的代码发布、文档里程碑与对外推广执行事实。

## 2026-11-16

- **OAuth 2.0 (PKCE) + 公网端口解绑 + 多设备活跃路由**：完成服务端与扩展改造并更新至云端单网关，实现家里/公司同网关不互踢与按活跃窗口自动路由。
- **MCP `ToolAnnotations` 分级（`845cf90`）**：为全部 `32` 个 `ToolName` 及 `probe_*` 补充 `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`，使 Gemini Web 将只读工具拆分为 `Read (12)` 并默认自动允许。
- **全英文实操演示 GIF 与文档更新（`addbbe6`、`3cc1e63`、`db62c68`）**：
  - 将真实 Gemini Web 操控 Wikipedia（打开蓝色 Tab Group、`AI` 光标输入搜索词、提交跳转、滚动阅读与 3 要点英文总结）剪辑生成为无弹窗纯 GIF [gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)（`880×545`、`16.9s`、`2.27 MB`）；
  - 更新 [README.md](../../README.md)、[README.zh-CN.md](../../README.zh-CN.md)、[remote-gateway.en.md](../../docs/remote-gateway.en.md) 与 [remote-gateway.md](../../docs/remote-gateway.md)，明确标注 Gemini Web 对非只读交互工具仍会弹出 `Always allow` 确认卡片的客户端行为限制。
- **推广渠道调研与项目知识库初始化**：通过 AgentSurf 完成 11 个海内外社区与 MCP 目录的规则与实时状态核验，并在当前项目下建立轻量化 `AGENTS.md` + `memory-bank/` 分层记忆。
