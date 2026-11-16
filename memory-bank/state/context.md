# Active Context

> 当前事实核对：2026-11-16

## Current Status

- **代码与文档状态**：
  - OAuth 2.0 + PKCE 网关、公网端口解绑、多设备不互踢与活跃自动路由已部署并在文档完成说明。
  - 已为全部 `32` 个 `ToolName` 与 `probe_*` 补充标准 MCP `ToolAnnotations`（`845cf90`），在 Gemini Web 中成功将只读工具拆分为 **只读（12）**（默认 `Always allow`）与 **写入/删除（19）**。
  - 已将基于真实录屏剪辑的纯英文 Wikipedia 多步操作 GIF（[gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)，`16.9s`、`2.27 MB`）嵌入中英文 README（`3cc1e63`），并在图注下补充了 Gemini Web 客户端强制授权确认限制的透明说明（`db62c68`）。
- **工作区同步**：`origin/main` 已包含 Glama 容器化支持（`aab2e94`：`Dockerfile`、`.dockerignore`、`glama.json`），当前项目记忆库已同步最新目录提交流水。

## Current Next Item

**当前主线：已完成首轮免费 MCP 目录提交；所有未申请渠道正式放弃，后续仅做结果收尾（详见 `memory-bank/strategy/promotion-outreach.md`）**

1. **GitHub `punkpeye/awesome-mcp-servers` PR [#19670](https://github.com/punkpeye/awesome-mcp-servers/pull/19670)**：
   - 已提交并开启，`2/2` checks 通过、无冲突；待 Glama 过审后补充 score badge 即可继续合入。
2. **Glama (`glama.ai/mcp/servers`)**：
   - 已推送 `Dockerfile` + `.dockerignore` + `glama.json`（`aab2e94`）并在浏览器完成提交审核，等待审核结果邮件。
3. **`mcpservers.org`（`wong2/awesome-mcp-servers` 入口）**：
   - 已通过 `$0` 免费通道提交 `AgentSurf`，等待审核邮件。
4. **已放弃渠道**：今天未申请的渠道（Reddit 养号及发帖、V2EX、LINUX DO、Hacker News、`MCP.so`、`PulseMCP`、`Smithery`）全部正式放弃，不再投入时间。
5. **npm 发布（已上传待放行）**：`agentsurf-mcp@0.7.0` 已成功上传至 npm 官方源，当前处于 staged release 占位状态（`0.0.0-stage`），待维护者在 npmjs.com 网页端确认放行后即切换为正式版 `0.7.0`。

## Current Risks / Constraints

1. **Gemini Web 客户端确认弹窗限制（已实测）**：即便在 Gemini `App actions` 将 `Write / delete (19)` 设为 `Always allow / 始终允许`，调用非只读工具（`browser_start_session`、`browser_open`、`browser_click`、`browser_type`、`browser_scroll` 等）时对话内仍可能弹窗确认；只读工具（`Read (12)`）已可自动放行。
