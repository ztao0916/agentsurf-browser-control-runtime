# AgentSurf

这是一个基于 Chrome Extension Manifest V3 的 Browser Control Runtime。它提供与 AI 模型无关的浏览器 Tool Protocol，并通过 Native Messaging 连接本机 Browser Bridge，供 Claude、GPT、Gemini、Codex 或其他 Agent 调用。Extension 不监听 HTTP 或 WebSocket 端口。

当前实现的 Tool：

- `browser.list_tabs`
- `browser.get_page`
- `browser.get_page_state`
- `browser.get_interactives`
- `browser.click`
- `browser.type`
- `browser.scroll`
- `browser.screenshot`
- `browser.switch_tab`
- `browser.open`
- `browser.start_session` / `browser.end_session` / `browser.name_session`
- `browser.claim_tab` / `browser.release_tab`
- `browser.close_tab` / `browser.back` / `browser.forward` / `browser.reload`
- `browser.attach_debugger` / `browser.detach_debugger` / `browser.cdp` / `browser.get_cdp_events`
- `browser.get_accessibility_tree` / `browser.observe` / `browser.get_capabilities`
- `browser.double_click` / `browser.press` / `browser.set_checked` / `browser.select_option`
- `browser.drag` / `browser.wait_for_element`
- `browser.mouse_move` / `browser.click_at` / `browser.drag_at` / `browser.scroll_at`
- `browser.press_key` / `browser.type_text` / `browser.handle_dialog`
- `browser.list_downloads` / `browser.wait_for_download` / `browser.set_files`

当前未实现：AI 接入、OCR、iframe、Shadow DOM、MCP 和业务自动化。文件上传使用本地绝对路径，下载只返回 Chrome Downloads API 能提供的元数据。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- Chrome 116 或更高版本（Manifest V3、Native Messaging 和 CDP）

## 安装依赖

在项目根目录执行：

```powershell
npm install
```

## 构建

```powershell
npm run lint
npm run typecheck
npm run build
npm test
```

构建产物会生成到 `dist/`。Chrome 加载的是 `dist/`，不是源码目录。

## 在 Chrome 中加载插件

1. 执行 `npm run build`。
2. 打开 `chrome://extensions`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择项目中的 `dist/` 目录。
6. 如果重新构建了代码，在扩展管理页面点击扩展的刷新按钮。

Chrome 的 `chrome://` 页面、Chrome Web Store 页面和其他受浏览器保护的页面不允许注入 Page Agent，这是浏览器限制。

## 本地手动测试

加载扩展后，在地址栏打开：

```text
chrome-extension://<扩展 ID>/debug.html
```

扩展 ID 可以在 `chrome://extensions` 的扩展详情中查看。调试页提供以下操作：

- 列出浏览器中的 Tab
- 获取当前激活 Tab 的页面状态（URL、标题、加载状态、viewport、`page_revision`）
- 获取当前激活 Tab 的结构化交互元素 Snapshot
- 使用 `element_id` 点击或输入文字
- 滚动顶层页面
- 截取活动 Tab 的当前可视区域
- 选择并切换 Tab
- 打开一个 `http` 或 `https` URL

测试页面读取时，先在下拉框中选择一个普通 `http/https` 网页，再点击 “Get page state” 或 “Get interactives”。调试页会显式传入该页面的 `tab_id`，不需要先切换离开调试页。

测试元素操作时，先调用 “Get interactives”，从结果中取得一个 `element_id`，填入 Element actions 区域。点击 “Click” 执行点击；输入文字后点击 “Type” 执行文本输入。Page scroll 区域通过 `delta_x`、`delta_y` 控制顶层页面滚动。

测试截图时，目标页面必须是其所在 Chrome 窗口的活动 Tab。由于调试页本身也会占用一个活动 Tab，建议把调试页移到第二个 Chrome 窗口，然后在下拉框选择第一个窗口中的活动网页。选择 PNG 或 JPEG 后点击 “Screenshot”，页面会显示预览，输出中会显示 MIME、尺寸、revision 和经过缩略展示的 Data URL。

