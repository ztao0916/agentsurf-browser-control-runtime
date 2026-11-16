# Active Context

> 当前事实核对：2026-11-16

## Current Status

- **代码与文档状态**：
  - OAuth 2.0 + PKCE 网关、公网端口解绑、多设备不互踢与活跃自动路由已部署并在文档完成说明。
  - 已为全部 `32` 个 `ToolName` 与 `probe_*` 补充标准 MCP `ToolAnnotations`（`845cf90`），在 Gemini Web 中成功将只读工具拆分为 **只读（12）**（默认 `Always allow`）与 **写入/删除（19）**。
  - 已将基于真实录屏剪辑的纯英文 Wikipedia 多步操作 GIF（[gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)，`16.9s`、`2.27 MB`）嵌入中英文 README（`3cc1e63`），并在图注下补充了 Gemini Web 客户端强制授权确认限制的透明说明（`db62c68`）。
- **工作区同步**：`origin/main` 已同步至 `db62c68`；已在当前项目搭建轻量化 `AGENTS.md` + `memory-bank/` 分层记忆。

## Current Next Item

**当前主线：聚焦 GitHub PR 与 Reddit 合规养号（节奏 A：填好预览待用户确认后提交，详见 `memory-bank/strategy/promotion-outreach.md`）**

1. **GitHub `punkpeye/awesome-mcp-servers` 收录 PR**：
   - 已 Fork 并推送 `add-agentsurf` 分支至 `ztao0916/awesome-mcp-servers`（`5682d52`），在浏览器打开对比创建 PR 页填妥标题与描述，待用户确认提交。
2. **Reddit 技术评论养号（`r/mcp` / `r/LocalLLaMA`）**：
   - 先发布纯干货、无外链的技术回复积累 `comment karma`（跨过全站外链过滤与 `r/ClaudeAI` `karma > 100` 门槛），达标后再按节奏 A 发 `r/mcp`（`showcase` tag）等主帖。
3. **已排除渠道**：按用户确认跳过 V2EX、LINUX DO 及当前无法登录的站点（Hacker News / Glama / MCP.so）。

## Current Risks / Constraints

1. **Gemini Web 客户端确认弹窗限制（已实测）**：即便在 Gemini `App actions` 将 `Write / delete (19)` 设为 `Always allow / 始终允许`，调用非只读工具（`browser_start_session`、`browser_open`、`browser_click`、`browser_type`、`browser_scroll` 等）时对话内仍可能弹窗确认；只读工具（`Read (12)`）已可自动放行。
2. **Reddit 新号/低 Karma 外链风控**：低 `comment karma` 账号直接发外链帖子易触发 `removed by Reddit's filters`，且 `r/ClaudeAI` 强制要求 `OP karma > 100`。
3. **PulseMCP 与 Smithery 现状（2026-11-16 实测）**：`PulseMCP` 当前暂停新服务提交，`Smithery` 旧托管代理已关停并并入 Arcade，本轮目录投入不分配给这两家。
