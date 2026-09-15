# AgentSurf 浏览器工具链：改造与验证报告

记录一次针对「用 AgentSurf 替代 chrome-devtools MCP」的改造、验证与遗留缺口。所有标注为**实测**的结论都在本机真实链路上跑过；标注为**推断**的只读过代码，未验证。

- 验证环境：macOS，Chrome 153.0.8010.36，Node v24.14.1（nvm），npm 11.11.0
- 起点提交：`ac4d9ed`
- 终点提交：`313c6bb`（撰写时的主干末端；本文档描述的改动共 11 个提交）
- 验证客户端：pi（`pi-mcp-adapter` v2.34.0，stdio MCP）

## 结论摘要

按「读页面 / 点按 / 填表单、截图看图、看 console、看 network、登录态自动化」五项需求，**4.5 / 5 达成**。

| 需求 | 状态 | 验证方式 |
| --- | --- | --- |
| 读页面、点按、填表单 | 达成 | pi 中 `get_interactives → click` 触发真实跳转 |
| 截图看图判断 | 达成 | pi 中模型能读出图上的文字内容 |
| 看 console 报错 | 达成 | 本地测试页 9 条 + Google 生产页 2 条，含堆栈 |
| 看 network **请求** | 达成 | 重定向链、子资源、传输失败、慢请求均可见 |
| 看 network **响应体** | **未达成** | 仅有元数据，无响应内容 |
| 登录态自动化 | 达成 | Google Search Console 全链路实测 |

**可以替代 chrome-devtools 的场景**：日常网页操作与排错。且更优——AgentSurf 复用用户现有 Chrome 登录态，而 chrome-devtools 自行拉起独立 profile，没有登录态。

**不能替代的场景**：网络响应体、性能 trace、内存堆快照、Lighthouse。这些要么未实现，要么受 `chrome.debugger` 的结构性限制。

## 改动清单

### `bb1cd82` 修复 Native Host 启动即崩（阻断性）

**现象**：Native Host 一启动就退出，Bridge 从未监听端口，扩展永远连不上。

```
Error: Dynamic require of "events" is not supported
  at node_modules/ws/lib/websocket.js
```

**根因**：Host 的 bundle 按设计必须自包含（安装时会被放到用户运行目录，无法从 `node_modules` 解析依赖），因此 `ws` 被打包进来。但输出格式是 `esm`，而打包进的 `ws` 是 CommonJS，其中对 Node 内置模块的 `require()` 被 esbuild 转成 `__require` 垫片，在 ESM 下直接抛错。

这是 `ac4d9ed` 引入的回归：该提交把 `native-host/host` 从带 `packages: 'external'` 的构建块中拆出，单独成块，但未处理格式问题。

**影响范围**：**所有平台**，不止 macOS。README 中的 Windows 安装流程在同一提交上同样不可用。

**修法**：在 native-host 的 esbuild 配置中通过 `banner` 注入真实的 `require`。只有 Node 内置模块会被动态 `require`，bundle 仍保持自包含，无需改动任何安装路径。

### `a130478` 截图改为 MCP image content，并保住后台标签页截图

**问题一**：所有工具一律返回 `{type:'text', text: JSON.stringify(result)}`，而截图结果是完整 base64 data URL。

实测代价：一个几乎空白的页面，视口 3298×1706 PNG，base64 长 60,592 字符，作为纯文本进入上下文约 **15,194 tokens**，且模型**根本看不见图**。

修法：识别 `browser.screenshot` / `browser.observe` 的截图载荷，拆成 image block + 剔除 base64 的文本 block。文本 token 从 ~15,194 降到 **~46**。

**踩坑**：MCP SDK 用 zod 校验 image `data` 必须是裸 base64，而运行时给的是 data URL（带 `data:image/png;base64,` 前缀），直接透传会被 `-32602 Invalid Base64 string` 拒绝。需剥前缀。