调试页调用的是和未来 AI Adapter 相同的 `browser.*` Tool Protocol。输出区域会显示统一的成功或错误响应。

## 安装 Native Host 与启动本地 Bridge

Bridge 只监听 `127.0.0.1`，不会监听局域网或公网地址。Native Host 由 Chrome Extension 通过 Native Messaging 启动；先构建并安装 Host：

```powershell
npm run build
npm run native-host:install -- -ExtensionId <扩展 ID>
```

安装脚本会在 `%LOCALAPPDATA%\BrowserControlRuntime` 创建随机 token、Native Messaging manifest 和可执行 Host 启动器。Chrome 扩展 ID 可从 `chrome://extensions` 复制。

独立 Bridge 也可以手动启动，用于 Bridge 协议测试；它不会自动拥有 Chrome 控制能力，必须有兼容的 Extension WebSocket 连接。未设置环境变量时，Bridge 会在每次启动时生成一个随机 token，并在终端显示。也可以在启动前设置一个至少 16 个字符的随机 token：

```powershell
$env:BROWSER_BRIDGE_TOKEN = "替换为本机随机生成的长 token"
$env:BROWSER_BRIDGE_PORT = "8765"
npm run bridge
```

开发时也可以使用 `npm run bridge:dev`，它会先重新构建再启动独立 Bridge（仅用于兼容旧的 WebSocket 调试）。Native Host 启动的 Bridge 会使用 `%LOCALAPPDATA%\BrowserControlRuntime\config.json` 中的 token。token 不在源码或构建产物中；Extension 端不保存 Bridge token。

## 让 Extension 连接 Native Host

1. 在 `chrome://extensions` 重新加载 `dist/`，确保 Service Worker 使用最新构建。
2. 打开扩展的 `debug.html`。
3. 点击 `Connect native host`，等待 Connection 显示 `connected`。
4. 调试页显示 Native Host 提供的本机 Agent endpoint；外部 Agent 使用同一 config token 连接该 endpoint。

Native Messaging 由 Chrome 校验 `allowed_origins`，Extension 与 Host 之间不再重复发送 token。Native Host 到期或断开时，Extension 会清理 pending request 并按退避策略重连。调试页分别记录连接错误、Tool 请求和 Tool 响应，且不会把完整截图 Data URL 写入日志。

## Agent WebSocket 协议

外部 Agent 连接 Native Host 启动的本机 Bridge。每个 Agent WebSocket 连接的第一条消息必须完成认证，未认证消息或错误 token 会被拒绝，并且不会执行 Browser Tool：

```json
{"type":"auth","role":"agent","token":"<同一个随机 token>"}
```

认证成功响应为：

```json
{"type":"auth_result","ok":true,"role":"agent"}
```

Agent 认证后发送现有 External Tool Contract（外部协议不包含 Extension 内部使用的 `kind` 字段）：

```json
{
  "protocol_version": "1",
  "request_id": "req_123",
  "tool": "browser.get_page_state",
  "args": { "tab_id": 123 }
}
```

成功响应：

```json
{
  "request_id": "req_123",
  "ok": true,
  "result": {}
}
```

失败响应继续使用统一 Error Model：

```json
{
  "request_id": "req_123",
  "ok": false,
  "error": {
    "code": "bridge_unavailable",
    "message": "Chrome Extension is not connected.",
    "retryable": true
  }
}
```

Bridge 与 Agent 使用 `auth` 握手；Native Host 与 Extension 使用 Chrome Native Messaging framing。Bridge 按 `request_id` 转发响应；超时、Extension 断开或 Bridge 停止时会清理 pending request 并返回结构化错误。

## 从外部调用 Tool

仓库内的开发调用脚本可模拟外部 Agent。Native Host 连接成功后，在另一个 PowerShell 终端读取 `%LOCALAPPDATA%\BrowserControlRuntime\config.json` 的 `token`，然后调用：

