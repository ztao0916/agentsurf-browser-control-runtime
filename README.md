# AgentSurf

[![CI](https://github.com/ztao0916/agentsurf-browser-control-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/ztao0916/agentsurf-browser-control-runtime/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/ztao0916/agentsurf-browser-control-runtime?label=License)](LICENSE)
[![Open Source](https://img.shields.io/badge/Open%20Source-Yes-2ea44f)](https://opensource.org/license/apache-2-0)

**中文** ｜ [English](README.en.md)

> 本项目已链接认可 [LINUX DO](https://linux.do/) 社区。

AgentSurf 是一个让 AI Agent 控制**你自己的本机 Chrome** 的浏览器运行时。可以把它理解为 ChatGPT 浏览器插件的通用版本：同样是让 AI 直接操作浏览器，但不绑定 ChatGPT，任何支持 MCP 的 Agent 都能接入。它复用你当前 Chrome 的登录态，把页面观察、点击、输入、截图、iframe、Console 观测等能力统一成 `browser.*` 工具，通过本地 MCP Server 暴露给 Agent。它不内置模型调用，也不负责任务规划。

![AgentSurf 动态演示：Agent 通过本地运行时操作用户已登录的 Chrome](docs/assets/agentsurf-demo.svg)

> 接入方式：MCP Server。Windows 与 macOS 均已真机验证；首次接入通常 5–10 分钟，把这段说明交给 AI，让它带你一步步接入即可。

## 快速开始

Windows 与 macOS 均已真机验证。全程不需要管理员权限，也不会改动你 Chrome 里已有的登录态和设置。

### 前置环境

| 需要 | 版本要求与检查命令 |
| --- | --- |
| Node.js | 20+，`node -v` |
| npm | 10+，`npm -v` |
| Chrome | 116+，地址栏打开 `chrome://version` |

### 安装并注册

首次安装依次执行：

```bash
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm run setup
```

向导会自动完成依赖安装、构建与 Native Host 注册，并在过程中提示你：

1. 打开 `chrome://extensions`，开启开发者模式；
2. 点击“加载已解压的扩展程序”，选择项目里的 `dist/`；
3. 复制 AgentSurf 卡片上显示的扩展 ID，粘贴回终端；
4. 复制终端最后打印的 MCP 配置 JSON，下一步会用到。

> 换电脑、移动项目目录或重新加载扩展后，如果扩展 ID 发生变化，重新运行 `npm run setup` 即可。

### 重新加载扩展并确认链路

1. 回到 `chrome://extensions`，点 AgentSurf 卡片上的 **重新加载**（🔄）；
2. 打开下面的地址（也可以直接点工具栏上的 AgentSurf 图标，弹的是同一页）：

```text
chrome-extension://<扩展ID>/debug.html
```

3. 期望看到：

```text
● connected
Host      com.browsercontrol.runtime
Endpoint  ws://127.0.0.1:8765
Pending   0
```

显示未连接时：点一次 **Disconnect**，等 1 秒，再点 **Connect**。**不要连续点 Reconnect**，那会造成重连风暴。

### 接到你的 Agent（MCP 配置）

把安装脚本终端打印的那段 JSON 整段粘到 Agent 的 MCP 配置文件里。以 pi 的 `~/.pi/agent/mcp.json` 为例，下面使用本机 macOS 的实际启动器路径作为参考 Demo（请以安装脚本打印的路径为准）：

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "/Users/zhangtao/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh"
    }
  }
}
```

> 其他 MCP 客户端同理，只是配置文件的**位置**不同，粘贴的 JSON 内容完全一样。

四个要点：

- **没有 `args`**。把终端打印出来的那段整段复制，**不要自己拼路径**；
- 改完配置**要重启 MCP 客户端**（或它的会话），配置只在启动时读一次；
- 不需要任何环境变量，MCP Server 会自动读取安装时生成的 `config.json`；
- 换电脑、移动项目目录、切换 Node 版本后，**重新运行 `npm run setup`** 就能重新生成启动器。

### 让 Agent 确认工具可用

对 Agent 说：

```text
列出你现在可用的 browser_* 工具。
```

应看到 **30** 个工具，其中包括 `browser_get_frames`、`browser_select_text`、`browser_get_console_messages`、`browser_screenshot`。

（工具清单由 MCP 客户端从 Server 拿到，没有单独的“查询能力”工具；`browser.get_capabilities` 已移除。）

### 装完怎么确认真的通了

- **不经过 MCP 客户端**直接验全链路（在项目目录执行，返回 `ok: true` 和一串标签页就算通）：

```sh
node scripts/call-tool.mjs '{"protocol_version":"1","request_id":"smoke","tool":"browser.list_tabs","args":{}}'
```

- 这里失败 → 链路问题；
- 这里成功但 Agent 里失败 → MCP 配置问题，回到 [MCP 配置](#接到你的-agentmcp-配置)检查路径并重启客户端；
- 更完整的验证清单（Bridge 是否监听、端到端冒烟）见[第 4 节](#4-验证接入是否成功)。

## 为什么要写这个

起因很实际：新版 Codex 里操作浏览器经常报错（这是我自己的体感），与其等它修，不如自己写一条更稳的链路。

设计上的判断是：与其让 Agent 每次另开一个干净浏览器、再想办法把登录态搬过去，不如让它直接用你手上这个 Chrome——登录态、标签页、扩展都是现成的，少一层「准备环境」，就少一类报错。

所以 AgentSurf 的目标不是做一个功能更全的浏览器自动化框架，而是把「Agent 控制浏览器」这条路做稳：链路可以验证，出错可以定位，同一个 Chrome 里的上下文可以直接复用。这个思路也不局限于 Codex，换成其它支持 MCP 的 Agent 同样适用。

## 使用体验

以下是我在三个客户端里的实机体验，供参考：

- **Codex**：接入顺利，工具能被正常识别和调用，日常网页操作体验不错；
- **Command Code agent**：按同样的 MCP 方式接入，整个过程没有遇到问题；
- **pi agent**：接入同样顺利，使用体验和前两者基本一致。

三个客户端都能正常接入和调用，整体体验比较稳定顺手。以上是我的主观体验，不同 Agent 的调用风格和最终效果可能有所不同。

## 目录

- [1. 它是什么](#1-它是什么)
- [2. 工作原理](#2-工作原理)
- [3. 接入方式（MCP Server）](#3-接入方式mcp-server)
- [4. 验证接入是否成功](#4-验证接入是否成功)
- [5. 在 Agent 里怎么用](#5-在-agent-里怎么用)
- [6. 安全边界](#6-安全边界)
- [7. 许可证](#7-许可证)

## 1. 它是什么

一句话：**你的 Agent 想操作网页时，不用自己开一个干净浏览器，而是直接借用你正在用的那个 Chrome。**

它做什么：

- 复用你现有的 Chrome 登录态和标签页，不需要重新登录、不需要导出 Cookie；
- 提供 **30 个 `browser.*` 工具**：标签页、页面读取、元素点击/输入、表单、滚动、拖拽、截图、iframe、Console、下载、文件上传；
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
              │  chrome.tabs.sendMessage / chrome.debugger
              ▼
        网页（Page Agent Content Script，注入所有 frame）
```

几个关键点：

- **扩展是主动方**：它启动时通过 `connectNative` 拉起 Native Host，Host 再启动 Bridge。所以正常使用**不需要手动运行 `npm run bridge`**。
- **扩展自己不监听任何端口**，Bridge 只监听 `127.0.0.1`，并要求 token 认证（token 由安装脚本随机生成，保存在本机 `config.json`，不需要你复制粘贴到对话里）。
- **MCP Server 与 Native Host 共用同一份本机配置**，所以 MCP 侧不需要手工填 token。
- 只有在“协议开发”场景才需要独立 Bridge，见 [开发与调试](docs/reference.md#3-开发与调试)。

## 3. 接入方式（MCP Server）

Agent ↔ `dist/mcp/cli.js`（stdio MCP Server）↔ Bridge ↔ 扩展。

Agent 侧零协议负担：工具与参数由 MCP 自动暴露，你只需要在客户端的 MCP 配置里填一段 JSON，见[快速开始中的 MCP 配置](#接到你的-agentmcp-配置)。

> 接入前需要先完成[快速开始](#快速开始)中的扩展与 Native Host 安装，那是所有能力的地基。

## 4. 验证接入是否成功

按“从里到外”的顺序验证，出问题时最容易定位。

### 4.1 Bridge 是否在监听

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

### 4.2 全链路是否通（不经过 MCP 客户端）

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
| 这里失败 | 链路问题 |
| 这里成功、MCP 里失败 | MCP 配置问题（路径、Node、是否重启客户端） |

### 4.3 端到端冒烟

在 Agent 里依次让它做：

1. `browser_list_tabs` —— 能列出标签页；
2. `browser_get_page_content`（带某个普通网页的 `tab_id`）—— 能读到正文；
3. `browser_screenshot` —— 能拿到图片（截图依赖 CDP，会附加调试器，页面上出现“Chrome 正在被调试”横幅；重新加载该页签即可去掉）。

## 5. 在 Agent 里怎么用

### 5.1 只读流程（推荐先跑一遍）

```text
1. browser_list_tabs                      # 先看清有哪些标签页，避免动到用户正在用的页面
2. browser_open {"url":"https://example.com","activate":true}
                                          # 打开页面拿到 tab_id
3. browser_get_page {"tab_id":...}         # 确认 URL / 加载状态 / revision
4. browser_get_page_content {"tab_id":...}
                                          # 读正文；SPA 或外壳页可能要配合 frames
```

注意：**`browser_get_page` 只返回页面元信息，不是正文抓取工具**；打开网址用 `browser_open`（**没有** `browser_navigate`）。

### 5.2 元素操作流程（element_id 模式）

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

### 5.3 iframe / 子框架（重要）

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

### 5.4 观测与排错

```text
browser_get_console_messages {"tab_id": 123}          # console.log/error、未捕获异常、未处理 rejection
browser_get_console_messages {"tab_id": 123, "frame_id": 561}
browser_observe {"tab_id": 123}                       # 一次拿 状态+交互元素+可访问性树+截图
```

Console 采集运行在页面 MAIN world，能捕获页面自身的输出。**采集器只在 agent 认领的 tab 上安装，并在每次导航后重新注入**：没被 agent 操作过的页面完全不碰它的 `console`。查询结果里 **`available: false` 表示当时采集器不在场，不能当成「页面没有报错」**。

### 5.5 多对话并行（默认自动隔离）

每个对话的 MCP Server 进程会自带一个会话，**Agent 不需要手动开会话，也不需要每次传 `session_id`**：

- 自己 `browser.open` 打开的页签会**自动建立归属并归入本会话的 Chrome 分组**；组名**默认取这个对话碰到的第一个页面的标题**（如「禅道 - 任务 17824」，页签还在加载、标题就是 URL 时改用域名），该页面没有标题时才用 `AgentSurf`；
- **想让分组直接显示任务名**：在任意一次调用里带上 `session_name`（如 `{"tab_id": 123, "session_name": "禅道 17824"}`）。它对该对话长期生效，已经建好的分组会当场改名，且之后不再被页面标题覆盖；
- 另一个对话再想操作这些页签会被拒绝（`tab_in_use`），两个对话不会互相踩；
- 需要接管用户**已经打开**的页签时用 `browser.claim_tab`：它会建立归属并**默认归组**（传 `group: false` 可只归属、不把页签拉进分组）；
- `browser.list_tabs` 默认只列出**本对话的页签 + 尚未归属的页签**，并用 `other_session_tabs` 告诉你隐藏了几个；传 `include_all: true` 可以看到全部（脚本、排查用）；
- **租约对所有调用都生效**：不带 `session_id` 的调用（脚本、CLI）碰到别人已占用的页签同样报 `tab_in_use`，不会再静默放行；脚本要接管就先发 `browser.start_session`（它仍在协议里，只是不暴露给 Agent）再 `claim_tab`；
- 收尾用 `browser.reset_sessions`：它解除分组、释放本对话的租约，并**关闭本对话自己 open 出来的页签**（用户原本就开着的页签绝不关）。

边界与注意：

- 自动隔离的前提是“一个对话 = 一个 MCP Server 进程”（PiDeck 给每个对话起独立进程，满足此条件）。若某个客户端把多个对话复用到同一个进程，它们会共用同一个会话，此时可用显式 `session_id` 手动区分；
- 主动 `browser.open` 一个已有 `tab_id`（即导航已有页签）会建立归属但**不**动你的标签栏；
- 租约存在扩展的 `storage.session` 里（**Chrome 重启即清空**），会话记录在 `storage.local` 里是持久的；
- **空闲自动回收**：某个对话被直接关掉（没有主动收尾）时，它占用过的页签在**空闲 30 分钟**后自动释放**并解除分组**，别的对话即可接管；正在使用的页签会续租，不会被误抢；
- **任务收尾**：干完活时调用 `browser.reset_sessions`，它会**立即**解除分组、释放租约，并**关闭本对话自己 open 出来的页签**（用户原有的页签只解除分组、不关）。不调的话，分组会留到空闲超时才消失。传 `close_opened_tabs: false` 可只解除分组、留着页签；返回值里的 `closed_tab_ids` 告诉你关掉了哪几个；
- **进程退出兜底**：客户端结束对话时会杀掉 MCP Server 进程（或关闭其 stdin），进程在退出前会尽力发一次 `reset_sessions`。被强杀（SIGKILL）时兜不住，那种情况仍靠下面的空闲回收；
- **重载/重启后的收尾**：重新加载扩展或重启 Chrome 会清空租约（Chrome 行为），此时运行时会在启动时把“会话还在、租约已无”的漏网分组一并解除，不会留下无主的分组；有租约（正在干活）的页签不动；
- **手动兜底**：`browser.reset_sessions` 默认只释放**本对话自己的**会话与租约，并顺带清掉“拥有者已不存在”的租约（正是页签被消失的对话卡住的情形）；它**不会**动别的对话，返回值里的 `other_sessions_kept` 会告诉你还有几个会话没动。确实需要清全局（会释放并解除所有人的分组）时才传 `force: true`——**`force` 只解除分组、绝不关页签**，因为那会毁掉别的对话正在做的事。

## 6. 安全边界

AgentSurf 能操作你登录态下的页面，文件上传等能力很强。建议在 Agent 的使用规则里写死：

- **默认只读**；提交、保存、删除、发布、上传、发送消息等会修改线上数据的操作，先取得用户明确授权；
- 登录由用户自行完成：不索取密码/验证码，不读取或输出 Cookie、Token、LocalStorage 等认证信息；
- 不把本机 `config.json`、token、敏感页面数据提交进仓库或粘贴到聊天里；
- 不把 Bridge 暴露到外网；
- 截图会经由 CDP 弹“Chrome 正在被调试”横幅，并与用户自己的 DevTools 冲突；用完重新加载该标签页即可去掉。

以上是**给 Agent 的使用约束**，不代表运行时已实现人工审批；调用方仍需自己管理授权边界。

## 7. 许可证

本项目采用 [Apache License 2.0](LICENSE)，包含第 3 节专利授权。
