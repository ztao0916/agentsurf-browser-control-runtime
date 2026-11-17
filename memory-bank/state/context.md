# Active Context

> 当前事实核对：2026-11-16

## Current Status

- **代码与文档状态**：
  - OAuth 2.0 + PKCE 网关、公网端口解绑、多设备不互踢与活跃自动路由已部署并在文档完成说明。
  - 已为全部 `32` 个 `ToolName` 与 `probe_*` 补充标准 MCP `ToolAnnotations`（`845cf90`），在 Gemini Web 中成功将只读工具拆分为 **只读（12）**（默认 `Always allow`）与 **写入/删除（19）**。
  - 已将基于真实录屏剪辑的纯英文 Wikipedia 多步操作 GIF（[gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)，`16.9s`、`2.27 MB`）嵌入中英文 README（`3cc1e63`），并在图注下补充了 Gemini Web 客户端强制授权确认限制的透明说明（`db62c68`）。
- **工作区同步**：`origin/main` 已包含 Glama 容器化支持（`aab2e94`：`Dockerfile`、`.dockerignore`、`glama.json`），当前项目记忆库已同步最新目录提交流水。

## Current Next Item

**当前主线：前期发行与目录收录流程已全部完成并推送（详见 `memory-bank/strategy/promotion-outreach.md`），仅被动等待外部审核合入**

1. **GitHub `punkpeye/awesome-mcp-servers` PR [#19670](https://github.com/punkpeye/awesome-mcp-servers/pull/19670)**：
   - 已补充 Glama score badge（`abbe8d2`），`check-submission` 通过，标签已切换为 **`has-emoji, valid-name, has-glama`**，等待维护者合并。
2. **Glama (`glama.ai/mcp/servers`)**：
   - 已认领页面并完成 Docker build + MCP introspection 配置（`["npm ci", "npm run build"]` + `["node", "dist/mcp/cli.js"]`），`Status: success` 并发布 Release `0.1.0`，`/schema` 已解锁 `Deploy`，等待 Glama 后台异步刷新 `quality` 评分索引。
3. **`mcpservers.org`（`wong2/awesome-mcp-servers` 入口）**：
   - 已通过 `$0` 免费通道提交 `AgentSurf`，等待审核邮件。
4. **npm 已正式上线**：`agentsurf-mcp@0.7.0` 已在 `https://registry.npmjs.org/agentsurf-mcp` 正式上线（`dist-tags.latest: 0.7.0`，`bin: agentsurf-mcp`），可直接通过 `npx -y agentsurf-mcp` 或 `npm install -g agentsurf-mcp` 安装运行。
5. **已放弃渠道**：未申请的渠道（Reddit 养号及发帖、V2EX、LINUX DO、Hacker News、`MCP.so`、`PulseMCP`、`Smithery`）全部正式放弃，不再投入时间。

## Current Risks / Constraints

1. **Gemini Web 客户端确认弹窗限制（已实测）**：即便在 Gemini `App actions` 将 `Write / delete (19)` 设为 `Always allow / 始终允许`，调用非只读工具（`browser_start_session`、`browser_open`、`browser_click`、`browser_type`、`browser_scroll` 等）时对话内仍可能弹窗确认；只读工具（`Read (12)`）已可自动放行。