```powershell
$env:BROWSER_BRIDGE_URL = "ws://127.0.0.1:8765"
$env:BROWSER_BRIDGE_TOKEN = "config.json 中的 token"
npm run bridge:call -- '{"protocol_version":"1","request_id":"req_123","tool":"browser.list_tabs","args":{}}'
```

把 `tool` 和 `args` 换成 `browser.get_capabilities` 返回的任一 Tool 即可。截图响应中的 `image_data` 是 Data URL；日志脚本会缩略显示它。

## 项目结构

`src/core/` 只包含与 Chrome API 无关的 Tool Contract、Schema、错误模型和 Runtime 调度逻辑；`src/chrome/` 封装 Chrome API、CDP、下载和 Session/Tab Group；`src/content/` 是运行在网页中的 Page Agent、Element Registry 和可视化 Agent Cursor；`src/transport/` 负责可替换的 Native Messaging Adapter；`src/bridge/` 是本机 Node.js WebSocket Bridge；`src/native-host/` 是 Chrome Native Messaging Host。

Page Agent 为每个页面 Document 生成独立 revision，并在结构性 DOM 变化或交互语义属性变化时更新 revision。`element_id` 是不透明字符串，只能在生成它的 Tab 和页面 revision 内使用；Registry 中的 DOM 引用只保存在 Content Script 中。

页面加载时通过 Navigation Timing 区分 navigation 和 refresh；每次 Tool 请求前同步同文档 URL 变化。MutationObserver 不监听文本变化，只筛选交互元素增删、已注册元素的关键属性变化和单批大型结构变化，并按 mutation batch 至多推进一次 revision。普通文本或少量非交互节点变化不会更新 revision。`browser.get_page_state` 的 `revision_reason` 返回 `navigation`、`refresh` 或 `important_dom`。

`browser.get_interactives` 返回 `tab_id`、`page_revision`、`snapshot_id` 和元素数组。元素包含角色、标签、可访问名称、文本、输入类型、占位符、值状态、选中/禁用/可见状态及页面坐标。响应不包含 CSS Selector 或 XPath，密码输入只返回 `value_state: "redacted"`。

`browser.click` 和 `browser.type` 只接受 `tab_id` 和 `element_id`（type 另接收 `text`）。它们会验证 ID、revision、连接状态、可见性和 disabled/editable 状态。`browser.scroll` 接受 `tab_id`、`delta_x`、`delta_y`，返回最终位置和顶部/底部状态。三个动作都会返回当前 `page_revision`、revision 是否变化以及是否建议重新获取 interactives。

`browser.screenshot` 使用官方 `chrome.tabs.captureVisibleTab`，默认返回当前可视区域的 PNG，也支持 JPEG。响应包含 `tab_id`、`page_revision`、实际像素宽高、MIME 和 Data URL。Runtime 不会为截图切换 Tab；目标不是其窗口的活动 Tab、截图期间活动 Tab 改变或 revision 改变时，返回 `screenshot_unavailable`。该 API 要求 `<all_urls>` host permission，但 Content Script 仍只注入 `http/https` 页面。

`browser.mouse_move`、`browser.click_at`、`browser.drag_at` 和元素级操作会在目标页面显示一个不参与页面交互的短暂 `AI` 光标标记，帮助用户确认当前 Agent 操作位置。该标记不会被 `get_interactives` 返回，也不会改变 `page_revision`。

`browser.set_files` 只接受 `element_id` 和本机绝对路径数组。Runtime 会在 Page Agent 中给目标 file input 添加临时内部标记，再通过 CDP `DOM.setFileInputFiles` 设置文件，最后清理标记。`browser.list_downloads` 使用 Chrome Downloads API；Chrome API 不提供历史下载的来源 Tab，因此无法可靠关联的记录返回 `tab_id: null`。

## 验证命令

- `npm run lint`：ESLint 检查
- `npm run typecheck`：严格 TypeScript 类型检查
- `npm run build`：生成可加载的 MV3 扩展
- `npm test`：运行 Vitest 单元测试
