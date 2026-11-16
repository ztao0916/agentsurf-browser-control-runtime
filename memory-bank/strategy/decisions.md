# Strategy Decisions

> 只保留当前仍生效的关键技术、安全、产品与沟通决策。

## 1. 架构与传输决策

- **双通道分离**：保留本地 `stdio`（零网络延迟、Native Messaging）与远程 `Streamable HTTP + 反向 WSS` 两套入口，共享同一套浏览器控制运行时与工具契约。
- **公网域名与端口解绑（2026-11-16 确立）**：对非回环公网 Host 忽略端口号校验并动态推导 `Host` / `X-Forwarded-Proto` 与 OAuth 元数据，支持单网关实例同时兼容 `443` 或 `:9443` / `:9444` 等备用反代端口。
- **单网关多设备共存 + 活跃自动路由（2026-11-16 确立）**：同一 `wss://.../ws` 接入端支持多台电脑（如家里与公司）同时在线而不互踢；默认路由至用户最近主动操作聚焦的浏览器，会话期间锁定发起设备不漂移。

## 2. 安全与权限边界

- **远程默认 `read-only`**：`init-remote` 默认以只读模式初始化，需显式开启 `interactive` 才允许点击、输入等交互工具；`browser.reset_sessions`、`browser.set_files` 与下载管理类工具在远程模式默认排除。
- **零 `MAIN` 世界污染**：不在页面主世界劫持 `console` 或全局对象，降低与站点脚本冲突及反爬识别风险。
- **MCP `ToolAnnotations` 分级（2026-11-16 确立）**：在 `src/mcp/tool-definitions.ts` 显式区分 `readOnlyHint: true`（12 项只读检查工具）、非破坏性交互工具（`destructiveHint: false`）与关闭/重置工具（`destructiveHint: true`），避免客户端将全部工具误归类为高危 `Write / delete`。
- **仓库与知识库脱敏底线**：服务器 IP、SSH 凭据、Bearer 配对密钥、OAuth Client Secret 与个人社交账号用户名严禁写入仓库或公开文档。

## 3. 文档、演示与外部兼容事实

- **英文优先宣传素材**：扩展 UI、OAuth 授权页、文档截图及开源演示 GIF 统一使用英文界面，适配 GitHub 与海外开发者传播。
- **Gemini Web 实测限制透明化（2026-11-16 确立）**：实测确认 Gemini Web 对第三方 OAuth MCP 的非只读动作仍会在对话中弹出 `Always allow` 确认卡片（即便已在 `App actions` 设置分组为 `始终允许`）。在 `README.md` / `README.zh-CN.md` 与 `docs/remote-gateway*.md` 中明确如实标注，避免误导用户以为扩展或网关异常。
