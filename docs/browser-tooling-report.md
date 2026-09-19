# AgentSurf 浏览器运行时：当前状态与已知边界

本文对应当前 `main` 分支的 30 工具版本。旧版工具范围和验证数据已经清理，当前能力以本文、[README](../README.md) 和 [工具参考](reference.md) 为准。

## 当前工具面

AgentSurf 通过本地 MCP Server 提供 30 个 `browser.*` 工具。

### 会话与标签页

- `browser.list_tabs`
- `browser.claim_tab`
- `browser.switch_tab`
- `browser.close_tab`
- `browser.reset_sessions`

### 导航

- `browser.open`
- `browser.back`
- `browser.forward`
- `browser.reload`

### 读取与观察

- `browser.get_frames`
- `browser.get_page`
- `browser.get_interactives`
- `browser.get_page_content`
- `browser.get_console_messages`
- `browser.screenshot`
- `browser.observe`

### 页面交互

- `browser.click`
- `browser.double_click`
- `browser.type`
- `browser.press`
- `browser.select_text`
- `browser.set_checked`
- `browser.select_option`
- `browser.drag`
- `browser.wait_for_element`
- `browser.scroll`
- `browser.handle_dialog`

### 文件与下载

- `browser.set_files`
- `browser.list_downloads`
- `browser.wait_for_download`

## 自动化验证

当前 CI 在 Node.js 20、22、24 上执行：

```text
npm run typecheck
npm run lint
npm test
npm run build
```

本轮 `main` 验证结果：

- TypeScript 类型检查通过；
- ESLint 通过；
- 10 个测试文件、129 项单元测试通过；
- 扩展、Native Host、Bridge 和 MCP Server 构建通过。

这些测试主要覆盖协议、参数校验、调度、会话和适配器逻辑。它们不会启动真实 Chrome、安装未打包扩展并操作真实网页。

## 真机链路

Windows 与 macOS 已完成手工真机验证，包括：

- 从 `dist/` 加载未打包扩展；
- Native Messaging Host 注册和连接；
- Bridge 连接、MCP Server 调用和工具发现；
- 标签页读取、页面内容提取、元素操作、iframe 与截图；
- 会话标签页分组与清理。

真实 Chrome 的自动化 E2E 尚未接入 CI，因此每次涉及扩展注入、Chrome API、CDP 或 Native Messaging 的改动，仍需要至少执行一次手工冒烟验证。

## 当前边界

- **无 OCR**：图片内文字需要截图后依赖模型自身视觉能力。
- **无 Shadow DOM 专门支持**：开放 Shadow Root 的文本可以进入页面正文，但内部元素不会进入 `get_interactives`。
- **iframe 需显式寻址**：默认操作顶层文档，使用 `browser.get_frames` 获取 `frame_id`；跨域框架通常无法注入。
- **受保护页面不可注入**：包括 `chrome://`、Chrome 应用商店等。
- **CDP 与 DevTools 互斥**：同一标签页已打开 DevTools 时，截图所需的 debugger attach 可能失败，并显示“Chrome 正在被调试”横幅。
- **Console 跨导航丢失**：缓冲位于当前页面上下文，刷新或跳转后清空，并且只能看到采集器启动后的输出。
- **拖拽不携带 `dataTransfer` 数据**：可以触发拖放交互，但不能注入自定义拖拽载荷。
- **文件上传需要本机绝对路径**。
- **下载无法可靠关联来源标签页**：只能使用 Chrome Downloads API 提供的元数据。
- **平台覆盖**：已验证 Windows 与 macOS；Linux 暂未提供安装脚本。

## 报告问题

遇到可复现问题，请附上操作系统、Chrome 版本、AgentSurf 提交号、复现步骤和已脱敏日志，并在 [GitHub Issues](https://github.com/ztao0916/agentsurf-browser-control-runtime/issues) 中反馈。不要提交 token、Cookie、密码或真实业务数据。
