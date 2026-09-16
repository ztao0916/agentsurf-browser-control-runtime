# AgentSurf

**中文** ｜ [English](#english)

AgentSurf 是一个让 AI Agent 控制**你自己的本机 Chrome** 的浏览器运行时。它复用你当前 Chrome 的登录态，把页面观察、点击、输入、截图、iframe、Console/Network 观测等能力统一成 `browser.*` 工具，通过本地 MCP Server 暴露给任意支持 MCP 的 Agent。它不内置模型调用、任务规划，也不绑定特定 AI 产品。

AgentSurf is a local Chrome control runtime for AI agents. It drives **the Chrome you already use**, so it keeps your existing logins, and exposes page reading, clicking, typing, screenshots, iframes, and console/network inspection as a uniform set of `browser.*` tools through a local MCP server. It ships no model calls, no task planning, and no vendor lock-in.

> 本项目**不通过 Chrome 应用商店分发**，也没有发布公开 npm 包。接入方式是从源码构建、以「未打包扩展」加载到 Chrome，再在本机注册 Native Host。
>
> This project is **not distributed through the Chrome Web Store** and publishes no public npm package. The supported path is: build from source, load the extension as an unpacked extension, and register the native host locally.

---

<a id="中文"></a>

# 中文文档

## 目录

- [1. 它是什么](#1-它是什么)
- [2. 工作原理](#2-工作原理)
- [3. 接入方案选择](#3-接入方案选择)
- [4. 接入步骤（Windows）](#4-接入步骤windows)
- [5. 接入步骤（macOS）](#5-接入步骤macos)
- [6. 验证接入是否成功](#6-验证接入是否成功)
- [7. 在 Agent 里怎么用](#7-在-agent-里怎么用)
- [8. 更新、移动目录、卸载](#8-更新移动目录卸载)
- [9. 排障](#9-排障)
- [10. 工具速查](#10-工具速查)
- [11. 错误码与重试语义](#11-错误码与重试语义)
- [12. 安全边界](#12-安全边界)
- [13. 开发与调试](#13-开发与调试)
- [14. 外部调用协议](#14-外部调用协议)
- [15. 实现细节](#15-实现细节)
- [16. 当前限制](#16-当前限制)

## 1. 它是什么

一句话：**你的 Agent 想操作网页时，不用自己开一个干净浏览器，而是直接借用你正在用的那个 Chrome。**

它做什么：

- 复用你现有的 Chrome 登录态和标签页，不需要重新登录、不需要导出 Cookie；
- 提供 **47 个 `browser.*` 工具**：标签页、页面读取、元素点击/输入、表单、滚动、拖拽、截图、iframe、Console、Network、下载、文件上传、CDP；
- 元素定位使用**不透明 `element_id`**（不暴露 CSS Selector），动作前会校验元素仍可见、可用、且属于当前页面版本；
- 通过本机 MCP Server 接入，Agent 侧只需要一个 stdio MCP 配置。

它不做什么：

- 不内置任何大模型、不负责规划任务；
- 不提供云端浏览器，所有通信都在 `127.0.0.1`；
- 不绕过验证码、不做反爬对抗。

## 2. 工作原理

```text
        MCP 客户端（你的 Agent）
              │  stdio
              ▼
        AgentSurf MCP Server
              │  WebSocket + token，仅监听 127.0.0.1
              ▼
        本机 Browser Bridge
              │  Native Messaging（stdin/stdout 二进制分帧）
              ▼
        Native Host（native-host.exe / native-host.sh）
              │  chrome.runtime.connectNative
              ▼
        Chrome 扩展（Manifest V3）
              │  chrome.tabs.sendMessage / chrome.debugger / chrome.webRequest
              ▼
        网页（Page Agent Content Script，注入所有 frame）
```

几个关键点：

- **扩展是主动方**：它启动时通过 `connectNative` 拉起 Native Host，Host 再启动 Bridge。所以正常使用**不需要手动运行 `npm run bridge`**。
- **扩展自己不监听任何端口**，Bridge 只监听 `127.0.0.1`，并要求 token 认证（token 由安装脚本随机生成，保存在本机 `config.json`，不需要你复制粘贴到对话里）。
- **MCP Server 与 Native Host 共用同一份本机配置**，所以 MCP 侧不需要手工填 token。
- 只有在“协议开发”场景才需要独立 Bridge，见[第 13 节](#13-开发与调试)。

## 3. 接入方案选择

一共有两条接入路径，按需选一条即可。

### 方案 A：MCP Server（推荐，适用绝大多数 Agent）

Agent ↔ `dist/mcp/cli.js`（stdio MCP Server）↔ Bridge ↔ 扩展。

优点：Agent 侧零协议负担，工具与参数由 MCP 自动暴露。

### 方案 B：自研客户端直接连 Bridge

你的程序 ↔ 本机 WebSocket Bridge（自行完成 `auth` 握手与请求封装）。

适用：非 MCP 的运行环境、自己写调度器、或需要精细控制超时与并发。协议见[第 14 节](#14-外部调用协议)。

> 两种方案都需要先完成下面第 4/5 节的**扩展 + Native Host** 安装，那是所有能力的地基。

## 4. 接入步骤（Windows）

以下命令全部在 **PowerShell** 中执行，并且**在项目根目录**执行。

### 4.1 检查环境

需要：Git、Node.js 20+、npm 10+、Chrome 116+、支持 stdio MCP 的 Agent。

```powershell
git --version
node --version
npm --version
```

### 4.2 获取代码并构建

```powershell
cd ~/Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

约定：

- 构建产物在 `dist/`，**不提交到 Git**，每台电脑都要本地构建一次；
- **Chrome 加载的是 `dist/`，不是 `src/`**；
- 只改源码不会自动更新 `dist/`，必须重新 `npm run build`。

### 4.3 加载扩展并拿到扩展 ID

1. Chrome 地址栏打开 `chrome://extensions`；
2. 右上角开启 **开发者模式**；
3. 点击 **加载已解压的扩展程序**，选择项目里的 `dist` 目录；
4. 在 AgentSurf 卡片上记下 **扩展 ID**（形如 `hpageihlnphdohcplmimhmghljpilbpa`，32 位小写字母）。

此时扩展还连不上属于**正常现象**：Native Host 还没注册。

> ⚠️ 更换电脑、更换项目路径、或删除后重新加载，扩展 ID 都可能变化。**永远以 `chrome://extensions` 当前显示的 ID 为准**，不要沿用旧文档或旧记录里的 ID。

### 4.4 安装 Native Host

把 `<扩展ID>` 换成上一步记录的值：

```powershell
$extensionId = "<扩展ID>"
npm run native-host:install -- -ExtensionId $extensionId
```

脚本会做四件事：

| 动作 | 说明 |
| --- | --- |
| 写配置 | `%LOCALAPPDATA%\BrowserControlRuntime\config.json`，含 `port`(默认 8765) 与随机 64 位 `token` |
| 生成启动器 | `%LOCALAPPDATA%\BrowserControlRuntime\native-host.exe`，内部固定项目 `dist/native-host/host.js` 的绝对路径和 Node 绝对路径 |
| 写 Native Messaging manifest | `%LOCALAPPDATA%\BrowserControlRuntime\com.browsercontrol.runtime.json`，`allowed_origins` 只允许你填的这个扩展 ID |
| 注册表登记 | `HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.browsercontrol.runtime` |

重新安装时会**复用已有的有效 token**，不需要重新配置 MCP；只用新扩展 ID 重注册时也不会影响其他项目。

> 也可以直接用打包好的 CLI：`node dist/mcp/cli.js install-native-host --extension-id <扩展ID> [--port <端口>]`。

### 4.5 让扩展重新连接

安装完成后回到 `chrome://extensions`，点 AgentSurf 卡片上的 **重新加载**（🔄）。

扩展重新加载后会自动 `connectNative`，拉起 Native Host 与 Bridge。

### 4.6 用状态页确认链路

Chrome 打开（也可以直接点工具栏上的 AgentSurf 图标，弹的就是同一页）：

```text
chrome-extension://<扩展ID>/debug.html
```

期望看到：

```text
● connected
Host      com.browsercontrol.runtime
Endpoint  ws://127.0.0.1:8765
Pending   0
```

如果显示未连接：

1. 点一次 **Disconnect**，等 1 秒；
2. 再点 **Connect**；
3. 不要连续点 Reconnect（会造成重连风暴）。

### 4.7 配置 MCP 客户端

在 Agent 的 MCP 配置里加入（以 pi 的 `~/.pi/agent/mcp.json` 为例，其他客户端同理，只是文件位置不同）：

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "C:/Users/<用户名>/AppData/Local/BrowserControlRuntime/agentsurf-mcp.exe"
    }
  }
}
```

注意两点：

- **没有 `args`**。第 4.4 步的安装脚本会生成这个启动器，并把现成的 JSON 直接打印到终端——**照抄打印出来的那段即可**，不用自己拼路径；
- 启动器里记录了当前的 Node 路径与项目路径。**换电脑、移动项目目录、切 Node 版本后，重跑一次第 4.4 步的安装命令就会重新生成它**（和 Native Host 用的是同一条命令，不需要额外步骤）。

注意事项：

- 修改 MCP 配置后需要**重启 MCP 客户端**（或它的会话），配置只在启动时读取；
- 该项目不需要任何环境变量，MCP Server 会自动读取第 4.4 步生成的 `config.json`；
- 如需覆盖连接目标，可设置 `BROWSER_BRIDGE_URL`、`BROWSER_BRIDGE_TOKEN` 或 `BROWSER_BRIDGE_CONFIG`。

<details>
<summary>备选写法：不用启动器，直接指向 node 与 cli.js</summary>

如果客户端要求显式给出解释器（或你想自己控制路径）：

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/Users/<用户名>/Desktop/agentsurf-browser-control-runtime/dist/mcp/cli.js"]
    }
  }
}
```

```powershell
(Get-Command node).Source          # Node 可执行文件路径
(Resolve-Path dist/mcp/cli.js).Path  # MCP Server 入口路径
```

代价：两条绝对路径都要自己维护，而且客户端的 `PATH` 必须能看到 `node`（GUI 客户端不一定）。启动器写法把这些都包在里面了。

</details>

### 4.8 在 Agent 里确认工具可用

对 Agent 说：

```text
调用 browser_get_capabilities 看看有哪些工具。
```

应返回 47 个工具，并包含 `browser_get_frames`、`browser_select_text`、`browser_get_console_messages`、`browser_get_network_requests`。

## 5. 接入步骤（macOS）

> ⚠️ macOS 安装脚本已随仓库提供，但**尚未在真实 Mac 上完整验证链路**。脚本可用 ≠ 兼容性已验证通过。

前置条件同上（Git / Node 20+ / npm 10+ / Chrome 116+）。

### 5.1 构建并加载扩展

```sh
cd ~/Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

在 `chrome://extensions` 开启开发者模式，加载项目的 `dist/`，记录扩展 ID。

### 5.2 安装 Native Host

```sh
npm run native-host:install:macos -- "<扩展ID>"
```

默认端口 8765，可用末尾额外参数指定。创建的文件：

| 文件 | 路径 |
| --- | --- |
| 配置（仅当前用户可读写） | `~/Library/Application Support/BrowserControlRuntime/config.json` |
| Native Host 启动脚本 | `~/Library/Application Support/BrowserControlRuntime/native-host.sh` |
| MCP 启动器（给 MCP 客户端用） | `~/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh` |
| Native Messaging manifest | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.browsercontrol.runtime.json` |

要点：

- 启动脚本记录安装时的 Node 绝对路径，不依赖桌面启动 Chrome 时的 `PATH`；用 nvm / Homebrew 换过 Node 后要重新安装；
- 安装时会**自检 MCP 启动器**（跑一次 `agentsurf-mcp.sh help`）；自检在写 Native Messaging manifest **之前**，失败就中止安装，不会留下不一致的注册信息；
- 不需要 `sudo`，也不要混用 `sudo`，否则 manifest 会落到错误的用户目录；
- 只针对当前用户的 Google Chrome 稳定版，不会自动注册 Chromium / Chrome Beta。

### 5.3 重新加载扩展并确认连接

重新加载 AgentSurf，然后打开 `chrome-extension://<扩展ID>/debug.html`，确认 `connected`。

### 5.4 配置 MCP 客户端

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "/Users/<用户名>/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh"
    }
  }
}
```

同样由第 5.2 步的安装脚本生成，终端会直接打印这段 JSON。换机器、移动项目或切 Node 后重跑安装命令即可更新。

备选写法：`command` 写 node 路径、`args` 写 `dist/mcp/cli.js` 的绝对路径（`which node` / `realpath dist/mcp/cli.js` 取路径），代价是两条路径都要自己维护。

## 6. 验证接入是否成功

按“从里到外”的顺序验证，出问题时最容易定位。

### 6.1 Bridge 是否在监听

```powershell
# Windows
Get-NetTCPConnection -LocalPort 8765 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

```sh
# macOS
lsof -nP -iTCP:8765 -sTCP:LISTEN
```

有监听 = Bridge 已启动（Chrome 扩展成功拉起了 Host）。

### 6.2 全链路是否通（不经过 MCP 客户端）

仓库自带一个模拟外部 Agent 的脚本，直接连 Bridge 发一个请求：

```powershell
node scripts/call-tool.mjs '{"protocol_version":"1","request_id":"smoke","tool":"browser.list_tabs","args":{}}'
```

> PowerShell 与 bash / zsh 都直接用单引号包住整段 JSON。JSON 里不要放空格，否则 PowerShell 会把参数拆开。

返回你当前 Chrome 的标签页列表（`ok: true`）就说明：
**Bridge → Native Host → 扩展 → Chrome API** 全链路打通。

> 这一步不带会话，所以列表里只会有“未归属”的页签：被别的对话占用的会少显示，并以 `other_session_tabs` 告诉你数量；加 `include_all: true` 可以看全部。这只是可见范围，链路验证不受影响。

这一步与 MCP 客户端无关，是排查“到底是链路问题还是 MCP 配置问题”的分水岭：

| 现象 | 结论 |
| --- | --- |
| 这里失败 | 链路问题，看[第 9 节](#9-排障) |
| 这里成功、MCP 里失败 | MCP 配置问题（路径、Node、是否重启客户端） |

### 6.3 端到端冒烟

在 Agent 里依次让它做：

1. `browser_list_tabs` —— 能列出标签页；
2. `browser_get_page_content`（带某个普通网页的 `tab_id`）—— 能读到正文；
3. `browser_screenshot` —— 能拿到图片，且页面上**没有**“Chrome 正在被调试”横幅残留（用完记得 `browser_detach_debugger`）。

## 7. 在 Agent 里怎么用

### 7.1 只读流程（推荐先跑一遍）

```text
1. browser_list_tabs                      # 先看清有哪些标签页，避免动到用户正在用的页面
2. browser_open {"url":"https://example.com","activate":true}
                                          # 打开页面拿到 tab_id
3. browser_get_page_state {"tab_id":...}  # 确认 URL / 加载状态 / revision
4. browser_get_page_content {"tab_id":...}
                                          # 读正文；SPA 或外壳页可能要配合 frames
```

注意：**`browser_get_page` / `browser_get_page_state` 只返回页面元信息，不是正文抓取工具**；打开网址用 `browser_open`（**没有** `browser_navigate`）。

### 7.2 元素操作流程（element_id 模式）

```text
1. browser_get_interactives {"tab_id":...}     # 拿到元素快照
2. browser_click {"tab_id":..., "element_id":"el_..."}
```

规则：

- **只能使用 `browser_get_interactives` 返回的 `element_id`**，不允许自行编造 CSS Selector、XPath 或元素 ID；
- `element_id` 与「文档 + 页面 revision + frame」绑定，页面变化后会失效并返回 `stale_element`，此时**重新获取交互元素再重试**；
- 快照默认最多 150 个元素（见工具速查），重页面请用过滤器缩小范围，不要拉全量；
- 需要组合键（Ctrl+A、Cmd+Enter、Shift+Tab）时用 `modifiers`：

```json
{"tab_id": 123, "element_id": "el_...", "key": "a", "modifiers": ["Control"]}
```

- 需要在输入框里选中文字或移动光标时用 `browser_select_text`：

```json
{"tab_id": 123, "element_id": "el_...", "text": "要选中的文字"}
{"tab_id": 123, "element_id": "el_...", "selection_type": "cursor_after"}
```

### 7.3 iframe / 子框架（重要）

很多后台系统（禅道、旧版管理台、嵌入式支付页）把**真正的正文放在 iframe 里**，外层只是一个导航外壳。此时：

- 默认只作用于**顶层文档**（`frame_id = 0`），你会只看到导航栏；
- 先列框架，再带 `frame_id` 去读和操作。

```text
1. browser_get_frames {"tab_id": 123}
   → frames: [{frame_id: 0, is_top: true, url: "...", parent_frame_id: null},
              {frame_id: 561, is_top: false, url: "about:blank", parent_frame_id: 0}]

2. browser_get_interactives {"tab_id": 123, "frame_id": 561}   # 框架内的元素
3. browser_get_page_content {"tab_id": 123, "frame_id": 561}   # 框架内的正文
4. browser_click {"tab_id": 123, "frame_id": 561, "element_id": "el_..."}
```

要点：

- **`element_id` 只在其所属 frame 内有效**。从 `frame_id: 561` 拿到的 `element_id`，后续动作必须同样带 `frame_id: 561`；
- 忘带 `frame_id` 时请求会打到顶层文档，通常报 `stale_element`（顶层不认识这个 ID）；
- `frame_id` 可能因为框架导航而失效，此时返回可重试的 `frame_not_found`，重新 `browser_get_frames` 即可；
- 支持的框架包括 `about:blank` / `srcdoc` 这类**无 src 的同源框架**——外壳型系统几乎都是这种；
- 跨域框架：能列出、能报告 URL，但通常无法注入 Page Agent 操作其内容。

### 7.4 观测与排错

```text
browser_get_console_messages {"tab_id": 123}          # console.log/error、未捕获异常、未处理 rejection
browser_get_console_messages {"tab_id": 123, "frame_id": 561}
browser_get_network_requests {"tab_id": 123}          # 请求元数据：method/type/status/耗时/失败
browser_get_accessibility_tree {"tab_id": 123}        # 结构与可访问文本
browser_observe {"tab_id": 123}                       # 一次拿 状态+交互元素+AX+截图
```

Console 采集运行在页面 MAIN world，能捕获页面自身的输出；查询结果里 **`available: false` 表示当时采集器不在场，不能当成“页面没有报错”**。

### 7.5 多对话并行（默认自动隔离）

每个对话的 MCP Server 进程会自带一个会话，**Agent 不需要手动开会话，也不需要每次传 `session_id`**：

- 自己 `browser.open` 打开的页签会**自动建立归属并归入本会话的 Chrome 分组**；组名默认是 `AI · <4位ID>`，可用 `browser.name_session` 改成有意义的名字（例如“禅道排查”）；
- 另一个对话再想操作这些页签会被拒绝（`tab_in_use`），两个对话不会互相踩；
- 需要接管用户**已经打开**的页签时用 `browser.claim_tab`：它会建立归属并**默认归组**（传 `group: false` 可只归属、不把页签拉进分组）；
- `browser.list_tabs` 默认只列出**本对话的页签 + 尚未归属的页签**，并用 `other_session_tabs` 告诉你隐藏了几个；传 `include_all: true` 可以看到全部（脚本、排查用）；
- **租约对所有调用都生效**：不带 `session_id` 的调用（脚本、CLI）碰到别人已占用的页签同样报 `tab_in_use`，不会再静默放行；脚本要接管就先 `start_session` + `claim_tab`；
- `browser.end_session`（可带 `close_tabs`）会释放会话并解除分组。

边界与注意：

- 自动隔离的前提是“一个对话 = 一个 MCP Server 进程”（PiDeck 给每个对话起独立进程，满足此条件）。若某个客户端把多个对话复用到同一个进程，它们会共用同一个会话，此时可用显式 `session_id` 手动区分；
- 主动 `browser.open` 一个已有 `tab_id`（即导航已有页签）会建立归属但**不**动你的标签栏；
- 租约存在扩展的 `storage.session` 里（**Chrome 重启即清空**），会话记录在 `storage.local` 里是持久的；
- **空闲自动回收**：某个对话被直接关掉（没调 `end_session`）时，它占用过的页签在**空闲 30 分钟**后自动释放**并解除分组**，别的对话即可接管；正在使用的页签会续租，不会被误抢；
- **任务收尾**：干完活（不再需要那些页签）时主动调用 `browser.end_session`（必要时带 `close_tabs: true`），它会**立即**释放并解除分组；不调的话，分组会留到空闲超时才消失；
- **重载/重启后的收尾**：重新加载扩展或重启 Chrome 会清空租约（Chrome 行为），此时运行时会在启动时把“会话还在、租约已无”的漏网分组一并解除，不会留下无主的分组；有租约（正在干活）的页签不动；
- **手动兜底**：`browser.reset_sessions` 默认只释放**本对话自己的**会话与租约，并顺带清掉“拥有者已不存在”的租约（正是页签被消失的对话卡住的情形）；它**不会**动别的对话，返回值里的 `other_sessions_kept` 会告诉你还有几个会话没动。确实需要清全局（会释放并解除所有人的分组）时才传 `force: true`。

## 8. 更新、移动目录、卸载

### 8.1 按改动范围决定动作

| 你改了什么 | 需要做什么 |
| --- | --- |
| 扩展代码、Page Agent、Content Script | `npm run build` → 重新加载扩展 |
| **manifest.json（content_scripts 等）** | `npm run build` → **必须**重新加载扩展；刷新页面无效 |
| Native Host 源码或安装脚本 | 先禁用扩展 → 构建 → 重新安装 Native Host → 再启用 |
| MCP Server 代码 | 构建 → 重启 MCP 客户端 |
| 项目路径 / 扩展 ID / Node 路径 | 重新注册 Native Host |

已经启动的 Host 不会自动加载新 JS，必须让它重启（禁用/启用扩展，或重新加载扩展）。

### 8.2 完整更新流程（Windows）

```powershell
# 1. 先在 chrome://extensions 禁用 AgentSurf，等旧 Host 退出
# 2. 在项目目录
git pull
npm install
npm run build
$extensionId = "<当前扩展ID>"
npm run native-host:install -- -ExtensionId $extensionId
# 3. 回到 chrome://extensions 重新启用，并在 debug.html 确认 connected
# 4. 重启 MCP 客户端
```

macOS 把第 2 步换成 `npm run native-host:install:macos -- "<扩展ID>"`。

只是连接临时异常、没改代码时，**不需要**重新构建安装：在 `debug.html` 里 Disconnect / Connect，或重新加载扩展即可。

### 8.3 移动目录

启动器里写死的是**安装时**的项目路径（`<项目>/dist/native-host/host.js`）。移动或重命名项目后：

1. 禁用旧扩展；
2. 在新目录 `npm install && npm run build`；
3. 在 Chrome 加载新目录的 `dist/`，记录新的扩展 ID；
4. 在新目录重新执行 `native-host:install`；
5. 重新加载扩展，重启 MCP 客户端。

> 补充一个实测结论：`%LOCALAPPDATA%\BrowserControlRuntime\` 下的 `host.js` 是**历史遗留副本，没有任何东西引用它**（启动器指向仓库 `dist/` 里的那份）。排查问题时不要被它误导。

### 8.4 卸载

```powershell
# Windows
npm run native-host:uninstall
```

```sh
# macOS
npm run native-host:uninstall:macos
```

卸载只移除 Native Host 注册与启动器，**保留配置**；不会删除 Chrome 扩展，也不会删除项目目录。要彻底清理：先在 `chrome://extensions` 移除扩展，再删除项目目录与 `%LOCALAPPDATA%\BrowserControlRuntime`（macOS 为 `~/Library/Application Support/BrowserControlRuntime`）。

## 9. 排障

### 9.1 常见现象对照

| 现象 | 含义与处理 |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:8765` | 没有任何进程在监听。扩展未启用、Host 未安装，或扩展还没完成连接。**先看 `debug.html` 状态** |
| `Chrome Extension is not connected` | Bridge 活着，但没有扩展接进来。检查 `debug.html`、Host 握手，以及 `dist` 是否是当前构建 |
| `EADDRINUSE` | 8765 被占用：排查误启动的独立 Bridge、上个未退出的 Host、或另一个 Chrome 配置里的同名扩展 |
| `frame_not_found` | 目标框架已不存在（框架导航/重建）。可重试：重新 `browser_get_frames` |
| `stale_element` | 元素 ID 过期（页面变更），或**你在错的地方找它**（例如忘了带 `frame_id`）。重新 `browser_get_interactives` |
| `element_not_visible` / `element_disabled` / `element_not_editable` | 元素存在但不满足操作前提。不要强行点，先看页面实际状态 |
| `unsupported_page` | Chrome 不允许在该页面注入 Page Agent（`chrome://`、应用商店页等）。换普通 HTTP/HTTPS 页面 |
| `screenshot_unavailable` | 截图期间页面 revision 变化；或降级路径下目标不是活动标签页 |
| `tool is unsupported` | 工具名不被当前运行时支持。对照 `browser_get_capabilities`，不要急着重装 |
| 安装时报 `native-host.exe` 被占用 | 先禁用扩展、等旧 Host 退出再安装。**不要**批量结束 `node.exe` |

### 9.2 定位顺序

1. `chrome://extensions`：扩展是否启用？有没有报错？
2. `debug.html`（或点工具栏图标）：连接状态与最近事件；
3. 端口是否有监听（见 6.1）；
4. `node scripts/call-tool.mjs ...`（见 6.2）区分链路问题与 MCP 配置问题；
5. 必要时打开扩展的 **Service Worker 检查窗口**看 Native Messaging 报错。

### 9.3 三个最容易踩的坑

1. **改了 manifest 只刷新页面** → 不生效。`content_scripts`、权限这类改动**必须重新加载扩展**。
2. **用旧扩展 ID** → Host 注册的 `allowed_origins` 不匹配，连接会被 Chrome 拒绝。以 `chrome://extensions` 当前显示为准。
3. **切过 Node 版本（nvm）** → 启动器里记录的 Node 绝对路径失效，重新跑一次安装命令。

分享日志前请移除 token 与敏感页面数据。

## 10. 工具速查

共 **47** 个工具。

| 目的 | 工具 |
| --- | --- |
| 查询能力 | `browser.get_capabilities` |
| 标签页管理 | `browser.list_tabs` / `browser.open` / `browser.switch_tab` / `browser.close_tab` |
| 子框架 | `browser.get_frames`（配合各工具的 `frame_id`） |
| 导航 | `browser.back` / `browser.forward` / `browser.reload` |
| 页面元信息 | `browser.get_page` / `browser.get_page_state` |
| 正文与结构 | `browser.get_page_content` / `browser.get_accessibility_tree` |
| 交互元素 | `browser.get_interactives` |
| 组合观察 / 截图 | `browser.observe` / `browser.screenshot` |
| 元素点击与输入 | `browser.click` / `browser.double_click` / `browser.type` / `browser.press` |
| 文本选择 | `browser.select_text` |
| 表单 | `browser.set_checked` / `browser.select_option` |
| 元素拖拽与等待 | `browser.drag` / `browser.wait_for_element` |
| 滚动 | `browser.scroll` / `browser.scroll_at` |
| 坐标操作 | `browser.mouse_move` / `browser.click_at` / `browser.drag_at` |
| 键盘 / 文本 / 对话框 | `browser.press_key` / `browser.type_text` / `browser.handle_dialog` |
| 下载与上传 | `browser.list_downloads` / `browser.wait_for_download` / `browser.set_files` |
| Console / Network | `browser.get_console_messages` / `browser.get_network_requests` |
| 会话与标签页归属 | `browser.start_session` / `browser.end_session` / `browser.name_session` / `browser.claim_tab` / `browser.release_tab` / `browser.reset_sessions` |
| 调试器与 CDP | `browser.attach_debugger` / `browser.detach_debugger` / `browser.cdp` / `browser.get_cdp_events` |

补充说明：

- 支持 `modifiers: ["Alt"|"Control"|"Meta"|"Shift"]` 的工具：`browser.press`、`browser.press_key`、`browser.click`、`browser.double_click`、`browser.click_at`；
- 支持 `frame_id` 的工具：`browser.get_page`、`browser.get_page_state`、`browser.get_interactives`、`browser.get_page_content`、`browser.get_console_messages`，以及所有元素级动作（`click` / `double_click` / `type` / `press` / `select_text` / `set_checked` / `select_option` / `drag` / `wait_for_element` / `set_files`）；
- `browser.get_interactives` 支持 `limit`（默认 **150**）、`visible_only`、`tag`、`role`、`name_contains`。**过滤与截断在页面内完成**，结果里始终给出 `total` 与 `truncated`。实测：某重页面 665 个元素，仅靠默认上限就从 ~66,800 tokens 降到 ~15,100，用 `visible_only: true` 降到 ~380；
- **`truncated: true` 意味着列表不完整**，不能据此判定「页面上没有这个元素」，应该用过滤器缩小范围（而不是把 limit 调大）；
- **`visible_only` 默认 `false` 是故意的**：折叠面板、未激活 tab、以及**悬停才显形（`opacity: 0`）的按钮**都属于不可见，但 Agent 必须先能发现它们；真去点时仍会由可见性检查把关（先 `browser.mouse_move` 悬停使其显形，再点击）；
- **元素级工具优先于坐标级工具**：前者会校验元素仍可见、可用且 revision 未变，后者只是发坐标；
- 参数以 `src/core/protocol/tool-contract.ts` 与 `src/core/protocol/schemas.ts` 为准。工具名与参数**不可**按其他浏览器工具的命名习惯猜测。

## 11. 错误码与重试语义

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
| `tab_in_use` | ❌ | 该标签页被其他 session 占用：换标签页或先 `release_tab` |
| `request_timeout` | ✅ | 操作太慢或页面阻塞，必要时增大 `timeout_ms` |
| `unsupported_page` | ❌ | 受保护页面，换普通网页 |
| `screenshot_unavailable` | ✅ | 页面在截图期间变化，重试 |
| `bridge_unavailable` / `transport_disconnected` | ✅ | 扩展未连接或通道断开，看[第 9 节](#9-排障) |
| `authentication_failed` | ❌ | token 不匹配：重新安装 Native Host（会复用 token）或检查 `config.json` |

## 12. 安全边界

AgentSurf 能操作你登录态下的页面，`browser.cdp`、文件上传等能力很强。建议在 Agent 的使用规则里写死：

- **默认只读**；提交、保存、删除、发布、上传、发送消息等会修改线上数据的操作，先取得用户明确授权；
- 登录由用户自行完成：不索取密码/验证码，不读取或输出 Cookie、Token、LocalStorage 等认证信息；
- 不把本机 `config.json`、token、敏感页面数据提交进仓库或粘贴到聊天里；
- 不把 Bridge 暴露到外网；
- CDP 会弹“Chrome 正在被调试”横幅，并与用户自己的 DevTools 冲突，用完及时 `browser.detach_debugger`。

以上是**给 Agent 的使用约束**，不代表运行时已实现人工审批；调用方仍需自己管理授权边界。

## 13. 开发与调试

### 13.1 命令

| 命令 | 用途 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run build` | 构建扩展到 `dist/`（含 Native Host bundle） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm test` | Vitest 单元测试 |
| `npm run bridge:call` | 用一个 JSON 请求直连 Bridge（见 6.2） |

`npm run build` 由两部分组成：`scripts/generate-icons.mjs`（图标）与 `scripts/build.mjs`（esbuild 打包扩展、Bridge、MCP Server，以及**自包含**的 Native Host bundle）。

### 13.2 扩展状态页

`chrome-extension://<扩展ID>/debug.html`，也是点工具栏 AgentSurf 图标时弹出的那一页。它**只做一件代码里做不到的事**：告诉你看得见的链路状态，并在断连时能强制重连。

页面上只有：

- 连接状态（`connected` / `connecting` / `reconnecting` / `error` / `disconnected`）与最近的错误文本；
- Host、Endpoint、Pending（含重连次数）；
- `Connect` / `Disconnect` / `Reconnect` 三个按钮；
- 最近 5 条**连接状态与错误**事件（工具调用的请求/响应不进这个列表，否则几次调用就把连接历史冲掉了）；
- `Copy diagnostics`：把状态、扩展版本、浏览器 UA 与最近事件复制到剪贴板，方便直接粘给 Agent 或写进 issue（**不含 token**）。

其余手工工具面板（标签页、元素操作、坐标、截图、文件、CDP、原始报文日志）已经移除：这些都用代码驱动更省事：

```powershell
# 不经 MCP，直接验证链路（见 6.2）
npm run bridge:call -- '{"protocol_version":"1","request_id":"t","tool":"browser.list_tabs","args":{}}'
```

需要看返回结果、批量跑工具或做断点调试时，直接用 MCP 工具或 `scripts/call-tool.mjs`。

### 13.3 独立 Bridge（仅协议开发）

```powershell
npm run bridge        # 启动独立 Bridge
npm run bridge:dev    # 先构建再启动
```

注意：

- 独立 Bridge **不会**自动获得当前 Native Messaging 扩展的控制能力，需要兼容的扩展 WebSocket 客户端；
- 不要用它替代正常的 Native Host 流程，也不要与 Native Host 抢同一个端口；
- 可用 `BROWSER_BRIDGE_PORT` / `BROWSER_BRIDGE_TOKEN` 指定；未指定 token 时会随机生成并打印到终端，**不要分享该输出**。

## 14. 外部调用协议

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
  "tool": "browser.get_page_state",
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
- 根级 `session_id` 用于标签页归属（工具自有的 `session_id` 参数按各自 schema 处理）；
- 与扩展之间使用 Chrome Native Messaging framing，由 Chrome 校验 `allowed_origins`，不再重复传 Bridge token。

开发脚本 `scripts/call-tool.mjs`（`npm run bridge:call`）即按此协议实现，可直接当作参考客户端；它通过 `BROWSER_BRIDGE_URL` / `BROWSER_BRIDGE_TOKEN` 覆盖配置，未设置时自动读本机 `config.json`。

## 15. 实现细节

### 15.1 目录结构

| 路径 | 职责 |
| --- | --- |
| `src/core/` | 与 Chrome API 无关的工具契约、参数校验、Runtime 调度 |
| `src/chrome/` | Chrome API 适配：标签页、CDP、截图、下载、网络、**框架枚举**、会话协调 |
| `src/content/` | Page Agent、元素注册与 revision 追踪、动作执行、Console 采集、Agent 光标 |
| `src/transport/` | Native Messaging、Runtime Message 与工具传输协议 |
| `src/bridge/` | 本机 WebSocket Bridge |
| `src/mcp/` | MCP Server、Bridge 客户端、Native Host 安装 CLI |
| `src/native-host/` | Native Host 入口、配置与 framing |
| `src/debug/` | 扩展状态页（连接状态、重连、诊断导出） |
| `scripts/` | 构建、安装与开发调用脚本 |
| `tests/` | 单元测试 |
| `docs/` | 改造与验证报告 |

### 15.2 页面 revision 与 element_id

Page Agent 为**每个 Document（含每个 frame）**维护独立 revision。导航、刷新与“重要 DOM 变化”会推进 revision，`browser.get_page_state` 的 `revision_reason` 会说明原因（`navigation` / `refresh` / `important_dom`）。

MutationObserver 只筛选：交互元素增删、已注册元素关键属性变化、单批大型结构变化（每批最多推进一次）。普通文本改动不会推进 revision。

`browser.get_interactives` 返回 `tab_id`、`frame_id`、`page_revision`、`snapshot_id` 与元素数组（角色、标签、可访问名称、状态、坐标），**不返回 selector**；密码输入只返回 `value_state: "redacted"`。

`element_id` 是不透明标识，DOM 引用只存在于 Content Script 内；动作执行前会校验 ID、revision、连接状态、可见性、disabled/editable。因为 documentToken 每个文档不同，**跨 frame 用错 ID 会表现为 `stale_element`**。

### 15.3 frame 路由

- Content Script 以 `all_frames: true` + `match_about_blank: true` 注入，因此 `about:blank` / `srcdoc` 这类同源框架也有 Page Agent；
- 请求通过 `chrome.tabs.sendMessage(tabId, msg, { frameId })` **定向**发送（广播会让多个 Agent 抢答同一响应）；
- 按需注入也用 `scripting.executeScript({ target: { tabId, frameIds: [frameId] } })` 定向；
- MAIN world 的 Console 采集是**尽力而为**：页面 CSP 可能拦掉它，但不会连带让 Page Agent 失效（此时 `available: false`）。

### 15.4 截图、光标、文件

- 截图默认走 CDP `Page.captureScreenshot`，**后台标签页也能截**；只有降级到 `captureVisibleTab` 才要求目标处于活动状态；
- `full_page: true` 取的是**文档**内容尺寸；像外壳型应用那样把滚动放在容器内的页面，返回值可能就等于视口；
- 坐标操作与元素操作会在页面显示短暂的 `AI` 光标标记：不参与交互、不被 `get_interactives` 返回、不改变 revision；
- `browser.set_files` 用临时标记 + CDP `DOM.setFileInputFiles` 设置文件，之后清理标记；非顶层 frame 会在 `pierce` 的节点树里查找该标记。

## 16. 当前限制

- **无 OCR**：图片里的文字需要靠截图 + 模型自身视觉能力；
- **无 Shadow DOM 专门支持**：`browser.get_capabilities` 中 `shadow_dom: false`；开放 Shadow Root 的文本会并入页面正文，但元素不会进入 `get_interactives`；
- **iframe 需显式寻址**：默认只作用于顶层文档，必须配合 `browser.get_frames`；跨域框架通常无法注入；
- **受保护页面不可注入**：`chrome://`、Chrome 应用商店等；
- **CDP 与 DevTools 互斥**：同一标签页已开 DevTools 时 `attach` 会失败；attach 期间会有调试横幅；
- **Console 跨导航丢失**：缓冲在页面内，刷新/跳转后清空；且只能看到采集器在场之后的输出；
- **Network 是元数据**：没有响应体；且缓冲在 Service Worker 内，Host 重启即清空；
- **CDP 事件缓冲上限 1000 条/标签页**，且只记录 attach 之后的事件；
- **会话隔离是协作式的**：必须每次调用都带 `session_id` 才生效；
- **文件上传/下载限制**：上传需本机绝对路径；下载只能拿到 Chrome Downloads API 提供的元数据，且无法可靠关联来源标签页；
- **平台覆盖**：Windows 已实测；**macOS 脚本已提供但未在真机验证**；Linux 未提供安装脚本；
- 单元测试覆盖协议与调度逻辑，真机链路（注入、截图、CDP、iframe）依赖手工验证，见 `docs/`。

---

<a id="english"></a>

# English

[中文](#中文)

## Table of contents

- [1. What it is](#1-what-it-is)
- [2. How it works](#2-how-it-works)
- [3. Choosing an integration path](#3-choosing-an-integration-path)
- [4. Setup on Windows](#4-setup-on-windows)
- [5. Setup on macOS](#5-setup-on-macos)
- [6. Verifying the setup](#6-verifying-the-setup)
- [7. Driving it from an agent](#7-driving-it-from-an-agent)
- [8. Updating, moving, uninstalling](#8-updating-moving-uninstalling)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Tool reference](#10-tool-reference)
- [11. Error codes and retry semantics](#11-error-codes-and-retry-semantics)
- [12. Safety boundaries](#12-safety-boundaries)
- [13. Development and debugging](#13-development-and-debugging)
- [14. External protocol](#14-external-protocol)
- [15. Implementation notes](#15-implementation-notes)
- [16. Current limitations](#16-current-limitations)

## 1. What it is

In one sentence: **when your agent needs to operate a web page, it borrows the Chrome you are already using instead of launching a clean browser profile.**

What it gives you:

- your existing Chrome sessions and tabs — no re-login, no cookie export;
- **47 `browser.*` tools**: tabs, page reading, element clicks and typing, forms, scrolling, drag, screenshots, iframes, console, network, downloads, file upload, raw CDP;
- an **opaque `element_id`** model instead of CSS selectors, with every action re-checked for visibility, enabled state, and page revision;
- a local MCP server, so the agent side is just one stdio MCP entry.

What it does not do:

- no built-in model, no task planning;
- no cloud browser: everything talks over `127.0.0.1`;
- no CAPTCHA solving or anti-bot evasion.

## 2. How it works

```text
        MCP client (your agent)
              │  stdio
              ▼
        AgentSurf MCP Server
              │  WebSocket + token, bound to 127.0.0.1 only
              ▼
        local Browser Bridge
              │  Chrome Native Messaging (length-prefixed frames over stdin/stdout)
              ▼
        Native Host (native-host.exe / native-host.sh)
              │  chrome.runtime.connectNative
              ▼
        Chrome extension (Manifest V3)
              │  chrome.tabs.sendMessage / chrome.debugger / chrome.webRequest
              ▼
        the page (Page Agent content script, injected into every frame)
```

Key consequences:

- **The extension is the initiator.** It calls `connectNative` on startup, which starts the native host, which starts the bridge. You never need to run `npm run bridge` for normal use.
- The extension **listens on no port at all**; the bridge only binds `127.0.0.1` and requires a token (generated by the installer, stored on disk, never pasted into a chat).
- The MCP server and the native host **share the same local config**, so you do not copy tokens between them.
- A standalone bridge exists only for protocol development — see [section 13](#13-development-and-debugging).

## 3. Choosing an integration path

### Option A: MCP server (recommended)

Agent ↔ `dist/mcp/cli.js` (stdio MCP server) ↔ Bridge ↔ extension. The agent gets every tool and its schema for free.

### Option B: your own client against the Bridge

Your program ↔ the local WebSocket bridge, doing the `auth` handshake and request framing itself. Use this for non-MCP runtimes or when you need fine control over timeouts and concurrency. Protocol: [section 14](#14-external-protocol).

Both options still require the extension + native host from section 4 or 5 — that is the foundation.

## 4. Setup on Windows

All commands run in **PowerShell**, from the project root.

### 4.1 Check prerequisites

Git, Node.js 20+, npm 10+, Chrome 116+, and an agent that speaks stdio MCP.

```powershell
git --version
node --version
npm --version
```

### 4.2 Clone and build

```powershell
cd ~/Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

- build output lives in `dist/`, is **gitignored**, and must be produced on each machine;
- **Chrome loads `dist/`, never `src/`**;
- editing source does not update `dist/` — run `npm run build` again.

### 4.3 Load the extension and copy its ID

1. Open `chrome://extensions`;
2. enable **Developer mode** (top right);
3. click **Load unpacked** and select the project's `dist` folder;
4. copy the **extension ID** from the AgentSurf card (32 lowercase letters, e.g. `hpageihlnphdohcplmimhmghljpilbpa`).

The extension cannot connect yet — that is expected, the native host is not registered.

> ⚠️ The ID changes when you move the project, load it on another machine, or re-add it after removal. **Always use the ID currently shown in `chrome://extensions`.**

### 4.4 Install the native host

Replace `<EXTENSION_ID>` with the value you just copied:

```powershell
$extensionId = "<EXTENSION_ID>"
npm run native-host:install -- -ExtensionId $extensionId
```

What the installer does:

| Action | Detail |
| --- | --- |
| Writes config | `%LOCALAPPDATA%\BrowserControlRuntime\config.json` with `port` (8765 by default) and a random 64-char `token` |
| Builds launcher | `%LOCALAPPDATA%\BrowserControlRuntime\native-host.exe`, holding absolute paths to `dist/native-host/host.js` and to Node |
| Writes the manifest | `%LOCALAPPDATA%\BrowserControlRuntime\com.browsercontrol.runtime.json`, with `allowed_origins` limited to your extension ID |
| Registers it | `HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.browsercontrol.runtime` |

Re-running keeps the existing valid token, so your MCP config stays valid when you only re-register with a new extension ID.

> Equivalent CLI entry point: `node dist/mcp/cli.js install-native-host --extension-id <ID> [--port <PORT>]`.

### 4.5 Reload the extension

Back in `chrome://extensions`, press **Reload** (🔄) on the AgentSurf card. The extension then calls `connectNative`, which starts the native host and the bridge.

### 4.6 Confirm the link on the status page

Open in Chrome (or just click the AgentSurf toolbar icon — it is the same page):

```text
chrome-extension://<EXTENSION_ID>/debug.html
```

Expected:

```text
● connected
Host      com.browsercontrol.runtime
Endpoint  ws://127.0.0.1:8765
Pending   0
```

If it is not connected: click **Disconnect**, wait a second, then **Connect**. Do not hammer Reconnect.

### 4.7 Configure the MCP client

Add this to your agent's MCP config (example is pi's `~/.pi/agent/mcp.json`; other clients use the same shape in their own file):

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "C:/Users/<user>/AppData/Local/BrowserControlRuntime/agentsurf-mcp.exe"
    }
  }
}
```

Two things to notice:

- **There are no `args`.** The installer from 4.4 builds this launcher and prints the finished JSON to the terminal, so you copy what it printed instead of assembling paths yourself;
- the launcher records the Node path and the project path it was built with. **A new machine, a moved project, or a switched Node version is fixed by re-running the 4.4 install command** — the same single command that also re-registers the native host.

Notes:

- **restart the MCP client** after editing its config; it is read at startup;
- no environment variables are required: the server reads the `config.json` written in 4.4;
- to override the connection, set `BROWSER_BRIDGE_URL`, `BROWSER_BRIDGE_TOKEN`, or `BROWSER_BRIDGE_CONFIG`.

<details>
<summary>Alternative: point at node and cli.js directly</summary>

Use this if a client insists on an explicit interpreter, or if you prefer to own the paths:

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/Users/<user>/Desktop/agentsurf-browser-control-runtime/dist/mcp/cli.js"]
    }
  }
}
```

```powershell
(Get-Command node).Source              # node executable
(Resolve-Path dist/mcp/cli.js).Path    # MCP server entry point
```

The cost: you maintain two absolute paths, and `node` must be on the client's `PATH` (GUI clients often have a narrow one). The launcher hides all of that.

</details>

### 4.8 Confirm the tools

Ask the agent:

```text
Call browser_get_capabilities and list the tools.
```

You should see 47 tools, including `browser_get_frames`, `browser_select_text`, `browser_get_console_messages`, and `browser_get_network_requests`.

## 5. Setup on macOS

> ⚠️ The macOS installer ships with the repo but the full link has **not been verified on a real Mac**. Shipping a script is not the same as declaring support.

Prerequisites are the same (Git / Node 20+ / npm 10+ / Chrome 116+).

### 5.1 Build and load the extension

```sh
cd ~/Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

Enable developer mode in `chrome://extensions`, load the project's `dist/`, and copy the extension ID.

### 5.2 Install the native host

```sh
npm run native-host:install:macos -- "<EXTENSION_ID>"
```

Port 8765 by default; append another port to override. Files created:

| File | Path |
| --- | --- |
| Config (user-only) | `~/Library/Application Support/BrowserControlRuntime/config.json` |
| Native host launcher | `~/Library/Application Support/BrowserControlRuntime/native-host.sh` |
| MCP launcher (for the MCP client) | `~/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh` |
| Native messaging manifest | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.browsercontrol.runtime.json` |

Notes:

- the launchers record Node's absolute path, so they do not depend on the `PATH` Chrome sees; re-run the installer after switching Node with nvm or Homebrew;
- the install **self-checks the MCP launcher** (`agentsurf-mcp.sh help`) *before* writing the native messaging manifest, so a failure aborts without leaving inconsistent registration;
- do not use `sudo` — the manifest would land in the wrong user directory;
- it targets the current user's Google Chrome (stable) only.

### 5.3 Reload and confirm

Reload AgentSurf, then open `chrome-extension://<EXTENSION_ID>/debug.html` and check for `connected`.

### 5.4 Configure the MCP client

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "/Users/<user>/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh"
    }
  }
}
```

Built by the 5.2 installer, which prints this block for you. Re-run that command after moving the project, changing machine, or switching Node.

Alternative: `command` as the node path plus `args` with the absolute `dist/mcp/cli.js` (from `which node` and `realpath dist/mcp/cli.js`) — two paths to maintain yourself.

## 6. Verifying the setup

Verify from the inside out; this is what makes failures easy to localize.

### 6.1 Is the bridge listening?

```powershell
# Windows
Get-NetTCPConnection -LocalPort 8765 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

```sh
# macOS
lsof -nP -iTCP:8765 -sTCP:LISTEN
```

A listener means the bridge is up (the extension successfully spawned the host).

### 6.2 Does the whole link work without the MCP client?

The repo ships a script that acts as a minimal external agent:

```powershell
node scripts/call-tool.mjs '{"protocol_version":"1","request_id":"smoke","tool":"browser.list_tabs","args":{}}'
```

> Single quotes work in both PowerShell and bash/zsh. Keep the JSON free of spaces, or PowerShell will split the argument.

Getting your real tab list back (`ok: true`) proves the whole path
**bridge → native host → extension → Chrome APIs**.

> This step carries no session, so the list only shows unclaimed tabs: anything another conversation holds is hidden and counted in `other_session_tabs`; add `include_all: true` to see everything. That is only the visible scope — the link check itself is unaffected.

This step is the dividing line for troubleshooting:

| Result | Conclusion |
| --- | --- |
| Fails here | link problem — see [section 9](#9-troubleshooting) |
| Works here, fails in MCP | MCP config problem (paths, Node, client not restarted) |

### 6.3 End-to-end smoke test

In the agent, in order: `browser_list_tabs`, then `browser_get_page_content` on a normal page, then `browser_screenshot`. Confirm no leftover "Chrome is being debugged" banner afterwards (call `browser_detach_debugger` if you used CDP).

## 7. Driving it from an agent

### 7.1 Read-only pass first

```text
1. browser_list_tabs                                  # see what exists before touching anything
2. browser_open {"url":"https://example.com","activate":true}
3. browser_get_page_state {"tab_id":...}              # URL, load state, revision
4. browser_get_page_content {"tab_id":...}            # body text
```

`browser_get_page` / `browser_get_page_state` return **metadata, not article text**. To open a URL use `browser_open`; there is **no** `browser_navigate`.

### 7.2 Element actions (the `element_id` model)

```text
1. browser_get_interactives {"tab_id":...}            # snapshot
2. browser_click {"tab_id":..., "element_id":"el_..."}
```

Rules:

- **Only use `element_id` values returned by `browser_get_interactives`.** Never invent selectors or IDs.
- An `element_id` is bound to a document, a page revision, and a frame. When the page changes it goes stale (`stale_element`) — call `get_interactives` again and retry.
- Modifier keys:

```json
{"tab_id": 123, "element_id": "el_...", "key": "a", "modifiers": ["Control"]}
```

- Text selection inside an editable element:

```json
{"tab_id": 123, "element_id": "el_...", "text": "text to select"}
{"tab_id": 123, "element_id": "el_...", "selection_type": "cursor_after"}
```

### 7.3 iframes (important)

Many admin systems (ZenTao, legacy consoles, embedded payment pages) render the real content **inside an iframe**, with the outer document being just navigation chrome. Without a frame target you will only see that chrome.

```text
1. browser_get_frames {"tab_id": 123}
   → [{frame_id: 0, is_top: true, ...},
      {frame_id: 561, is_top: false, url: "about:blank", parent_frame_id: 0}]

2. browser_get_interactives {"tab_id": 123, "frame_id": 561}
3. browser_get_page_content  {"tab_id": 123, "frame_id": 561}
4. browser_click {"tab_id": 123, "frame_id": 561, "element_id": "el_..."}
```

Rules and behaviours:

- **An `element_id` is only valid inside the frame that produced it.** Always pass the same `frame_id` on the follow-up action.
- Omitting `frame_id` targets the top document, so the request usually fails with `stale_element`.
- A frame that navigated away is gone: you get a retryable `frame_not_found`; call `browser_get_frames` again.
- `about:blank` / `srcdoc` frames are supported (that is how app shells work), which is why the content scripts run in `all_frames` with `match_about_blank`.
- Cross-origin frames can be listed and their URL reported, but their content cannot be driven.

### 7.4 Observability

```text
browser_get_console_messages {"tab_id": 123}                 # console output, exceptions, rejections
browser_get_console_messages {"tab_id": 123, "frame_id": 561}
browser_get_network_requests {"tab_id": 123}                 # method/type/status/duration/failure
browser_get_accessibility_tree {"tab_id": 123}
browser_observe {"tab_id": 123}                              # state + interactives + AX + screenshot
```

Console collection runs in the page's MAIN world so it sees the page's own output. `available: false` means **the collector was not present — an empty list is not proof of silence**.

### 7.5 Parallel conversations (isolated by default)

Each conversation's MCP server process owns a session, so **the agent does not have to create one or pass `session_id`**:

- tabs it opens with `browser_open` are claimed automatically and put in **this conversation's Chrome tab group**, titled `AI · <4 chars>` by default and renameable with `browser_name_session`;
- another conversation is refused those tabs (`tab_in_use`), so conversations stop stepping on each other;
- use `browser_claim_tab` to take over a tab the user already had open: it claims and, by default, groups it (pass `group: false` to claim without moving it);
- `browser_list_tabs` returns this conversation's tabs plus unclaimed ones and reports the rest in `other_session_tabs`; pass `include_all: true` to see every tab (for scripts and troubleshooting);
- **leases apply to every caller**: a session-less call (a script, the CLI) is refused with `tab_in_use` on a tab another conversation holds instead of silently bypassing the check — a script that wants such a tab starts a session and claims it;
- `browser_end_session` (optionally with `close_tabs`) releases the session and ungroups its tabs.

Caveats:

- automatic isolation assumes **one conversation = one MCP server process** (PiDeck starts a separate process per conversation, which satisfies this). If a client multiplexes several conversations through one process, they share a session and you must pass an explicit `session_id` to separate them;
- `browser_open` on an existing `tab_id` claims that tab but deliberately leaves the tab bar alone;
- leases live in the extension's `storage.session` (**restarting Chrome clears them**), while session records persist in `storage.local`;
- **idle reclaim**: if a conversation is closed without calling `end_session`, the tabs it claimed are freed **and ungrouped** after **30 minutes of inactivity**, and another conversation can take them over, while a session that keeps using its tab keeps refreshing the lease;
- **finish the job**: call `browser_end_session` (with `close_tabs: true` if the tabs are no longer needed) when the work is done — it releases and ungroups immediately; otherwise the group stays until the idle timeout;
- **after a reload or restart**: reloading the extension or restarting Chrome clears the leases (a Chrome behaviour), so on startup the runtime also ungroups any group whose owner no longer holds a lease, leaving no orphaned groups behind; tabs with a live lease are left alone;
- **manual escape hatch**: `browser_reset_sessions` releases this conversation's own session and any lease whose owner is gone — which is what recovers tabs stuck on a vanished conversation. Other conversations are untouched, and `other_sessions_kept` reports how many were left alone; pass `force: true` only when you really mean to release every session and ungroup their tabs.

## 8. Updating, moving, uninstalling

### 8.1 What to do for each kind of change

| Change | Action |
| --- | --- |
| extension / content script / page agent code | `npm run build` → reload the extension |
| **manifest.json (e.g. content_scripts)** | `npm run build` → **must** reload the extension; refreshing a page is not enough |
| native host source or installer | disable extension → build → reinstall native host → re-enable |
| MCP server code | build → restart the MCP client |
| project path / extension ID / Node path | re-register the native host |

A running host never picks up new JS on its own; restart it by reloading the extension.

### 8.2 Full update (Windows)

```powershell
# 1. disable AgentSurf in chrome://extensions and let the old host exit
# 2. in the project
git pull
npm install
npm run build
$extensionId = "<current extension id>"
npm run native-host:install -- -ExtensionId $extensionId
# 3. re-enable in chrome://extensions, confirm connected in debug.html
# 4. restart the MCP client
```

On macOS, replace step 2's last command with `npm run native-host:install:macos -- "<EXTENSION_ID>"`.

For a transient connection problem with no code change, skip all of this: use Disconnect / Connect in `debug.html` or reload the extension.

### 8.3 Moving the project

The launcher hard-codes the project path recorded at install time (`<project>/dist/native-host/host.js`). After moving or renaming:

1. disable the old extension;
2. in the new location: `npm install && npm run build`;
3. load the new `dist/` in Chrome and copy the new extension ID;
4. run `native-host:install` from the new location;
5. reload the extension and restart the MCP client.

> Verified detail: the `host.js` copy in `%LOCALAPPDATA%\BrowserControlRuntime\` is a **stale leftover that nothing references** (the launcher points at the repo's `dist/`). Do not let it mislead you while debugging.

### 8.4 Uninstalling

```powershell
npm run native-host:uninstall              # Windows
npm run native-host:uninstall:macos        # macOS
```

This removes the native host registration and launcher, **keeps the config**, and touches neither the Chrome extension nor the project. To clean up fully: remove the extension in `chrome://extensions`, then delete the project directory and `%LOCALAPPDATA%\BrowserControlRuntime` (`~/Library/Application Support/BrowserControlRuntime` on macOS).

## 9. Troubleshooting

### 9.1 Symptom table

| Symptom | Meaning and fix |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:8765` | Nothing is listening: extension disabled, host not installed, or the extension has not finished connecting. **Check `debug.html` first.** |
| `Chrome Extension is not connected` | The bridge is alive but no extension is attached. Check `debug.html`, the host handshake, and whether `dist` is current. |
| `EADDRINUSE` | Port 8765 is taken: a stray standalone bridge, an old host, or another profile's copy of the extension. |
| `frame_not_found` | The target frame no longer exists (navigation/rebuild). Retry after `browser_get_frames`. |
| `stale_element` | The element ID is outdated **or you are looking in the wrong place** (e.g. missing `frame_id`). Re-run `browser_get_interactives`. |
| `element_not_visible` / `element_disabled` / `element_not_editable` | The element exists but cannot be acted on yet. Inspect the real page state. |
| `unsupported_page` | Chrome forbids injecting a Page Agent there (`chrome://`, Web Store). Use a normal HTTP/HTTPS page. |
| `screenshot_unavailable` | The page changed during capture, or the fallback path needed an active tab. |
| `tool is unsupported` | That tool does not exist in this runtime. Compare against `browser_get_capabilities`. |
| `native-host.exe` in use during install | Disable the extension, let the old host exit, then install. Do **not** kill every `node.exe`. |

### 9.2 Order of investigation

1. `chrome://extensions` — enabled? any error?
2. `debug.html` (or the toolbar icon) — connection state and recent events;
3. is anything listening on the port (6.1);
4. `node scripts/call-tool.mjs ...` (6.2) to separate a link problem from an MCP config problem;
5. the extension's **Service Worker inspector** for native messaging errors.

### 9.3 The three most common mistakes

1. **Editing `manifest.json` and only refreshing the page** — reload the extension instead.
2. **Using a stale extension ID** — the host's `allowed_origins` will not match and Chrome refuses the connection.
3. **Switching Node versions (nvm)** — the launcher's recorded Node path goes stale; re-run the installer.

Redact the token and any sensitive page data before sharing logs.

## 10. Tool reference

47 tools in total.

| Goal | Tools |
| --- | --- |
| Capabilities | `browser.get_capabilities` |
| Tabs | `browser.list_tabs` / `browser.open` / `browser.switch_tab` / `browser.close_tab` |
| Frames | `browser.get_frames` (plus `frame_id` on the tools below) |
| Navigation | `browser.back` / `browser.forward` / `browser.reload` |
| Page metadata | `browser.get_page` / `browser.get_page_state` |
| Text and structure | `browser.get_page_content` / `browser.get_accessibility_tree` |
| Interactive elements | `browser.get_interactives` |
| Combined read / screenshot | `browser.observe` / `browser.screenshot` |
| Element click and input | `browser.click` / `browser.double_click` / `browser.type` / `browser.press` |
| Text selection | `browser.select_text` |
| Form state | `browser.set_checked` / `browser.select_option` |
| Element drag and wait | `browser.drag` / `browser.wait_for_element` |
| Scrolling | `browser.scroll` / `browser.scroll_at` |
| Raw coordinates | `browser.mouse_move` / `browser.click_at` / `browser.drag_at` |
| Keyboard / text / dialogs | `browser.press_key` / `browser.type_text` / `browser.handle_dialog` |
| Files | `browser.list_downloads` / `browser.wait_for_download` / `browser.set_files` |
| Console / Network | `browser.get_console_messages` / `browser.get_network_requests` |
| Sessions and tab ownership | `browser.start_session` / `browser.end_session` / `browser.name_session` / `browser.claim_tab` / `browser.release_tab` / `browser.reset_sessions` |
| Debugger and CDP | `browser.attach_debugger` / `browser.detach_debugger` / `browser.cdp` / `browser.get_cdp_events` |

- `modifiers: ["Alt"|"Control"|"Meta"|"Shift"]` is accepted by `browser.press`, `browser.press_key`, `browser.click`, `browser.double_click`, `browser.click_at`.
- `frame_id` is accepted by `browser.get_page`, `browser.get_page_state`, `browser.get_interactives`, `browser.get_page_content`, `browser.get_console_messages`, and every element action.
- `browser.get_interactives` accepts `limit` (default **150**), `visible_only`, `tag`, `role`, `name_contains`. Filtering and truncation happen inside the page, and the result reports `total` plus `truncated`. Measured: a 665-element page fell from ~66,800 tokens to ~15,100 by the cap alone, and to ~380 tokens with `visible_only: true`.
- **`truncated: true` means the list is incomplete** — do not conclude the element is missing; narrow with a filter instead.
- **`visible_only: false` is the deliberate default**: collapsed panels, inactive tabs, and hover-revealed buttons (`opacity: 0`) are invisible, yet the agent must be able to discover them. Actions still refuse invisible elements, so hover first (`browser.mouse_move`), then click.
- **Prefer element-level tools over coordinate-level ones**: element tools verify visibility, enabled state, and revision; coordinate tools just send input.
- Authoritative parameters live in `src/core/protocol/tool-contract.ts` and `src/core/protocol/schemas.ts`. Do not guess names or arguments from other browser tools.

## 11. Error codes and retry semantics

Every failure is structured (the MCP layer puts the same object into the tool result text):

```json
{
  "code": "stale_element",
  "message": "The element_id belongs to an older page revision.",
  "retryable": true,
  "details": { "element_id": "el_...", "page_revision": "rev_..._1" }
}
```

| code | retryable | Suggested action |
| --- | --- | --- |
| `stale_element` | yes | re-read interactives; if framed, check `frame_id` |
| `element_not_found` | no | the element is gone or wrong; re-observe the page |
| `element_not_visible` / `element_disabled` / `element_not_editable` | mixed | scroll or wait; do not force the action |
| `frame_not_found` | yes | re-read frames and use the new `frame_id` |
| `tab_not_found` | yes | the tab closed; re-read tabs |
| `tab_in_use` | no | another session owns the tab: pick another or release it |
| `request_timeout` | yes | raise `timeout_ms` if the operation is legitimately slow |
| `unsupported_page` | no | protected page; use a normal one |
| `screenshot_unavailable` | yes | the page changed during capture; retry |
| `bridge_unavailable` / `transport_disconnected` | yes | extension not connected / channel dropped |
| `authentication_failed` | no | token mismatch: reinstall the native host or check `config.json` |

## 12. Safety boundaries

AgentSurf acts on your logged-in pages, and `browser.cdp` plus file upload are powerful. Encode these rules in your agent's instructions:

- **read-only by default**; ask the user before submitting, saving, deleting, publishing, uploading, or sending anything;
- the user logs in themselves: never request passwords or codes, never read or print cookies, tokens, or local storage;
- never commit `config.json` or the token, and never paste them into a chat;
- never expose the bridge beyond localhost;
- CDP shows a "Chrome is being debugged" banner and conflicts with the user's own DevTools; detach when done.

These are **instructions for the agent**, not an enforced approval layer. The caller still owns the authorization boundary.

## 13. Development and debugging

### 13.1 Commands

| Command | Purpose |
| --- | --- |
| `npm install` | install dependencies |
| `npm run build` | build the extension into `dist/` (includes the native host bundle) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run bridge:call` | send one JSON request straight to the bridge |

`npm run build` runs `scripts/generate-icons.mjs` and `scripts/build.mjs` (esbuild bundling for the extension, the bridge, the MCP server, and a fully self-contained native host bundle).

### 13.2 Extension status page

`chrome-extension://<EXTENSION_ID>/debug.html` is also what the toolbar icon opens. It does **only the one thing code cannot**: show you the link state and let you force a reconnect.

It contains: the connection state (`connected` / `connecting` / `reconnecting` / `error` / `disconnected`) with the last error text, the host name, the endpoint, the pending request count, `Connect` / `Disconnect` / `Reconnect`, the last 5 connection state and error events (tool request/response traffic is excluded — it would flush the history within a dozen calls), and `Copy diagnostics` — which copies the state, extension version, user agent, and recent events (never the token) so you can paste them into a chat or an issue.

The manual tool panels were removed (tabs, element actions, coordinates, screenshots, files, CDP, raw protocol logs). Driving those from code is less work:

```powershell
npm run bridge:call -- '{"protocol_version":"1","request_id":"t","tool":"browser.list_tabs","args":{}}'
```

### 13.3 Standalone bridge (protocol work only)

```powershell
npm run bridge        # start a standalone bridge
npm run bridge:dev    # build first, then start
```

It does **not** inherit control from the extension connected over native messaging, needs a compatible WebSocket client, and must not compete with the native host for the same port. Use `BROWSER_BRIDGE_PORT` / `BROWSER_BRIDGE_TOKEN` to control it; without a token it prints a random one — do not share that output.

## 14. External protocol

For your own clients. Normal MCP users never touch this.

First WebSocket message must authenticate:

```json
{"type":"auth","role":"agent","token":"<token from local config.json>"}
```

Success:

```json
{"type":"auth_result","ok":true,"role":"agent"}
```

Then send tool requests (the external protocol omits the extension's internal `kind` field):

```json
{
  "protocol_version": "1",
  "request_id": "req_123",
  "tool": "browser.get_page_state",
  "args": { "tab_id": 123, "frame_id": 0 }
}
```

Success response:

```json
{"request_id":"req_123","ok":true,"result":{}}
```

Failure response:

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

Behaviour:

- responses are matched by `request_id`; timeouts, extension disconnects, and bridge shutdown all clean up pending requests and return structured errors;
- unauthenticated messages never execute browser tools;
- a root-level `session_id` carries tab ownership (session tools additionally read it from their own args);
- native messaging framing is handled by Chrome, which validates `allowed_origins`, so the bridge token is not repeated there.

`scripts/call-tool.mjs` (`npm run bridge:call`) is a working reference client: it reads the local config automatically and accepts `BROWSER_BRIDGE_URL` / `BROWSER_BRIDGE_TOKEN` overrides.

## 15. Implementation notes

### 15.1 Layout

| Path | Responsibility |
| --- | --- |
| `src/core/` | Chrome-independent tool contract, argument validation, runtime dispatch |
| `src/chrome/` | Chrome adapters: tabs, CDP, screenshots, downloads, network, **frame enumeration**, session coordination |
| `src/content/` | Page Agent, element registry, revision tracking, action executor, console collector, agent cursor |
| `src/transport/` | Native messaging, runtime messages, tool transport |
| `src/bridge/` | local WebSocket bridge |
| `src/mcp/` | MCP server, bridge client, native host install CLI |
| `src/native-host/` | native host entry, config, framing |
| `src/debug/` | extension debug page |
| `scripts/` | build, install, and dev call scripts |
| `tests/` | unit tests |
| `docs/` | change and verification reports |

### 15.2 Page revision and element IDs

Each Document — including each frame — keeps its own revision. Navigation, reload, and "important DOM changes" advance it; `revision_reason` reports which (`navigation` / `refresh` / `important_dom`). The observer only reacts to added/removed interactive elements, semantic attribute changes on registered elements, and large structural batches (at most one advance per batch), so ordinary text edits do not invalidate IDs.

`browser.get_interactives` returns `tab_id`, `frame_id`, `page_revision`, `snapshot_id`, and elements with role, tag, accessible name, state, and bounds — **never selectors**. Password fields report `value_state: "redacted"`.

An `element_id` is opaque; the DOM reference lives only in the content script. Because every document gets its own token, **using an ID in the wrong frame surfaces as `stale_element`**.

### 15.3 Frame routing

- content scripts run with `all_frames: true` + `match_about_blank: true`, so `about:blank` / `srcdoc` frames get a Page Agent too;
- requests are addressed with `chrome.tabs.sendMessage(tabId, msg, { frameId })` — without a frame ID the message would race multiple agents for one response;
- on-demand injection targets one frame with `scripting.executeScript({ target: { tabId, frameIds: [frameId] } })`;
- MAIN-world console collection is best effort: a page CSP may block it without taking the Page Agent down (the result then reports `available: false`).

### 15.4 Screenshots, cursor, files

- screenshots go through CDP `Page.captureScreenshot`, so **background tabs work**; only the `captureVisibleTab` fallback needs an active tab;
- `full_page: true` uses the document's content size, so an app shell that scrolls inside a container can return viewport-sized output;
- coordinate and element actions briefly draw an `AI` cursor: it does not receive events, is never returned by `get_interactives`, and does not change the revision;
- `browser.set_files` marks the input temporarily, sets files via CDP `DOM.setFileInputFiles`, then cleans up; for non-top frames the lookup walks a `pierce`d node tree.

## 16. Current limitations

- **No OCR**: text inside images needs screenshots plus the model's own vision.
- **No Shadow DOM support**: `shadow_dom: false`; open shadow roots contribute text to page content, but their elements do not appear in `get_interactives`.
- **Frames are explicit**: the top document is the default; use `browser.get_frames`. Cross-origin frames cannot be driven.
- **Protected pages cannot be injected**: `chrome://`, the Chrome Web Store, and similar.
- **CDP conflicts with DevTools**: attaching fails if DevTools is already open on that tab, and shows a debug banner.
- **Console buffers are per document and lost on navigation**, and only cover the period after the collector started.
- **Network gives metadata only** (no response bodies), buffered in the service worker.
- **CDP event buffer**: 1000 events per tab, recorded only after attach.
- **Session isolation is cooperative**: it requires `session_id` on every call for that session.
- **Files and downloads**: uploads need absolute local paths; downloads expose only Chrome Downloads API metadata and cannot be reliably tied to a source tab.
- **Platform coverage**: verified on Windows; macOS scripts exist but are unverified on real hardware; no Linux installer.
- Unit tests cover protocol and dispatch logic; real-browser behaviour (injection, screenshots, CDP, iframes) was verified manually — see `docs/`.