同时把 handler 返回类型标注为 `CallToolResult`，顺带修掉该文件里两个**既有**类型错误（`ac4d9ed` 上 `npm run typecheck` 本就失败）。

**问题二**：后台标签页截图失败，报 `The active tab changed during capture.`

**根因**：`src/core/browser-tool-runtime.ts` 在截图**成功之后**又检查 `currentTab.active` 并丢弃结果。但 service worker 永远注入 debugger adapter，实际走的是 CDP `Page.captureScreenshot`——**CDP 不要求标签页激活**。该守卫是给 `captureVisibleTab` 回退路径用的，而那条路径在真实扩展中是死代码；且适配器层已有等价检查并有测试覆盖，所以 runtime 这道是纯重复。

实测对比（同一个后台标签页）：

```
browser_screenshot                      → 失败: The active tab changed during capture.
browser_cdp Page.captureScreenshot      → 45,444 字节合法 PNG, 3298×1658, 非空白
```

**修法**：删除重复守卫，并把「不得截非活动标签页」的契约写到 `ScreenshotAdapter` 接口注释上，避免将来被重新加回。

### `661abb8` 新增 network 与 console 两个可观测性工具

**新增 `browser.get_network_requests`**：监听 `chrome.webRequest`，按 tab 记录方法、资源类型、状态码、缓存状态、耗时与传输错误。

MV3 下 `webRequest` 是只读观测，**不需要 attach debugger，不弹调试横幅**，且无需任何前置操作即可记录。支持 `after_sequence` 增量读取，以及 `type` / `failed_only` 过滤。

**新增 `browser.get_console_messages`**：读取一个由 MAIN world 内容脚本持有的环形缓冲。

**关键约束**：内容脚本默认运行在 isolated world，其 `console` 与页面自身的 `console` 是两个不同对象——在 isolated world 劫持 `console` 只能捕获我们自己的输出。因此采集器必须运行在 **MAIN world**（`manifest` 中 `"world": "MAIN"`，Chrome 111+），并在 `document_start` 注入，再通过 `window.postMessage` 桥接回 isolated world 的 Page Agent。

覆盖 `console.*`、未捕获异常、未处理的 Promise rejection，含堆栈。当采集器未运行时返回 `available: false`，**避免把空列表误判为「页面没有报错」**。

**设计取舍**：放弃了「SW 侧缓冲 + 导航追踪 + 按 sequence 去重」方案，改为按需拉取——工具调用触发 SW → 内容脚本 → MAIN world 取回缓冲。完全复用现有 PageAgent 请求/响应管线，省掉 SW 缓冲、导航标记、去重逻辑与内存管理。代价是**跨导航的日志会丢失**。

### `64f0665` 为全部 45 个工具补上可区分的描述

45 个工具中 **29 个**落回通用模板 `Run the AgentSurf browser.X browser operation.`。`tools/list` 是客户端选择工具的唯一依据，这会直接影响选对工具的概率。

重写描述，重点写清名称本身无法传达的陷阱：

- 优先用元素级工具（`click` / `type` / `press`）而非坐标级（`click_at` / `type_text` / `press_key`），因为元素级会校验元素仍可见、可用且处于当前 page revision
- `scroll` 滚动文档，`scroll_at` 滚动光标下的嵌套容器
- `browser.cdp` 与 `browser.screenshot` 会自行 attach debugger
- `attach_debugger` 会弹出调试横幅，且与用户自己的 DevTools 冲突
- session 类工具是可选的，不传 `session_id` 也能直接操作任意 `tab_id`

**防复发**：描述表类型由 `Partial<Record<ToolName, string>>` 改为 `Record<ToolName, string>`，删除 fallback。少写一个描述就编译不过。

### `07c6cca` 修复按键事件字段不完整，恢复 Enter / Tab 的默认行为

**现象**：在文本输入框上按 Enter **不会提交表单**，按 Tab **不会移动焦点**。每一个搜索框、登录表单都依赖前者。

