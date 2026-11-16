# Active Context

> 当前事实核对：2026-11-16

## Current Status

- **代码与文档状态**：
  - OAuth 2.0 + PKCE 网关、公网端口解绑、多设备不互踢与活跃自动路由已部署并在文档完成说明。
  - 已为全部 `32` 个 `ToolName` 与 `probe_*` 补充标准 MCP `ToolAnnotations`（`845cf90`），在 Gemini Web 中成功将只读工具拆分为 **只读（12）**（默认 `Always allow`）与 **写入/删除（19）**。
  - 已将基于真实录屏剪辑的纯英文 Wikipedia 多步操作 GIF（[gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)，`16.9s`、`2.27 MB`）嵌入中英文 README（`3cc1e63`），并在图注下补充了 Gemini Web 客户端强制授权确认限制的透明说明（`db62c68`）。
- **工作区同步**：`origin/main` 已同步至 `db62c68`；已在当前项目搭建轻量化 `AGENTS.md` + `memory-bank/` 分层记忆。

## Current Next Item

**当前主线：执行开源冷启动推广第 1–3 阶段（详见 `memory-bank/strategy/promotion-outreach.md`）**

1. **优先零门槛长期收录入口（立即可做）**：
   - 向 `punkpeye/awesome-mcp-servers` 提 PR 收录至 `Browser Automation` 分类；
   - 提交至 `Glama`（`glama.ai/mcp/servers`）与 `MCP.so`（`mcp.so`）。
2. **中文开发者社区首发**：
   - 在 `LINUX DO`（由作者本人手写技术复盘帖，严禁纯 AI 拼接文案）与 `V2EX /go/create`（带 `[开源]` 标签）发布，附真实 `gemini-web-demo.gif`。
3. **海外主战场（先养号互动，再坦诚自荐）**：
   - Reddit 账号需先通过真诚评论互动积累 `comment karma`（避开全站外链过滤及 `r/ClaudeAI` 的 `karma > 100` 门槛），再依次发布 Hacker News `Show HN`、`r/mcp`（必选 `showcase` 标签）等，严禁使用假装路人“发现好工具”话术。

## Current Risks / Constraints

1. **Gemini Web 客户端确认弹窗限制（已实测）**：即便在 Gemini `App actions` 将 `Write / delete (19)` 设为 `Always allow / 始终允许`，调用非只读工具（`browser_start_session`、`browser_open`、`browser_click`、`browser_type`、`browser_scroll` 等）时对话内仍可能弹窗确认；只读工具（`Read (12)`）已可自动放行。
2. **Reddit 新号/低 Karma 外链风控**：低 `comment karma` 账号直接发外链帖子易触发 `removed by Reddit's filters`，且 `r/ClaudeAI` 强制要求 `OP karma > 100`。
3. **PulseMCP 与 Smithery 现状（2026-11-16 实测）**：`PulseMCP` 当前暂停新服务提交，`Smithery` 旧托管代理已关停并并入 Arcade，本轮目录投入不分配给这两家。
