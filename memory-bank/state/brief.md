# Project Brief

> 当前事实核对：2026-11-16。开发与代码变更以源码为准；推广渠道与社区规则以 `memory-bank/strategy/promotion-outreach.md` 为准。

## 项目名称

**AgentSurf**（GitHub: `ztao0916/agentsurf-browser-control-runtime`，包名 `@agentsurf/mcp-server` `v0.7.0`，Apache-2.0）

## 项目定位

面向本地与云端 AI Agent 的桌面浏览器控制运行时：让 **Claude Desktop、Cursor、Codex、Gemini Web、Notion AI、Dify** 等任何兼容 MCP 的智能体，安全复用用户已经登录的 **Chrome / Edge（MV3）**，无需无头浏览器、无需导出 Cookie，也无需给 AI 开放本机 Shell 权限。

## 核心差异化优势

1. **云端/网页 AI + 本地终端双通道**：原生支持标准 MCP `stdio`（本地零网络）与 `Streamable HTTP` + 反向 `WSS` + **OAuth 2.0 (PKCE)** / Bearer Token（云端与网页端免本地终端直连）。
2. **多电脑共存与活跃路由**：支持家里与公司 Chrome 同时挂在同一 `wss://.../ws` 网关而不互踢，按最近主动聚焦/交互设备自动路由，并在 `browser_start_session` 后锁定会话不漂移。
3. **为大模型省 Token 而设计**：`browser_get_interactives` 在页面内完成过滤（`visible_only` / `tag` / `role` / `name_contains`）并默认截断为 `150` 个元素，显著压缩重型页面上下文。
4. **安全护栏与 MCP 标准注解**：远程网关初始化默认 `read-only`；具备会话级 Tab Group 隔离、SHA-256 操作幂等防重放、零 `MAIN` 世界 `console` 注入，并已实现全部 MCP 工具的 `ToolAnnotations`（区分只读 12 项与写入/交互 19 项）。

## 技术栈

- **语言 / 运行时**：TypeScript、Node.js `>= 20`、ESBuild 单文件打包
- **扩展端**：Chrome / Edge Manifest V3（Service Worker + CDP + Native Messaging + Outbound WebSocket）
- **MCP 协议**：`@modelcontextprotocol/sdk` `^1.30.0`、`zod` `^4.6.5`
- **自托管远程网关**：单文件零依赖 `dist/mcp/standalone-gateway.js`（反向代理 Caddy / Nginx + PM2）

## 当前状态

| 维度 | 当前事实 |
| --- | --- |
| 当前主干提交 | `db62c68`（`origin/main` 已同步） |
| 核心能力里程碑 | OAuth 2.0 + PKCE、公网端口解绑、多设备不互踢与活跃路由、MCP `ToolAnnotations` 分组、`README` 实操演示 GIF 均已上线 |
| 演示素材 | 本地执行流 [agentsurf-demo-live.gif](../../docs/assets/agentsurf-demo-live.gif) + 真实 Gemini Web 操控 Wikipedia 演示 [gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)（`880×545`、`16.9s`、`2.27 MB`） |
| 当前阶段 | **开源冷启动推广与目录入驻期**（目录榜单 PR 提交 + 中文/海外技术社区合规分享） |
| 核心文档入口 | [README.md](../../README.md)、[README.zh-CN.md](../../README.zh-CN.md)、[remote-gateway.en.md](../../docs/remote-gateway.en.md)、[remote-gateway.md](../../docs/remote-gateway.md) |