**根因**：`browser.press` 与 `browser.press_key` 只传 `key`，其余字段全空：

```
修复前: { key: "Enter", code: "",      keyCode: 0 }
修复后: { key: "Enter", code: "Enter", keyCode: 13, which: 13 }
```

两条路径各有不同的问题：

- **`press_key`（CDP）**：CDP 产生的是**可信事件**，但 Chrome 只有在收到 Windows virtual key code 时才会执行默认动作，所以 Tab 无效。
- **`press`（元素级）**：合成 `KeyboardEvent` 是 `isTrusted: false`，**浏览器根本不会为它执行任何默认动作**。原有实现只对 Enter/空格 + 可键盘点击元素做了 `element.click()` 兜底，因此按钮可用而**输入框不可用**。

**修法**：新增共享按键表（`src/core/key-descriptors.ts`），两条路径共用。元素级 `press` 额外复现隐性表单提交（传递默认提交按钮，使其 name/value 被包含），并继续跳过 textarea（Enter 在其中有换行语义）。

**验证**：Enter 提交后表单进入已提交状态；Tab 使焦点从 `name` 移到 `notes`；`code` / `keyCode` / `which` 字段完整；可打印字符仍能正常输入（实测输入得到 `ABCZ`）。

**注意**：Tab 焦点遍历**只在标签页为活动标签页时生效**。后台标签页接受程序化 `focus()`，但不执行焦点遍历（这一点在测试中一度被误判为 bug）。

### `2a735f5` 让 MCP 层能携带 session，使标签页归属真正生效

**现象**：两个对话同时操作浏览器时，一个对话认领的标签页，另一个对话照样能读写。

**根因**：`session_id` 位于**请求根字段**（`parseToolRequest` 读 `input.session_id`，`assertSessionAccess` 也用它），但 MCP 层只发送 `{protocol_version, request_id, tool, args}`，**从不发根级 `session_id`**；工具 schema 里也只有 session 类工具把 session_id 当 args。

结果是 **“认领”给了虚假的安全感**：`claim_tab` 确实会拒绍对方，但对方可以直接绕过去继续操作同一标签页。

**为何不能靠进程隔离**：实测 MCP server 的父进程是 `pi`（祖父为 PiDeck.app），即**一个 pi 进程只拉起一个 MCP server，多个对话共用同一条 stdio 连接**。所以“每连接会话状态”不可行，必须走 per-call。

**修法**：所有工具统一接受可选 `session_id`，由 MCP 层转发到请求根。工具自己声明的 `session_id` 保留更严格的 schema（展开顺序上自己的定义在最后）。runtime 侧无需修改。

**验证**：两个独立 MCP 客户端，A 认领后 B 在读取、列网络请求、认领三个动作上均被拒（`tab_in_use`）；A 自己正常；匿名单 agent 模式不受影响；释放后交接正常。

**使用要点**：隔离是**协作式**的——必须在每次调用都带 `session_id` 才生效。不传即跳过所有归属检查（单 agent 模式）。

### 多会话并发（真实交错操作）

两个独立 MCP 客户端各自建会话，**交错执行真实操作**（A 输入 → B 输入 → A 选择 → B 选择 → 分别提交），验证彼此不串扰：

```
对话A 页面: {"who":"AAA-from-对话A","plan":"alpha"}
对话B 页面: {"who":"BBB-from-对话B","plan":"beta"}
```

| 项 | 结果 |
| --- | --- |
| 各自认领 + 建立独立标签分组 | ✓ 两个不同的 `group_id`（可见的蓝色分组，标题为会话名）|
| 交错操作互不干扰 | ✓ 两边内容完全独立 |
| B 在 A 操作过程中插手 | ✓ 读取与点击均被拒 `tab_in_use` |
| 从已持有标签页开 `target=_blank` | ✓ 新标签页自动归该会话（`origin: child`），无需 claim |
| 子标签页对另一会话 | ✓ 不可用，也无法抢走 |
| 会话关闭 | ✓ `close_tabs` 回收标签页 |

