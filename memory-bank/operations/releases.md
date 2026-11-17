# Operations & Release Log

> 记录已核验的代码发布、文档里程碑与对外推广执行事实。

## 2026-11-16

- **OAuth 2.0 (PKCE) + 公网端口解绑 + 多设备活跃路由**：完成服务端与扩展改造并更新至云端单网关，实现家里/公司同网关不互踢与按活跃窗口自动路由。
- **MCP `ToolAnnotations` 分级（`845cf90`）**：为全部 `32` 个 `ToolName` 及 `probe_*` 补充 `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`，使 Gemini Web 将只读工具拆分为 `Read (12)` 并默认自动允许。
- **全英文实操演示 GIF 与文档更新（`addbbe6`、`3cc1e63`、`db62c68`）**：
  - 将真实 Gemini Web 操控 Wikipedia（打开蓝色 Tab Group、`AI` 光标输入搜索词、提交跳转、滚动阅读与 3 要点英文总结）剪辑生成为无弹窗纯 GIF [gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)（`880×545`、`16.9s`、`2.27 MB`）；
  - 更新 [README.md](../../README.md)、[README.zh-CN.md](../../README.zh-CN.md)、[remote-gateway.en.md](../../docs/remote-gateway.en.md) 与 [remote-gateway.md](../../docs/remote-gateway.md)，明确标注 Gemini Web 对非只读交互工具仍会弹出 `Always allow` 确认卡片的客户端行为限制。
- **推广渠道调研与项目知识库初始化（`e57e11c`、`9901875`）**：通过 AgentSurf 完成海内外社区与 MCP 目录的规则与实时状态核验，并在当前项目下建立轻量化 `AGENTS.md` + `memory-bank/` 分层记忆。
- **MCP 目录与收录首轮提交（`aab2e94` + 浏览器执行）**：
  - 提交 `punkpeye/awesome-mcp-servers` **PR [#19670](https://github.com/punkpeye/awesome-mcp-servers/pull/19670)**（`Browser Automation` 分类，`2/2` checks 通过，当前等待 `missing-glama` 条件补齐）；
  - 仓库新增 [Dockerfile](../../Dockerfile)、[.dockerignore](../../.dockerignore) 与 [glama.json](../../glama.json)（`aab2e94`），验证 stdio `tools/list` 无头返回 29 个工具后，完成 **Glama** `Runs from source` 表单提交审核；
  - 通过 `wong2/awesome-mcp-servers` 指定的官方入口 `https://mcpservers.org/submit` 完成 `$0` 免费提交（`AgentSurf`）。
- **npm 正式发布上线 `agentsurf-mcp@0.7.0`（`e753ae7`）**：定名 `agentsurf-mcp`（与 `bin` 同名），配置 `mcpName`（`io.github.ztao0916/agentsurf`）与 `publishConfig.registry`；已正式发布并通过 `npm view` 核验 `dist-tags.latest: 0.7.0`（`535.7 kB` / `9` files）。

## 2026-11-17

- **Glama 认领、Docker 探测过审与 PR #19670 更新**：
  - 完成 `glama.ai` 页面认领并在后台配置 `Build steps`（`["npm ci", "npm run build"]`）与 `CMD arguments`（`["node", "dist/mcp/cli.js"]`），`Build & Release` 执行成功（`Status: success`、`1m 53.7s`，`initialize` 与 `tools/list` 探测通过，发布 Release `0.1.0`）；
  - 向 `ztao0916/awesome-mcp-servers`（`add-agentsurf` 分支、`abbe8d2`）补充 Glama 评分徽章，**PR [#19670](https://github.com/punkpeye/awesome-mcp-servers/pull/19670)** 已通过 `check-submission` 并获 **`has-glama`** 标签。
