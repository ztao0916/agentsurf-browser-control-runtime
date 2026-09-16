# AgentSurf 深入参考

**中文** ｜ [English](reference.en.md)

本文是 [README](../README.md) 的深入部分：工具速查、错误码、开发调试、外部协议与实现细节。**安装和日常使用请看 [README](../README.md)。**

## 目录

- [1. 工具速查](#1-工具速查)
- [2. 错误码与重试语义](#2-错误码与重试语义)
- [3. 开发与调试](#3-开发与调试)
- [4. 外部调用协议](#4-外部调用协议)
- [5. 实现细节](#5-实现细节)

## 1. 工具速查

共 **30** 个工具。

| 目的 | 工具 |
| --- | --- |
| 标签页管理 | `browser.list_tabs` / `browser.open` / `browser.switch_tab` / `browser.close_tab` |
| 子框架 | `browser.get_frames`（配合各工具的 `frame_id`） |
| 导航 | `browser.back` / `browser.forward` / `browser.reload` |
| 页面元信息 | `browser.get_page` |
| 正文 | `browser.get_page_content` |
| 交互元素 | `browser.get_interactives` |
| 组合观察 / 截图 | `browser.observe` / `browser.screenshot` |
| 元素点击与输入 | `browser.click` / `browser.double_click` / `browser.type` / `browser.press` |
| 文本选择 | `browser.select_text` |
| 表单 | `browser.set_checked` / `browser.select_option` |
| 元素拖拽与等待 | `browser.drag` / `browser.wait_for_element` |
| 滚动 | `browser.scroll` |
| 对话框 | `browser.handle_dialog` |
| 下载与上传 | `browser.list_downloads` / `browser.wait_for_download` / `browser.set_files` |
| Console | `browser.get_console_messages` |
| 会话与标签页归属 | `browser.claim_tab` / `browser.reset_sessions`（收尾：解除分组 + 关掉本对话自己开的页签） |

> `browser.start_session` 仍在协议里（脚本、外部客户端可用），但**不作为 MCP 工具暴露**：MCP Server 会为每个对话自动建立会话，见 [README 第 6.5 节](../README.md#65-多对话并行默认自动隔离)。

补充说明：

- 支持 `modifiers: ["Alt"|"Control"|"Meta"|"Shift"]` 的工具：`browser.press`、`browser.click`、`browser.double_click`；
- `browser.open` 与 `browser.claim_tab` 接受可选的 `name`（**会话分组名**，建议 12 字以内）：它决定该会话 Chrome 分组的标题，由 Agent 按对话主题填写；省略时用被接管页签的标题兜底（加载中标题即 URL 时改用域名），再退到 `AgentSurf`；
- `browser.reset_sessions` 可选 `close_opened_tabs`（**默认 `true`**）：除解除分组外，还关掉**本对话自己 `open` 出来的**页签——判据是租约的 `origin` 为 `agent`，因此用户原本就开着的页签（`origin: user`）永远不会被关。传 `false` 则只解除分组；结果里的 `closed_tab_ids` 列出被关掉的页签。`force: true` 只解除分组、**不关任何页签**；
- 支持 `frame_id` 的工具：`browser.get_page`、`browser.get_interactives`、`browser.get_page_content`、`browser.get_console_messages`，以及所有元素级动作（`click` / `double_click` / `type` / `press` / `select_text` / `set_checked` / `select_option` / `drag` / `wait_for_element` / `set_files`）；
- `browser.get_interactives` 支持 `limit`（默认 **150**）、`visible_only`、`tag`、`role`、`name_contains`。**过滤与截断在页面内完成**，结果里始终给出 `total` 与 `truncated`。实测：某重页面 665 个元素，仅靠默认上限就从 ~66,800 tokens 降到 ~15,100，用 `visible_only: true` 降到 ~380；
- **`truncated: true` 意味着列表不完整**，不能据此判定「页面上没有这个元素」，应该用过滤器缩小范围（而不是把 limit 调大）；
- **`visible_only` 默认 `false` 是故意的**：折叠面板、未激活 tab、以及**悬停才显形（`opacity: 0`）的按钮**都属于不可见，但 Agent 必须先能发现它们；真去点时仍会由可见性检查把关。注意：**没有坐标级悬停工具**，这类按钮要靠先点击其容器或触发页面自身的交互来唤出；
- **`browser.screenshot` / `browser.observe` 不再因页面变化而失败**：live 页面（动画、热更新、轮询）上会带 `page_changed: true` 返回 —— 截图另带 `page_revision_before`（截图开始时的版本），观察另带 `page_revision_after`（页面随后走到到的版本）；页面没变时这两个字段不出现。元素操作仍然严格校验 revision；
- 参数以 `src/core/protocol/tool-contract.ts` 与 `src/core/protocol/schemas.ts` 为准。工具名与参数**不可**按其他浏览器工具的命名习惯猜测。

## 2. 错误码与重试语义

失败响应统一为结构化错误（MCP 层会把同一对象原样放进结果文本）：

```json
{
  "code": "stale_element",
  "message": "The element_id belongs to an older page revision.",
  "retryable": true,
  "details": { "element_id": "el_...", "page_revision": "rev_..._1" }
}
```

Agent 应据此决策，而不是把失败一律当成“重试”：

| code | retryable | 建议动作 |
| --- | --- | --- |
| `stale_element` | ✅ | 重新 `browser_get_interactives` 后重试；若来自 frame，检查 `frame_id` |
| `element_not_found` | ❌ | 元素不存在/选择错误，重新观察页面 |
| `element_not_visible` / `element_disabled` / `element_not_editable` | ✅/❌ | 先滚动或等待元素可用，不要强行操作 |
| `frame_not_found` | ✅ | 重新 `browser_get_frames` 取新 `frame_id` |
| `tab_not_found` | ✅ | 标签页已关闭，重新 `browser_list_tabs` |
| `tab_in_use` | ❌ | 该标签页被其他 session 占用：换一个标签页，或让持有它的对话收尾 |
| `request_timeout` | ✅ | 操作太慢或页面阻塞，必要时增大 `timeout_ms` |
| `unsupported_page` | ❌ | 受保护页面，换普通网页 |
| `screenshot_unavailable` | ✅ | 截图调用失败（降级路径要求目标标签页是活动页）。页面在截图期间变化不再失败，改用 `page_changed` 标注 |
| `bridge_unavailable` / `transport_disconnected` | ✅ | 扩展未连接或通道断开，看 [README 第 8 节](../README.md#8-排障) |
| `authentication_failed` | ❌ | token 不匹配：重新安装 Native Host（会复用 token）或检查 `config.json` |

## 3. 开发与调试

### 3.1 命令

| 命令 | 用途 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run build` | 构建扩展到 `dist/`（含 Native Host bundle） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm test` | Vitest 单元测试 |
| `npm run bridge:call` | 用一个 JSON 请求直连 Bridge（见 [README 第 5.2 节](../README.md#5-验证接入是否成功)） |

`npm run build` 由两部分组成：`scripts/generate-icons.mjs`（图标）与 `scripts/build.mjs`（esbuild 打包扩展、Bridge、MCP Server，以及**自包含**的 Native Host bundle）。

### 3.2 扩展状态页

`chrome-extension://<扩展ID>/debug.html`，也是点工具栏 AgentSurf 图标时弹出的那一页。它**只做一件代码里做不到的事**：告诉你看得见的链路状态，并在断连时能强制重连。

页面上只有：

- 连接状态（`connected` / `connecting` / `reconnecting` / `error` / `disconnected`）与最近的错误文本；
- Host、Endpoint、Pending（含重连次数）；
- `Connect` / `Disconnect` / `Reconnect` 三个按钮；
- 最近 5 条**连接状态与错误**事件（工具调用的请求/响应不进这个列表，否则几次调用就把连接历史冲掉了）；
- `Copy diagnostics`：把状态、扩展版本、浏览器 UA 与最近事件复制到剪贴板，方便直接粘给 Agent 或写进 issue（**不含 token**）。

其余手工工具面板（标签页、元素操作、坐标、截图、文件、CDP、原始报文日志）已经移除：这些都用代码驱动更省事：

```powershell
# 不经 MCP，直接验证链路（见 [README 第 5.2 节](../README.md#5-验证接入是否成功)）
npm run bridge:call -- '{"protocol_version":"1","request_id":"t","tool":"browser.list_tabs","args":{}}'
```

需要看返回结果、批量跑工具或做断点调试时，直接用 MCP 工具或 `scripts/call-tool.mjs`。

### 3.3 独立 Bridge（仅协议开发）

```powershell
npm run bridge        # 启动独立 Bridge
npm run bridge:dev    # 先构建再启动
```

注意：

- 独立 Bridge **不会**自动获得当前 Native Messaging 扩展的控制能力，需要兼容的扩展 WebSocket 客户端；
- 不要用它替代正常的 Native Host 流程，也不要与 Native Host 抢同一个端口；
- 可用 `BROWSER_BRIDGE_PORT` / `BROWSER_BRIDGE_TOKEN` 指定；未指定 token 时会随机生成并打印到终端，**不要分享该输出**。

## 4. 外部调用协议

面向自己写客户端的场景。普通 MCP 用户无需手工处理认证与封装。

第一条 WebSocket 消息必须是认证握手：

```json
{"type":"auth","role":"agent","token":"<本机 config.json 中的 token>"}
```

认证成功：

```json
{"type":"auth_result","ok":true,"role":"agent"}
```

随后发送工具请求（外部协议**不带**扩展内部使用的 `kind` 字段）：

```json
{
  "protocol_version": "1",
  "request_id": "req_123",
  "tool": "browser.get_page",
  "args": { "tab_id": 123, "frame_id": 0 }
}
```

成功响应：

```json
{"request_id":"req_123","ok":true,"result":{}}
```

失败响应：

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

行为约定：

- Bridge 按 `request_id` 转发响应；超时、扩展断开、Bridge 停止都会清理待处理请求并返回结构化错误；
- 未认证或认证失败的消息不会执行任何浏览器工具；
- 根级 `session_id` 用于标签页归属，并且是工具自带 `session_id` 参数省略时的默认值（`browser.claim_tab` 就是如此：显式传入优先，否则用根级；两处都没有才报 `invalid_request`）；
- 与扩展之间使用 Chrome Native Messaging framing，由 Chrome 校验 `allowed_origins`，不再重复传 Bridge token。

开发脚本 `scripts/call-tool.mjs`（`npm run bridge:call`）即按此协议实现，可直接当作参考客户端；它通过 `BROWSER_BRIDGE_URL` / `BROWSER_BRIDGE_TOKEN` 覆盖配置，未设置时自动读本机 `config.json`。

## 5. 实现细节

### 5.1 目录结构

| 路径 | 职责 |
| --- | --- |
| `src/core/` | 与 Chrome API 无关的工具契约、参数校验、Runtime 调度 |
| `src/chrome/` | Chrome API 适配：标签页、CDP、截图、下载、**框架枚举**、会话协调 |
| `src/content/` | Page Agent、元素注册与 revision 追踪、动作执行、Console 采集、Agent 光标 |
| `src/transport/` | Native Messaging、Runtime Message 与工具传输协议 |
| `src/bridge/` | 本机 WebSocket Bridge |
| `src/mcp/` | MCP Server、Bridge 客户端、Native Host 安装 CLI |
| `src/native-host/` | Native Host 入口、配置与 framing |
| `src/debug/` | 扩展状态页（连接状态、重连、诊断导出） |
| `scripts/` | 构建、安装与开发调用脚本 |
| `tests/` | 单元测试 |
| `docs/` | 改造与验证报告 |

### 5.2 页面 revision 与 element_id

Page Agent 为**每个 Document（含每个 frame）**维护独立 revision。导航、刷新与“重要 DOM 变化”会推进 revision，`browser.get_page` 的 `revision_reason` 会说明原因（`navigation` / `refresh` / `important_dom`）。

MutationObserver 只筛选：交互元素增删、已注册元素关键属性变化、单批大型结构变化（每批最多推进一次）。普通文本改动不会推进 revision。

`browser.get_interactives` 返回 `tab_id`、`frame_id`、`page_revision`、`snapshot_id` 与元素数组（角色、标签、可访问名称、状态、坐标），**不返回 selector**；密码输入只返回 `value_state: "redacted"`。

`element_id` 是不透明标识，DOM 引用只存在于 Content Script 内；动作执行前会校验 ID、revision、连接状态、可见性、disabled/editable。因为 documentToken 每个文档不同，**跨 frame 用错 ID 会表现为 `stale_element`**。

### 5.3 frame 路由

- Content Script 以 `all_frames: true` + `match_about_blank: true` 注入，因此 `about:blank` / `srcdoc` 这类同源框架也有 Page Agent；
- 请求通过 `chrome.tabs.sendMessage(tabId, msg, { frameId })` **定向**发送（广播会让多个 Agent 抢答同一响应）；
- 按需注入也用 `scripting.executeScript({ target: { tabId, frameIds: [frameId] } })` 定向；
- MAIN world 的 Console 采集是**尽力而为**：页面 CSP 可能拦掉它，但不会连带让 Page Agent 失效（此时 `available: false`）。

### 5.4 截图、光标、文件

- 截图默认走 CDP `Page.captureScreenshot`，**后台标签页也能截**；只有降级到 `captureVisibleTab` 才要求目标处于活动状态；
- `full_page: true` 取的是**文档**内容尺寸；像外壳型应用那样把滚动放在容器内的页面，返回值可能就等于视口；
- 元素操作会在页面显示短暂的 `AI` 光标标记：不参与交互、不被 `get_interactives` 返回、不改变 revision；
- `browser.set_files` 用临时标记 + CDP `DOM.setFileInputFiles` 设置文件，之后清理标记；非顶层 frame 会在 `pierce` 的节点树里查找该标记。