**验证细节**：子标签页测试特意比对了点击前后的标签页 id 集合，确认新标签页 id（`1445892243`）与父标签页（`1445892240`）不同——否则会因“导航了已有标签页”而假通过。

**两种自动归属路径**（`src/core/browser-tool-runtime.ts`）：

- `browser.open` 带 `session_id` 时，结果标签页以 `origin: 'agent'` 自动认领（新建时才建分组）
- 从已持有标签页开出的新标签页，经由 `chrome.tabs.onCreated` + `openerTabId` 以 `origin: 'child'` 继承

### `4ffb24c` 为 session_id 的位置加防回归测试

请求根是 `parseToolRequest` 与归属检查读取的位置，而 `claim_tab` 从 args 读取。两者任一环节错位都会静默关掉隔离。测试覆盖根级位置、不传时字段不存在、以及 session 类工具仍能在 args 里找到它。

## 验证证据

### 链路

```
MCP Client (pi) → MCP Server (stdio) → Bridge (ws 127.0.0.1:8765)
  → Native Host → Chrome 扩展 → Chrome API / Page Agent
```

45 个工具在 pi 中全部暴露为 `agentsurf_browser_*` 并可调用。

### 表单操作（核心能力）

在一个包含全部表单控件的本地页面上走完整条操作链，**提交后读取页面真实状态**验证：

```json
{"name":"张三","notes":"hello from agent","agree":true,
 "plan":"pro","planMulti":["a","c"],"color":"green"}
```

| 操作 | 工具 | 结果 |
| --- | --- | --- |
| 文本输入（含中文） | `browser_type` | `name` 为 `张三` || 多行文本 | `browser_type` | textarea 写入成功 |
| 复选框 | `browser_set_checked` | `agree: true` |
| 单选组 | `browser_set_checked` | `color: green`，且 Red 自动变 `false`（互斥正确） |
| 单选下拉 | `browser_select_option` | `plan: pro` |
| 多选下拉 | `browser_select_option` | `planMulti: [a, c]` |
| 按钮提交 | `browser_click` | 表单提交事件触发 |
| 回车提交 | `browser_press` | 表单提交事件触发 |
| **禁用元素** | `browser_type` | **正确拒绝**：`The element is disabled.` |

补充验证：

- `get_interactives` 同步反映状态：`value_state: filled`、`checked: true`、option `selected: true`；`disabled: true` 的元素被正确标记
- 动态元素：页面 1.5 秒后插入的按钮被自动发现
- hover：`browser_mouse_move` 到坐标后，CSS `:hover` 菜单真的展开（截图确认，并可见 AI 代理光标）
- `browser_drag_at`：`drop` 事件**确实触发**，但 `dataTransfer` 为空（合成拖拽没有 `dragstart` 数据），依赖 `getData()` 的应用会拿到空值
- `browser_wait_for_element`：`state: visible` 正确返回
- `browser_scroll`：在内容不足一屏的页面上返回 `near_top` / `near_bottom` 均为 `true`（正确，但未验证到实际滚动）

### 截图

| 项 | 结果 |
| --- | --- |
| 返回结构 | `[image block, text block]`，文本中无 base64 |
| 文本 token 成本 | 15,194 → **46** |
| 后台标签页（`activate: false`） | 成功，45,444 字节合法 PNG |
| pi 中渲染 | **成功，模型能读出图上的文字内容** |
| 回归 | 活动标签页截图、`full_page` 均正常 |

### console

本地 HTTP 测试页，9 条全部捕获：

```
[1] log   console              hello from page
[4] error console              error message
[5] log   console              {a: 1, b: [1, 2, 3], nested: {deep: {deeper: {x: 1}}}}   4 层序列化
[6] log   console              <div#app.c1.c2>                              DOM 节点降级
[7] log   console              repeated args 42 true null undefined
[8] error unhandledrejection   Unhandled rejection: Error: rejected boom   + 堆栈
[9] error exception            Error: uncaught boom                        + 堆栈
```

