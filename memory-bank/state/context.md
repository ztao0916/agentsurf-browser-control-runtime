# Active Context

> 当前事实核对：2026-11-16

## Current Status

- **代码与文档状态**：
  - OAuth 2.0 + PKCE 网关、公网端口解绑、多设备不互踢与活跃自动路由已部署并在文档完成说明。
  - 已为全部 `32` 个 `ToolName` 与 `probe_*` 补充标准 MCP `ToolAnnotations`（`845cf90`），在 Gemini Web 中成功将只读工具拆分为 **只读（12）**（默认 `Always allow`）与 **写入/删除（19）**。
  - 已将基于真实录屏剪辑的纯英文 Wikipedia 多步操作 GIF（[gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)，`16.9s`、`2.27 MB`）嵌入中英文 README（`3cc1e63`），并在图注下补充了 Gemini Web 客户端强制授权确认限制的透明说明（`db62c68`）。
- **工作区同步**：`origin/main` 已包含 Glama 容器化支持（`aab2e94`：`Dockerfile`、`.dockerignore`、`glama.json`），当前项目记忆库已同步最新目录提交流水。

## Current Next Item

**当前主线：MCP 目录与开源列表收录推进中（详见 `memory-bank/strategy/promotion-outreach.md`）；Reddit 养号按用户指令暂缓**

1. **GitHub `punkpeye/awesome-mcp-servers` PR [#19670](https://github.com/punkpeye/awesome-mcp-servers/pull/19670)**：
   - 已提交并开启，`2/2` checks 通过、无冲突；Bot 贴有 `missing-glama` 标签，待 Glama 审核上线后追加 Glama score badge 即可继续合入评审。
2. **Glama (`glama.ai/mcp/servers`)**：
   - 已推送 `Dockerfile` + `.dockerignore` + `glama.json` 至 `main`（`aab2e94`），并验证 `dist/mcp/cli.js` 与 `dist/mcp/standalone-gateway.js` 在无 Chrome 环境下通过 stdio 正常响应 `initialize` + `tools/list`（`29` 个工具）。
   - 已在浏览器提交 `AgentSurf`（`Runs from source` -> `Your server has been submitted for review`），等待审核通知邮件。
3. **`mcpservers.org`（`wong2/awesome-mcp-servers` 入口）**：
   - 已通过 `$0` 免费通道提交 `AgentSurf`，页面提示最长 2 周内审核并邮件通知。
4. **暂缓 / 跳过渠道**：Reddit（今日按用户指示暂不处理）、V2EX、LINUX DO、Hacker News、`MCP.so`（仅 `$39` 付费提交）、`PulseMCP`（暂停提交）、`Smithery`（旧代理与账号体系已于 2026-10-31 关停）。

## Current Risks / Constraints

1. **Gemini Web 客户端确认弹窗限制（已实测）**：即便在 Gemini `App actions` 将 `Write / delete (19)` 设为 `Always allow / 始终允许`，调用非只读工具（`browser_start_session`、`browser_open`、`browser_click`、`browser_type`、`browser_scroll` 等）时对话内仍可能弹窗确认；只读工具（`Read (12)`）已可自动放行。
2. **Reddit 新号/低 Karma 外链风控**：低 `comment karma` 账号直接发外链帖子易触发 `removed by Reddit's filters`，且 `r/ClaudeAI` 强制要求 `OP karma > 100`。
3. **PulseMCP 与 Smithery 现状（2026-11-16 实测）**：`PulseMCP` 当前暂停新服务提交，`Smithery` 旧托管代理已关停并并入 Arcade，本轮目录投入不分配给这两家。
