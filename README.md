# AgentSurf

AgentSurf 是一个供 AI Agent 控制本机 Chrome 的浏览器运行时。它复用 Chrome 的现有登录态，通过统一的 `browser.*` 工具提供页面观察、点击、输入、截图等能力，不绑定特定 AI 模型。

已提供 **Pi Agent Adapter**。项目自身不内置模型调用、任务规划或业务自动化流程。

## 目录

- [工作原理与支持范围](#工作原理与支持范围)
- [Windows 与 Pi 快速安装](#windows-与-pi-快速安装)
- [macOS 与 Pi 安装](#macos-与-pi-安装)
- [第一次使用](#第一次使用)
- [更新重启与移动目录](#更新重启与移动目录)
- [常见问题与排障](#常见问题与排障)
- [工具速查](#工具速查)
- [安全使用边界](#安全使用边界)
- [开发与调试](#开发与调试)
- [外部调用协议](#外部调用协议)
- [项目结构与实现说明](#项目结构与实现说明)

## 工作原理与支持范围

```text
Pi Agent
  ↕ AgentSurf Adapter
本机 Browser Bridge（WebSocket，仅监听 127.0.0.1）
  ↕ Native Host（通过 Native Messaging 与扩展通信）
Chrome 扩展（Manifest V3）
  ↕ Chrome API / Page Agent
网页
```

Chrome 扩展通过 `chrome.runtime.connectNative` 启动 Native Host，由 Host 启动 Bridge。**正常使用不需要手动运行 `npm run bridge`。** 扩展自身不监听 HTTP 或 WebSocket 端口。

当前提供 Windows 和 macOS（Google Chrome 稳定版、当前用户）Native Host 安装脚本。macOS 适配已提供代码，但尚未在真实 Mac 上验证完整链路。Pi Adapter 可在 Linux 安装，但 Linux 的 Native Host 安装脚本和连接教程尚未提供。

当前未提供 OCR、iframe / Shadow DOM 专门支持及 MCP 接入。受 Chrome 保护的页面（如 `chrome://` 页面和 Chrome Web Store）不能注入 Page Agent。文件上传使用本机绝对路径，下载查询仅返回 Chrome Downloads API 能提供的元数据。

## Windows 与 Pi 快速安装

以下命令在 **PowerShell** 中执行。

### 1. 准备环境

- Git
- Node.js 20 或更高版本、npm 10 或更高版本
- Chrome 116 或更高版本
- 已安装的 Pi Agent

可用以下命令确认环境：

```powershell
git --version
node --version
npm --version
pi --version
```

### 2. 获取代码并构建

```powershell
cd ~/Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

仓库访问需要相应 GitHub 权限；如提示登录，在 GitHub 授权流程中完成。后续命令均在项目根目录执行。

构建产物位于 `dist/`，不提交到 Git，每台电脑都需要本地构建。**Chrome 加载的是 `dist/`，不是源码目录。**

### 3. 加载 Chrome 扩展

1. 打开 `chrome://extensions`，开启“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择项目中的 `dist/`。
3. 在扩展详情中复制 AgentSurf 的扩展 ID。

首次加载时尚未注册 Native Host，暂时无法连接属于预期情况。未打包扩展在不同电脑或加载路径下可能获得不同 ID，以当前 Chrome 显示的 ID 为准。

### 4. 安装 Native Host

先将下面的字符串替换为实际扩展 ID，再执行：

```powershell
$extensionId = "替换为Chrome显示的扩展ID"
npm run native-host:install -- -ExtensionId $extensionId
```

安装脚本会：

- 在 `%LOCALAPPDATA%\BrowserControlRuntime` 创建配置、Native Messaging manifest 和 `native-host.exe` 启动器；
- 首次生成随机认证 token，重新安装时保留已有有效 token；
- 注册 `com.browsercontrol.runtime`，只允许指定扩展连接；
- 默认将 Bridge 配置为 `127.0.0.1:8765`。

安装后回到 `chrome://extensions`，重新加载 AgentSurf。

### 5. 确认连接

扩展启动时会自动尝试连接。用实际扩展 ID 替换下面的占位符，在 Chrome 中打开：

```text
chrome-extension://<扩展ID>/debug.html
```

正常状态为：

```text
Connection: connected
Agent endpoint: ws://127.0.0.1:8765
```

已经连接时无需再点击 Connect。如果未连接，点击一次 **Disconnect**，等待一秒，再点击 **Connect native host**；不要连续点击 Reconnect。仍失败时参见[排障说明](#常见问题与排障)。

### 6. 安装 Pi Adapter

在项目根目录执行：

```powershell
pi install .
pi list
```

确认安装列表包含当前项目的本地路径。重启 Pi，或在已打开的 Pi 会话中执行：

```text
/reload
```

Pi 随后获得名为 `agentsurf` 的工具。Adapter 自动读取本机 Native Host 配置、连接 Bridge、完成认证并匹配请求响应。**日常使用无需手动填写地址、token 或 request_id，也不要将 token 粘贴到聊天中。**

## macOS 与 Pi 安装

需要 Git、Node.js 20+、npm 10+、Chrome 116+ 和 Pi。以下命令在 Mac 终端执行，无需 `sudo`，适用于当前用户的 Google Chrome 稳定版，不自动注册 Chromium、Chrome Beta 或其他浏览器。

### 1. 构建并加载扩展

```sh
cd ~/Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

在 `chrome://extensions` 开启开发者模式，加载项目的 `dist/`，复制扩展 ID。

### 2. 安装 Native Host

将字符串替换为实际扩展 ID：

```sh
npm run native-host:install:macos -- "替换为Chrome显示的扩展ID"
```

默认端口为 8765，可通过末尾额外参数指定端口。安装会保留已有有效 token，创建以下文件：

| 文件 | 路径 |
| --- | --- |
| 配置（仅当前用户读写） | `~/Library/Application Support/BrowserControlRuntime/config.json` |
| 可执行启动脚本 | `~/Library/Application Support/BrowserControlRuntime/native-host.sh` |
| Chrome Native Messaging manifest | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.browsercontrol.runtime.json` |

启动器记录安装时 Node 的绝对路径，不依赖从桌面启动 Chrome 时的 `PATH`。使用 nvm、Homebrew 等方式更换 Node 路径后，需要重新运行安装命令。项目路径含空格也会进行 shell 引号处理。

### 3. 连接并安装 Pi Adapter

重新加载 AgentSurf，在 `chrome-extension://<扩展ID>/debug.html` 确认 `connected`。然后在项目根目录执行：

```sh
pi install .
pi list
```

在 Pi 中执行 `/reload` 或重启 Pi。Adapter 与 Host 使用上表中的同一配置路径，不需要手工复制 token。随后按“第一次使用”进行只读检查。

### 4. 更新、重启与卸载

完整更新时先在 Chrome 禁用 AgentSurf，等待旧 Host 退出，再执行：

```sh
git pull
npm install
npm run build
npm run native-host:install:macos -- "替换为Chrome显示的扩展ID"
```

每一步成功后再继续；之后重新启用扩展，Adapter 有更新时在 Pi 中 `/reload`。移动项目目录或更换扩展 ID、Node 路径后同样需要重新安装；项目移动后还需更新 Pi 的本地安装路径。

卸载前先禁用扩展：

```sh
npm run native-host:uninstall:macos
```

卸载仅移除 Native Host 注册和启动脚本，保留配置，不删除 Chrome 扩展或 Pi Adapter。该流程尚未经过真实 Mac 验证，不应将安装脚本提供等同于兼容性验证通过。

## 第一次使用

向 Pi 发送：

```text
使用 AgentSurf 打开 https://example.com，读取页面正文，并告诉我页面标题和链接。
```

推荐的只读调用流程：

1. `browser.list_tabs`：了解当前标签页，避免覆盖用户正在使用的网页。
2. `browser.open`，参数 `{"url":"https://example.com","activate":true}`：新建页面，取得返回的 `tab_id`。
3. `browser.get_page_state`，传入该 `tab_id`：确认页面 URL 和加载状态；如果仍在加载，稍后再读取。
4. `browser.get_accessibility_tree`，传入同一 `tab_id`：读取页面可访问文本和链接结构。

**`browser.get_page` / `browser.get_page_state` 返回页面元信息，不是网页正文抓取工具。打开网址用 `browser.open`，没有 `browser.navigate`。**

其他示例：

```text
使用 AgentSurf 列出当前 Chrome 的标签页。
使用 AgentSurf 查看当前页面有哪些可交互元素，先不要点击。
使用 AgentSurf 截取当前页面并描述页面状态。
```

元素操作前先调用 `browser.get_interactives`，点击和填写使用它返回的 `element_id`，不得自行编造 CSS Selector、XPath 或元素 ID。页面更新导致 ID 失效时，重新获取交互元素。

## 更新重启与移动目录

### 按修改范围更新

| 修改范围 | 生效步骤 |
| --- | --- |
| Chrome 扩展代码或 Native Host JS | 重新构建，再重新加载扩展，让新 Host 启动 |
| Native Host 安装脚本或启动器 | 禁用扩展，构建并重新安装 Native Host，再启用扩展 |
| Pi Adapter | 在 Pi 中 `/reload` 或重启 Pi |
| 项目路径或扩展 ID | 重新注册 Native Host；路径变化时还需更新 Pi 的本地安装路径 |

只改源码不会更新 `dist/`；只执行构建不会重新生成已安装的 `native-host.exe`；已经启动的 Host 也不会自动加载新的 JS。

### 完整更新流程（Windows）

macOS 使用上方 Mac 章节中的更新命令。以下 Windows 流程中，不确定本次更新涉及哪一层时，使用以下流程：

1. 在 `chrome://extensions` 暂时禁用 AgentSurf，等待旧 Native Host 退出。
2. 在项目实际目录执行：

   ```powershell
   git pull
   npm install
   npm run build
   $extensionId = "替换为Chrome显示的扩展ID"
   npm run native-host:install -- -ExtensionId $extensionId
   ```

   每一步成功后再继续。如存在本地未提交修改，先妥善处理，不要用强制重置覆盖它们。

3. 重新启用 AgentSurf，在 `debug.html` 确认连接状态。
4. 如 Pi Adapter 有更新，在 Pi 中执行 `/reload` 或重启 Pi。本地路径未变化时无需再次 `pi install .`。
5. 用“第一次使用”中的只读流程检查连接和页面读取。

如果只是连接临时异常、没有更新代码，可以先在调试页 Disconnect / Connect，或重新加载扩展，无需每次重新构建安装。

### 移动目录或更换扩展 ID

以下 `native-host:install` 在 macOS 对应 `native-host:install:macos`，参数形式见 Mac 安装章节。

Native Host 启动器引用项目中的 `dist/native-host/host.js`。移动或重命名项目后：

1. 禁用旧扩展，在新目录安装依赖并构建。
2. 在 Chrome 中加载新目录的 `dist/`，取得当前扩展 ID。
3. 在新目录重新执行 `native-host:install`。
4. 用 `pi list` 确认旧安装路径并移除失效项，再在新目录执行 `pi install .`。
5. 重新加载扩展及 Pi。

仅扩展 ID 变化时，也必须使用新 ID 重新注册 Native Host。

## 常见问题与排障

| 现象 | 含义与处理方向 |
| --- | --- |
| `Chrome Extension is not connected` | Bridge 能响应，但没有可用扩展连接。检查调试页状态、Native Host 握手，以及源码、构建产物、已安装启动器是否同步。 |
| 连接被拒绝 / `ECONNREFUSED` | 目标端口没有可用监听。确认扩展已启用、Native Host 已安装并启动。 |
| `EADDRINUSE` | Bridge 端口被占用。排查误启动的独立 Bridge、旧 Host 或其他 Chrome 配置中的扩展实例。 |
| `tool is unsupported` | 工具名不受当前运行时支持。对照工具列表或 `browser.get_capabilities`，不要直接重装扩展。 |
| 安装时 `native-host.exe` 被占用 | 先禁用扩展并等待旧 Host 退出，再安装。不要结束所有 `node.exe`，以免影响其他项目。 |
| Native Host 找不到或禁止访问 | 检查 Native Host 注册、启动器路径，以及安装时填写的扩展 ID 是否与当前一致。 |
| `unsupported_page` | Chrome 不允许在该页面注入 Page Agent。换普通 HTTP/HTTPS 页面。 |
| `screenshot_unavailable` | 默认可视区域截图要求目标是所在窗口的活动标签页；截图期间也不能切换目标或改变 revision。 |

定位顺序：

1. 查看 `chrome://extensions` 中的启用状态和扩展错误。
2. 查看 `debug.html` 的连接状态及连接、请求、响应事件。
3. 必要时打开扩展 Service Worker 检查窗口查看 Native Messaging 错误。
4. 检查端口对应进程，区分 Native Host 和独立 Bridge。不要仅因端口有监听就认定 Chrome 已连接。

Mac 额外检查：manifest 是否安装在当前用户的 Google Chrome 目录、`native-host.sh` 是否可执行，以及其中引用的 Node 和 Host 路径是否仍存在。安装脚本设置执行权限；Node 路径变化时重新安装，不要用 `sudo` 混用用户目录。

Mac 默认端口可用 `lsof -nP -iTCP:8765 -sTCP:LISTEN` 查看。Windows 默认端口可用以下只读 PowerShell 命令检查：

```powershell
Get-NetTCPConnection -LocalPort 8765 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

一次成功列出标签页只能证明当时链路可用，不能证明长时间运行和重连都稳定。分享日志前移除认证信息和敏感页面数据。

## 工具速查

| 目的 | 工具 |
| --- | --- |
| 查询能力 | `browser.get_capabilities` |
| 标签页管理 | `browser.list_tabs` / `browser.open` / `browser.switch_tab` / `browser.close_tab` |
| 前进、后退、刷新 | `browser.back` / `browser.forward` / `browser.reload` |
| 页面元信息 | `browser.get_page` / `browser.get_page_state` |
| 可访问文本与结构 | `browser.get_accessibility_tree` |
| 交互元素快照 | `browser.get_interactives` |
| 组合观察、截图 | `browser.observe` / `browser.screenshot` |
| 元素点击与输入 | `browser.click` / `browser.double_click` / `browser.type` / `browser.press` |
| 表单状态 | `browser.set_checked` / `browser.select_option` |
| 元素拖动与等待 | `browser.drag` / `browser.wait_for_element` |
| 滚动 | `browser.scroll` / `browser.scroll_at` |
| 坐标操作 | `browser.mouse_move` / `browser.click_at` / `browser.drag_at` |
| 键盘、文本、对话框 | `browser.press_key` / `browser.type_text` / `browser.handle_dialog` |
| 下载与上传 | `browser.list_downloads` / `browser.wait_for_download` / `browser.set_files` |
| 会话与标签页归属 | `browser.start_session` / `browser.end_session` / `browser.name_session` / `browser.claim_tab` / `browser.release_tab` |
| 调试器与 CDP | `browser.attach_debugger` / `browser.detach_debugger` / `browser.cdp` / `browser.get_cdp_events` |

具体参数以 `src/core/protocol/tool-contract.ts` 和 `src/core/protocol/schemas.ts` 为准。工具名和参数不可仅凭其他浏览器工具的命名习惯猜测。

## 安全使用边界

AgentSurf 可以操作当前 Chrome 登录态中的页面，CDP、上传等工具具有较强能力。建议在 Agent 的使用规则中明确：

- 默认只读；提交、保存、删除、发布、上传或发送消息等修改线上数据的操作，先取得用户明确授权。
- 登录由用户自行完成；不索取密码、验证码，不读取或输出 Cookie、Token 等认证信息。
- 不将本机 `config.json`、认证 token 或敏感页面数据提交到仓库或粘贴到聊天中。
- 不向外网暴露 Bridge，不将认证 token 当作普通调试文本传播。

以上是 **Agent 使用约束**，不表示运行时已经实现所有操作的人工审批。调用方仍需管理授权边界。

## 开发与调试

### 构建和验证命令

| 命令 | 用途 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run build` | 生成 Chrome 扩展及 Native Host 构建产物 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | Vitest 单元测试 |

### 扩展调试页

打开 `chrome-extension://<扩展ID>/debug.html`。调试页使用与 Pi Adapter 相同的 `browser.*` Tool Protocol，支持查询标签页、页面状态、交互元素、点击、输入、滚动和截图。

- 先在下拉框选择普通 HTTP/HTTPS 页面；工具会显式传入目标 `tab_id`，读取页面无需切换离开调试页。
- 元素操作先 Get interactives，再使用返回的 `element_id`。
- 默认截图要求目标标签页在其窗口中处于活动状态。可把调试页移到第二个 Chrome 窗口，避免调试页占用目标的活动位置。
- 截图输出会缩略展示 Data URL，不要把完整图像数据写入常规日志。

### 独立 Bridge（仅协议开发）

`npm run bridge` 启动的是独立 Bridge，**不会自动获得当前 Native Messaging 扩展的控制能力**，需要兼容的扩展 WebSocket 客户端。不要用它替代正常的 Native Host 启动流程，也不要与 Native Host 占用同一端口。

`npm run bridge:dev` 会先构建再启动独立 Bridge。可通过 `BROWSER_BRIDGE_PORT` 和 `BROWSER_BRIDGE_TOKEN` 设置端口和认证 token；未设置 token 时会生成随机值并输出到终端，注意不要分享该输出。

## 外部调用协议

这一节面向自行开发 Adapter 的调用方。Pi 日常使用无需手工处理认证和消息封装。

Agent 连接 Native Host 启动的本机 Bridge，第一条 WebSocket 消息为认证握手：

```json
{"type":"auth","role":"agent","token":"<本机配置中的token>"}
```

认证成功：

```json
{"type":"auth_result","ok":true,"role":"agent"}
```

随后发送工具请求；外部协议不包含扩展内部使用的 `kind` 字段：

```json
{
  "protocol_version": "1",
  "request_id": "req_123",
  "tool": "browser.get_page_state",
  "args": { "tab_id": 123 }
}
```

成功响应结构：

```json
{"request_id":"req_123","ok":true,"result":{}}
```

失败响应结构：

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

Bridge 按 `request_id` 转发响应；超时、扩展断开或 Bridge 停止时会清理待处理请求并返回结构化错误。未认证消息或错误认证不会执行浏览器工具。Native Host 与扩展之间使用 Chrome Native Messaging framing，由 Chrome 校验 `allowed_origins`，不再重复发送 Bridge token。

开发脚本 `scripts/call-tool.mjs`（`npm run bridge:call`）可模拟外部 Agent，通过 `BROWSER_BRIDGE_URL` 和 `BROWSER_BRIDGE_TOKEN` 配置连接。调用方应在本机安全加载凭据，不要将实际 token 写进文档、命令示例或提交记录。

## 项目结构与实现说明

| 路径 | 职责 |
| --- | --- |
| `integrations/pi/` | Pi Agent Adapter |
| `src/core/` | 与 Chrome API 无关的工具契约、参数校验和 Runtime 调度 |
| `src/chrome/` | Chrome API、CDP、下载与会话协调 |
| `src/content/` | Page Agent、元素注册与可视化 Agent 光标 |
| `src/transport/` | Native Messaging 和工具传输协议 |
| `src/bridge/` | 本机 WebSocket Bridge |
| `src/native-host/` | Native Host、配置和消息 framing |
| `src/debug/` | 扩展调试页 |
| `scripts/` | 构建、安装与开发调用脚本 |
| `tests/` | 测试代码 |

### 页面 revision 与元素 ID

Page Agent 为每个 Document 生成独立 revision。导航、刷新以及重要 DOM 变化会更新 revision；`browser.get_page_state` 的 `revision_reason` 返回 `navigation`、`refresh` 或 `important_dom`。

MutationObserver 不监听所有文本变化，只筛选交互元素增删、已注册元素关键属性变化和单批大型结构变化，单批至多推进一次 revision。普通文本或少量非交互节点变化不会更新 revision。

`browser.get_interactives` 返回 `tab_id`、`page_revision`、`snapshot_id` 和元素数组，包含角色、标签、可访问名称、状态及坐标等信息，不返回 CSS Selector 或 XPath。密码输入仅返回 `value_state: "redacted"`。

`element_id` 是不透明标识，仅能在生成它的标签页和 revision 内使用；DOM 引用只保存在 Content Script 中。元素操作会检查 ID、revision、连接状态、可见性以及 disabled/editable 状态。动作结果会提示是否建议重新获取交互元素。

### 截图、光标与文件

默认可视区域截图使用 `chrome.tabs.captureVisibleTab`，支持 PNG/JPEG；目标必须是所在窗口的活动标签页，截图过程中活动目标或 revision 变化会导致失败。高级截图参数见工具契约。运行时不会为了默认截图自动切换标签页。

坐标操作和元素级操作会在目标页面显示短暂的 `AI` 光标标记。标记不参与页面交互，不会被 `get_interactives` 返回，也不会改变 revision。

`browser.set_files` 接收目标 `tab_id`、文件输入的 `element_id` 及本机绝对路径数组，通过临时内部标记和 CDP `DOM.setFileInputFiles` 设置文件，随后清理标记。

`browser.list_downloads` 使用 Chrome Downloads API。Chrome 不提供历史下载的来源标签页，无法可靠关联的记录返回 `tab_id: null`。