过滤与增量：`levels:['error']` → 3 条；`after_sequence` 增量读取无重复。

真实生产页面（Google Search Console）捕获到 Google 自身代码的输出，证明补丁在复杂 SPA 上有效，而非仅适用于测试页。

### network

| 场景 | 结果 |
| --- | --- |
| 简单页面 | 1 条 `main_frame` 200，9ms |
| 失败请求 | `.invalid` 域名 → `net::ERR_CONNECTION_CLOSED` |
| 真实重页面（MDN 首页） | 69 条：stylesheet 20 / script 23 / image 15 / font 4 / xhr 2 / ping 3 / other 1 |
| 点击后跳转 | 完整重定向链 + 子资源 + `net::ERR_CACHE_MISS` + 1203ms 慢字体 |

上下文成本（MDN 首页）：

```
全量 limit=1000        20,652 字符 ≈ 5,163 tokens
type=xmlhttprequest       562 字符 ≈   141 tokens
```

结论：全量拉取噪音明显，`type` / `failed_only` 过滤对控制上下文成本是必要的。

### 登录态

以用户已登录的 Google Search Console（某个已验证资源）为对象，只做只读操作：

1. **未被重定向到登录页**——`get_page_state` 返回的 URL 与标题是 Search Console 本身
2. **捕获到只有登录态才存在的请求**：Google 账号头像图片、`search.google.com/.../data/batchexecute` 数据 RPC（POST 200）、`ogads-pa.clients6.google.com/.../GetAsyncData` 账号数据 RPC、`accounts.google.com/RotateCookiesPage` cookie 轮换
3. **视觉确认**：截图显示 Search Console 已登录界面，含资源选择器、账号头像与真实渲染的性能图表

**结论：登录态复用确认可用**，这是相对 chrome-devtools 的结构性优势。

## 与 chrome-devtools MCP 的对比

| 维度 | AgentSurf | chrome-devtools |
| --- | --- | --- |
| 浏览器实例 | 用户现有 Chrome | 自行拉起，独立 profile |
| 登录态 | **有** | 无 |
| 多会话标签页隔离 | 有，但需每次调用显式传 `session_id` | 无此概念 |
| 用户当前标签页 | 直接可用 | 不可见 |
| 元素模型 | `get_interactives` → 不透明 `element_id` | `take_snapshot` → uid || console | 有（MAIN world 补丁） | 有（CDP） |
| network 元数据 | 有（`webRequest`） | 有（CDP） |
| network 响应体 | **无** | 有 |
| `browser.scroll` / `scroll_at` | 仅像素增量。页面内容不足一屏时无滚动，返回的 `near_top`/`near_bottom` 同时为 `true` |
| 性能 trace | 无（且 1000 条事件缓冲会截断，**推断**） | 有 |
| 堆快照 / Lighthouse | 无 | 有 |
| 与用户 DevTools 冲突 | **会**（`chrome.debugger` 独占） | 不会 |
| 调试横幅 | **会**（碰 CDP 时） | 不会 |

## 已知边界

### 未实现

- **network 响应体**：仅有元数据。读取响应内容需 `browser.cdp` + `Network.getResponseBody`，会 attach debugger 并弹横幅。
- **性能 trace / 堆快照 / Lighthouse**：完全未实现。
- **network 响应体之外的 CDP 高级能力**：需手工拼 `browser.cdp`。

### 设计上的固有代价

- **console 跨导航丢失**：按需拉取方案的代价。页面刷新或跳转后缓冲重置，无法回溯「上一次加载时报的错」。
- **页面可检测 console 补丁**：MAIN world 脚本，加固站点可能识别被改写的 `console`。
- **worker 与 iframe 未覆盖**：采集器只注入顶层 frame。`page-agent.js` 本身也不带 `all_frames`，保持一致。
- **网络缓冲随 SW 重启清空**：MV3 service worker 被回收后内存缓冲丢失。
- **console 序列化有损**：深度上限 4、单条消息上限 2000 字符、DOM 节点降级为标签名、对象键上限 20。
- **`chrome.debugger` 独占**：同一标签页已有 DevTools 时 attach 失败。
- **错误码在 MCP 边界被丢弃**：底层 `{code, retryable, details}` 只剩一句文字。`stale_element` / `tab_in_use` / `tab_not_found` 在 MCP 层无法区分，agent 不能据此决定“刷新交互元素重试”还是“放弃”。**未修复**。
- **会话隔离是协作式的**：必须每次调用都传 `session_id`。不传即跳过归属检查（单 agent 模式），因此一个带 session 的对话与一个不带的对话之间没有隔离。
- **按键不支持修饰键组合**：`press` / `press_key` 的参数只有单个 `key`，没有修饰键字段，因此 Cmd+A、Ctrl+Enter 这类组合无法发送。
- **拖拽不携带 `dataTransfer` 数据**：`drop` 事件会触发，但 `dataTransfer.getData()` 返回空。
- **Tab 焦点遍历只在活动标签页生效**：后台标签页接受程序化 `focus()`，但不执行焦点遍历。
- **受保护页面无法注入**：`chrome://` 等页面不能注入 Page Agent。

### 仅读代码推断、未实测

- 性能 trace 会被 `get_cdp_events` 的 1000 条/tab 缓冲截断（`Tracing.dataCollected` 数量远超此上限）。
- 后台标签页截图**非空白且格式合法**已实测，但**未证明是实时渲染帧而非合成器缓存帧**。
- 事件只在 debugger 已 attach 的标签页上缓冲（`debugger-adapter.ts` 中的提前返回），因此无法获取 attach 之前发生的 console / network 事件。

### 仓库既有问题（未修改）

- `npm run lint` 存在一个既有错误：`src/chrome/scripting-adapter.ts` 中的 `import()` 类型注解（`@typescript-eslint/consistent-type-imports`）。非本次改动引入。

## 运维注意事项

1. **改动 `manifest.json` 或 service worker 后必须重新加载扩展**，否则改动不生效。仅改 MCP 层不需要。
2. **pi 的 MCP 配置使用绝对路径**（`~/.pi/agent/mcp.json` 指向 `dist/mcp/cli.js`），移动或重命名项目目录会失效。原文件备份为 `mcp.json.bak-agentsurf`。
3. **`npm run build` 才能更新 `dist/`**；Chrome 加载的是 `dist/`，不是源码目录。
4. **Native Host 启动器记录了安装时的 Node 绝对路径**（`~/Library/Application Support/BrowserControlRuntime/native-host.sh`）。通过 nvm 等切换 Node 版本后需重新运行安装脚本。
5. **`chrome.debugger` attach 期间建议关闭 DevTools**，否则会因「已有调试器」而失败。
6. 为接入 network 观测，`manifest.json` 新增了 `webRequest` 权限。

## 复现验证的方法

```sh
npm install
npm run build
npm run native-host:install:macos -- "<Chrome 显示的扩展 ID>"
```

在 `chrome://extensions` 加载 `dist/` 并取得扩展 ID，随后：

```
chrome-extension://<扩展 ID>/debug.html
```

连接状态应为 `connected`。

- `npm run typecheck`：应通过
- `npm test`：应 82 项全通过
- `npm run lint`：仅剩 `src/chrome/scripting-adapter.ts` 的既有错误

四条最有价值的验证（均已在 pi 中跑过）：

1. **截图**：`browser_screenshot` 应返回 image block，且客户端能渲染
2. **后台截图**：用 `activate: false` 打开页面后截图，应成功
3. **登录态**：对任一需登录的站点调用 `browser_get_page_state`，URL 不应跳转到登录页
4. **回车提交**：在文本输入框上 `browser_press` 一个 `Enter`，表单应被提交
