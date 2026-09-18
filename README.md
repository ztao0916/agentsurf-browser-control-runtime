# AgentSurf

**中文** ｜ [English](README.en.md)

AgentSurf 是一个让 AI Agent 控制**你自己的本机 Chrome** 的浏览器运行时。它复用你当前 Chrome 的登录态，把页面观察、点击、输入、截图、iframe、Console/Network 观测等能力统一成 `browser.*` 工具，通过本地 MCP Server 暴露给任意支持 MCP 的 Agent。它不内置模型调用、任务规划，也不绑定特定 AI 产品。

![AgentSurf 动态演示：Agent 通过本地运行时操作用户已登录的 Chrome](docs/assets/agentsurf-demo.svg)

> 本项目**不通过 Chrome 应用商店分发**，也没有发布公开 npm 包。接入方式是从源码构建、以「未打包扩展」加载到 Chrome，再在本机注册 Native Host。
>
> Windows 与 macOS 均已真机验证；Linux 暂未提供安装脚本。首次接入通常 5–10 分钟，步骤会写清**在哪个窗口执行**、**会看到什么**、**失败了去哪查**。

## 快速开始

推荐直接用向导完成依赖安装、构建和 Native Host 注册：

```bash
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm run setup
```

向导会依次安装依赖、构建扩展，提示你把 `dist/` 加载到 `chrome://extensions`，输入扩展 ID 后注册 Native Host，并打印可直接粘贴的 MCP 配置 JSON；交互式终端还会可选运行 smoke test。

需要逐步排查或手动安装时，见[第 4 节](#4-安装)。

## 目录

- [1. 它是什么](#1-它是什么)
- [2. 工作原理](#2-工作原理)
- [3. 接入方案选择](#3-接入方案选择)
- [4. 安装（Windows / macOS）](#4-安装)
- [5. 验证接入是否成功](#5-验证接入是否成功)
- [6. 在 Agent 里怎么用](#6-在-agent-里怎么用)
- [7. 更新、移动目录、卸载](#7-更新移动目录卸载)
- [8. 排障](#8-排障)
- [9. 安全边界](#9-安全边界)
- [10. 当前限制](#10-当前限制)
- [11. 深入参考](#11-深入参考)
- [12. 许可证](#12-许可证)

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

## 3. 接入方案选择

一共有两条接入路径，按需选一条即可。

### 方案 A：MCP Server（推荐，适用绝大多数 Agent）

Agent ↔ `dist/mcp/cli.js`（stdio MCP Server）↔ Bridge ↔ 扩展。

优点：Agent 侧零协议负担，工具与参数由 MCP 自动暴露。

### 方案 B：自研客户端直接连 Bridge

你的程序 ↔ 本机 WebSocket Bridge（自行完成 `auth` 握手与请求封装）。

适用：非 MCP 的运行环境、自己写调度器、或需要精细控制超时与并发。协议见 [外部调用协议](docs/reference.md#4-外部调用协议)。

> 两种方案都需要先完成下面第 4 节的**扩展 + Native Host** 安装，那是所有能力的地基。

## 4. 安装

Windows 和 macOS 都在这一节。先看 4.1 的差异对照表，之后每一步都分成两栏，**照着自己那一栏做**。全程不需要管理员权限，也不会改动你 Chrome 里已有的登录态和设置。

### 4.1 两个平台的差异

| 事项 | Windows | macOS |
| --- | --- | --- |
| 用哪个命令行 | **PowerShell**（开始菜单搜索 `PowerShell`） | **终端**（`⌘ + 空格` 输入「终端」） |
| 需要先装什么 | [Node.js LTS](https://nodejs.org/)（自带 npm）、[Git](https://git-scm.com/)、Chrome 116+ | 同上；也可以 `brew install node git` |
| 注册 Native Host | `npm run native-host:install -- -ExtensionId <扩展ID>` | `npm run native-host:install:macos -- "<扩展ID>"` |
| 需要管理员权限吗 | 不需要（只写当前用户的注册表项） | **不要加 `sudo`**，否则注册信息会写到错误的位置 |
| 注册信息写在哪 | 注册表 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.browsercontrol.runtime` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.browsercontrol.runtime.json` |
| 运行时目录 | `%LOCALAPPDATA%\BrowserControlRuntime\` | `~/Library/Application Support/BrowserControlRuntime/` |
| 给 MCP 客户端用的启动器 | `agentsurf-mcp.exe` | `agentsurf-mcp.sh` |
| 扩展本身 | 完全相同，同一份 `dist/` | 完全相同 |

一句话：**扩展、协议、MCP 配置格式两个平台完全一样，差别只在「命令怎么写」和「文件放在哪」。**

> ✅ Windows 与 macOS 路径均已在真机验证完整链路；Linux 暂未提供安装脚本。

### 4.2 前置环境

| 需要 | 检查命令 | 没有怎么办 |
| --- | --- | --- |
| Node.js 20+ | `node -v` | 到 [nodejs.org](https://nodejs.org/) 下载 **LTS**：Windows 选 `.msi`，macOS 选 `.pkg`，一路下一步 |
| npm 10+ | `npm -v` | 装完 Node 就自带，不用单独装 |
| Git | `git --version` | Windows 到 [git-scm.com](https://git-scm.com/) 下载安装；macOS 执行这条命令会提示自动安装 |
| Chrome 116+ | 地址栏输入 `chrome://version` | 升级 Chrome 即可 |

装完 Node 或 Git 后**要重新打开命令行窗口**，否则还是提示找不到命令。

### 4.3 下载并构建

> 也可以直接在项目目录运行 `npm run setup`：它会执行下面的安装、构建，并继续引导扩展 ID 输入与 Native Host 注册。下面保留手动步骤，方便排障。

**Windows（PowerShell）**

```powershell
cd $HOME\Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

**macOS（终端）**

```sh
cd ~/Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

`npm run build` 最后输出 `Done in ...` 就是成功，项目里会多出一个 `dist/` 目录。

三条容易踩的规则：

- Chrome 加载的是 **`dist/`**，不是 `src/`；
- `dist/` **不进 Git，每台电脑都要自己构建一次**；
- 改了源码**必须重新 `npm run build`**，Chrome 不会自动更新。

### 4.4 把扩展装进 Chrome

两个平台完全一样：

1. Chrome 地址栏打开 `chrome://extensions`；
2. 右上角打开 **开发者模式**；
3. 点 **加载已解压的扩展程序**，选择项目里的 **`dist`** 目录（不是项目根目录）；
4. 在 AgentSurf 卡片上记下 **扩展 ID**（32 位小写字母，例如 `hpageihlnphdohcplmimhmghljpilbpa`）。

此时卡片上可能显示连不上，**这是正常的**：Native Host 还没注册。

> ⚠️ 换电脑、换项目路径、删除后重新加载，扩展 ID 都可能变化。**永远以 `chrome://extensions` 当前显示的为准**，不要沿用旧文档或聊天记录里的 ID。

### 4.5 注册 Native Host

把 `<扩展ID>` 换成第 4.4 步记下的那串字符。**必须在项目目录里执行**。

**Windows（PowerShell）**

```powershell
$extensionId = "<扩展ID>"
npm run native-host:install -- -ExtensionId $extensionId
```

**macOS（终端）**

```sh
npm run native-host:install:macos -- "<扩展ID>"
```

脚本会做四件事（两个平台对应关系见 4.1 的表格）：

| 动作 | 作用 |
| --- | --- |
| 写配置 `config.json` | 记录端口（默认 `8765`）和随机生成的 64 位 token |
| 生成 Native Host 启动器 | 固定当前 Node 与项目 `dist/` 的绝对路径 |
| 写 Native Messaging manifest | `allowed_origins` 只允许你填的这个扩展 ID |
| 注册到系统 | Windows 写注册表；macOS 写用户目录下的 manifest |

跑完后终端会**打印一段现成的 MCP 配置 JSON**：下一步直接整段复制粘贴，不用自己拼路径。

Windows 上如果提示文件被占用，先在 `chrome://extensions` 里**禁用** AgentSurf（或关掉 Chrome），等一秒再跑一次即可。重新安装会**复用已有的有效 token**，不需要重新配置 MCP。

### 4.6 重新加载扩展并确认链路

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

### 4.7 接到你的 Agent（MCP 配置）

把第 4.5 步终端打印的那段 JSON 粘到 Agent 的 MCP 配置文件里。以 pi 的 `~/.pi/agent/mcp.json` 为例：

**Windows**

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "C:/Users/<用户名>/AppData/Local/BrowserControlRuntime/agentsurf-mcp.exe"
    }
  }
}
```

**macOS**

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "/Users/<用户名>/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh"
    }
  }
}
```

> 其他 MCP 客户端同理，只是配置文件的**位置**不同，粘贴的 JSON 内容完全一样。

四个要点：

- **没有 `args`**。把终端打印出来的那段整段复制，**不要自己拼路径**；
- 改完配置**要重启 MCP 客户端**（或它的会话），配置只在启动时读一次；
- 不需要任何环境变量，MCP Server 会自动读取第 4.5 步生成的 `config.json`；
- 换电脑、移动项目目录、切换 Node 版本后，**重跑第 4.5 步那一条命令**就能重新生成启动器。

<details>
<summary>备选写法：不用启动器，直接指向 node 与 cli.js</summary>

如果客户端要求显式给出解释器：

**Windows**

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
(Get-Command node).Source            # Node 可执行文件路径
(Resolve-Path dist/mcp/cli.js).Path  # MCP Server 入口路径
```

**macOS**

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/<用户名>/Desktop/agentsurf-browser-control-runtime/dist/mcp/cli.js"]
    }
  }
}
```

```sh
which node                 # Node 可执行文件路径
realpath dist/mcp/cli.js   # MCP Server 入口路径
```

代价：两条绝对路径都要自己维护，而且客户端的进程环境里必须能看到 `node`（GUI 客户端不一定）。启动器写法把这些都包在里面了。

</details>

### 4.8 让 Agent 确认工具可用

对 Agent 说：

```text
列出你现在可用的 browser_* 工具。
```

应看到 **30** 个工具，其中包括 `browser_get_frames`、`browser_select_text`、`browser_get_console_messages`、`browser_screenshot`。

（工具清单由 MCP 客户端从 Server 拿到，没有单独的“查询能力”工具；`browser.get_capabilities` 已移除。）

### 4.9 装完怎么确认真的通了

- **不经过 MCP 客户端**直接验全链路（在项目目录执行，返回 `ok: true` 和一串标签页就算通）：

```powershell
node scripts/call-tool.mjs '{"protocol_version":"1","request_id":"smoke","tool":"browser.list_tabs","args":{}}'
```

  PowerShell 和 bash/zsh 都直接用单引号包住整段 JSON；JSON 里不要有空格，否则 PowerShell 会把参数拆开。

- 这里失败 → 链路问题，看[第 8 节 排障](#8-排障)；
- 这里成功但 Agent 里失败 → MCP 配置问题，回第 4.7 步检查路径与客户端重启；
- 更完整的验证清单（Bridge 是否监听、端到端冒烟）见[第 5 节](#5-验证接入是否成功)。

## 5. 验证接入是否成功

按“从里到外”的顺序验证，出问题时最容易定位。

### 5.1 Bridge 是否在监听

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

### 5.2 全链路是否通（不经过 MCP 客户端）

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
| 这里失败 | 链路问题，看[第 8 节](#8-排障) |
| 这里成功、MCP 里失败 | MCP 配置问题（路径、Node、是否重启客户端） |

### 5.3 端到端冒烟

在 Agent 里依次让它做：

1. `browser_list_tabs` —— 能列出标签页；
2. `browser_get_page_content`（带某个普通网页的 `tab_id`）—— 能读到正文；
3. `browser_screenshot` —— 能拿到图片（截图依赖 CDP，会附加调试器，页面上出现“Chrome 正在被调试”横幅；重新加载该页签即可去掉）。

## 6. 在 Agent 里怎么用

### 6.1 只读流程（推荐先跑一遍）

```text
1. browser_list_tabs                      # 先看清有哪些标签页，避免动到用户正在用的页面
2. browser_open {"url":"https://example.com","activate":true}
                                          # 打开页面拿到 tab_id
3. browser_get_page {"tab_id":...}         # 确认 URL / 加载状态 / revision
4. browser_get_page_content {"tab_id":...}
                                          # 读正文；SPA 或外壳页可能要配合 frames
```

注意：**`browser_get_page` 只返回页面元信息，不是正文抓取工具**；打开网址用 `browser_open`（**没有** `browser_navigate`）。

### 6.2 元素操作流程（element_id 模式）

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

### 6.3 iframe / 子框架（重要）

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

### 6.4 观测与排错

```text
browser_get_console_messages {"tab_id": 123}          # console.log/error、未捕获异常、未处理 rejection
browser_get_console_messages {"tab_id": 123, "frame_id": 561}
browser_observe {"tab_id": 123}                       # 一次拿 状态+交互元素+可访问性树+截图
```

Console 采集运行在页面 MAIN world，能捕获页面自身的输出。**采集器只在 agent 认领的 tab 上安装，并在每次导航后重新注入**：没被 agent 操作过的页面完全不碰它的 `console`。查询结果里 **`available: false` 表示当时采集器不在场，不能当成「页面没有报错」**。

### 6.5 多对话并行（默认自动隔离）

每个对话的 MCP Server 进程会自带一个会话，**Agent 不需要手动开会话，也不需要每次传 `session_id`**：

- 自己 `browser.open` 打开的页签会**自动建立归属并归入本会话的 Chrome 分组**；组名**默认取这个对话碰到的第一个页面的标题**（如「禅道 - 任务 17824」），该页面没有标题时退回 `AI · <4位ID>`；
- **想让分组直接显示任务名**：在任意一次调用里带上 `session_name`（如 `{"tab_id": 123, "session_name": "禅道 17824"}`）。它对该对话长期生效，已经建好的分组会当场改名，且之后不再被页面标题覆盖；
- 另一个对话再想操作这些页签会被拒绝（`tab_in_use`），两个对话不会互相踩；
- 需要接管用户**已经打开**的页签时用 `browser.claim_tab`：它会建立归属并**默认归组**（传 `group: false` 可只归属、不把页签拉进分组）；
- `browser.list_tabs` 默认只列出**本对话的页签 + 尚未归属的页签**，并用 `other_session_tabs` 告诉你隐藏了几个；传 `include_all: true` 可以看到全部（脚本、排查用）；
- **租约对所有调用都生效**：不带 `session_id` 的调用（脚本、CLI）碰到别人已占用的页签同样报 `tab_in_use`，不会再静默放行；脚本要接管就先发 `browser.start_session`（它仍在协议里，只是不暴露给 Agent）再 `claim_tab`；
- 收尾用 `browser.reset_sessions`，它释放本对话的租约并解除分组。

边界与注意：

- 自动隔离的前提是“一个对话 = 一个 MCP Server 进程”（PiDeck 给每个对话起独立进程，满足此条件）。若某个客户端把多个对话复用到同一个进程，它们会共用同一个会话，此时可用显式 `session_id` 手动区分；
- 主动 `browser.open` 一个已有 `tab_id`（即导航已有页签）会建立归属但**不**动你的标签栏；
- 租约存在扩展的 `storage.session` 里（**Chrome 重启即清空**），会话记录在 `storage.local` 里是持久的；
- **空闲自动回收**：某个对话被直接关掉（没有主动收尾）时，它占用过的页签在**空闲 30 分钟**后自动释放**并解除分组**，别的对话即可接管；正在使用的页签会续租，不会被误抢；
- **任务收尾**：干完活（不再需要那些页签）时调用 `browser.reset_sessions`，它会**立即**释放本对话的租约并解除分组；不调的话，分组会留到空闲超时才消失。它**不关闭页签**，要关页签再单独用 `browser.close_tab`；
- **重载/重启后的收尾**：重新加载扩展或重启 Chrome 会清空租约（Chrome 行为），此时运行时会在启动时把“会话还在、租约已无”的漏网分组一并解除，不会留下无主的分组；有租约（正在干活）的页签不动；
- **手动兜底**：`browser.reset_sessions` 默认只释放**本对话自己的**会话与租约，并顺带清掉“拥有者已不存在”的租约（正是页签被消失的对话卡住的情形）；它**不会**动别的对话，返回值里的 `other_sessions_kept` 会告诉你还有几个会话没动。确实需要清全局（会释放并解除所有人的分组）时才传 `force: true`。

## 7. 更新、移动目录、卸载

### 7.1 按改动范围决定动作

| 你改了什么 | 需要做什么 |
| --- | --- |
| 扩展代码、Page Agent、Content Script | `npm run build` → 重新加载扩展 |
| **manifest.json（content_scripts 等）** | `npm run build` → **必须**重新加载扩展；刷新页面无效 |
| Native Host 源码或安装脚本 | 先禁用扩展 → 构建 → 重新安装 Native Host → 再启用 |
| MCP Server 代码 | 构建 → 重启 MCP 客户端 |
| 项目路径 / 扩展 ID / Node 路径 | 重新注册 Native Host |

已经启动的 Host 不会自动加载新 JS，必须让它重启（禁用/启用扩展，或重新加载扩展）。

### 7.2 完整更新流程（Windows）

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

### 7.3 移动目录

启动器里写死的是**安装时**的项目路径（`<项目>/dist/native-host/host.js`）。移动或重命名项目后：

1. 禁用旧扩展；
2. 在新目录 `npm install && npm run build`；
3. 在 Chrome 加载新目录的 `dist/`，记录新的扩展 ID；
4. 在新目录重新执行 `native-host:install`；
5. 重新加载扩展，重启 MCP 客户端。

> 补充一个实测结论：`%LOCALAPPDATA%\BrowserControlRuntime\` 下的 `host.js` 是**历史遗留副本，没有任何东西引用它**（启动器指向仓库 `dist/` 里的那份）。排查问题时不要被它误导。

### 7.4 卸载

```powershell
# Windows
npm run native-host:uninstall
```

```sh
# macOS
npm run native-host:uninstall:macos
```

卸载只移除 Native Host 注册与启动器，**保留配置**；不会删除 Chrome 扩展，也不会删除项目目录。要彻底清理：先在 `chrome://extensions` 移除扩展，再删除项目目录与 `%LOCALAPPDATA%\BrowserControlRuntime`（macOS 为 `~/Library/Application Support/BrowserControlRuntime`）。

## 8. 排障

### 8.1 常见现象对照

| 现象 | 含义与处理 |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:8765` | 没有任何进程在监听。扩展未启用、Host 未安装，或扩展还没完成连接。**先看 `debug.html` 状态** |
| `Chrome Extension is not connected` | Bridge 活着，但没有扩展接进来。检查 `debug.html`、Host 握手，以及 `dist` 是否是当前构建 |
| `EADDRINUSE` | 8765 被占用：排查误启动的独立 Bridge、上个未退出的 Host、或另一个 Chrome 配置里的同名扩展 |
| `frame_not_found` | 目标框架已不存在（框架导航/重建）。可重试：重新 `browser_get_frames` |
| `stale_element` | 元素 ID 过期（页面变更），或**你在错的地方找它**（例如忘了带 `frame_id`）。重新 `browser_get_interactives` |
| `element_not_visible` / `element_disabled` / `element_not_editable` | 元素存在但不满足操作前提。不要强行点，先看页面实际状态 |
| `unsupported_page` | Chrome 不允许在该页面注入 Page Agent（`chrome://`、应用商店页等）。换普通 HTTP/HTTPS 页面 |
| `screenshot_unavailable` | 截图调用失败：降级路径下目标不是活动标签页，或 Chrome 截图本身报错。**页面在截图期间变化不再算失败**，结果会带 `page_changed: true` |
| `tool is unsupported` | 工具名不被当前运行时支持。对照 Agent 手上的工具清单，不要急着重装 |
| 安装时报 `native-host.exe` 被占用 | 先禁用扩展、等旧 Host 退出再安装。**不要**批量结束 `node.exe` |

### 8.2 定位顺序

1. `chrome://extensions`：扩展是否启用？有没有报错？
2. `debug.html`（或点工具栏图标）：连接状态与最近事件；
3. 端口是否有监听（见 5.1）；
4. `node scripts/call-tool.mjs ...`（见 5.2）区分链路问题与 MCP 配置问题；
5. 必要时打开扩展的 **Service Worker 检查窗口**看 Native Messaging 报错。

### 8.3 三个最容易踩的坑

1. **改了 manifest 只刷新页面** → 不生效。`content_scripts`、权限这类改动**必须重新加载扩展**。
2. **用旧扩展 ID** → Host 注册的 `allowed_origins` 不匹配，连接会被 Chrome 拒绝。以 `chrome://extensions` 当前显示为准。
3. **切过 Node 版本（nvm）** → 启动器里记录的 Node 绝对路径失效，重新跑一次安装命令。

分享日志前请移除 token 与敏感页面数据。

## 9. 安全边界

AgentSurf 能操作你登录态下的页面，文件上传等能力很强。建议在 Agent 的使用规则里写死：

- **默认只读**；提交、保存、删除、发布、上传、发送消息等会修改线上数据的操作，先取得用户明确授权；
- 登录由用户自行完成：不索取密码/验证码，不读取或输出 Cookie、Token、LocalStorage 等认证信息；
- 不把本机 `config.json`、token、敏感页面数据提交进仓库或粘贴到聊天里；
- 不把 Bridge 暴露到外网；
- 截图会经由 CDP 弹“Chrome 正在被调试”横幅，并与用户自己的 DevTools 冲突；用完重新加载该标签页即可去掉。

以上是**给 Agent 的使用约束**，不代表运行时已实现人工审批；调用方仍需自己管理授权边界。

## 10. 当前限制

- **无 OCR**：图片里的文字需要靠截图 + 模型自身视觉能力；
- **无 Shadow DOM 专门支持**：开放 Shadow Root 的文本会并入页面正文，但元素不会进入 `get_interactives`；
- **iframe 需显式寻址**：默认只作用于顶层文档，必须配合 `browser.get_frames`；跨域框架通常无法注入；
- **受保护页面不可注入**：`chrome://`、Chrome 应用商店等；
- **CDP 与 DevTools 互斥**：同一标签页已开 DevTools 时 `attach` 会失败；attach 期间会有调试横幅；
- **Console 跨导航丢失**：缓冲在页面内，刷新/跳转后清空；且只能看到采集器在场之后的输出；
- **会话隔离是协作式的**：必须每次调用都带 `session_id` 才生效；
- **文件上传/下载限制**：上传需本机绝对路径；下载只能拿到 Chrome Downloads API 提供的元数据，且无法可靠关联来源标签页；
- **平台覆盖**：Windows 与 macOS 均已真机验证；Linux 未提供安装脚本；
- 单元测试覆盖协议与调度逻辑，真机链路（注入、截图、CDP、iframe）依赖手工验证，见 `docs/`。

## 11. 深入参考

面向开发者、以及需要绕开 MCP 直接对接协议的场景，以下内容已拆到单独文件 [docs/reference.md](docs/reference.md)：

| 内容 | 说明 |
| --- | --- |
| [1. 工具速查](docs/reference.md#1-工具速查) | 30 个 `browser.*` 工具的分组清单、`frame_id` / `modifiers` 支持范围、`get_interactives` 的过滤与截断语义 |
| [2. 错误码与重试语义](docs/reference.md#2-错误码与重试语义) | 结构化错误对象、每个 `code` 是否可重试、建议动作 |
| [3. 开发与调试](docs/reference.md#3-开发与调试) | 构建 / lint / 测试命令、扩展状态页、独立 Bridge |
| [4. 外部调用协议](docs/reference.md#4-外部调用协议) | 不用 MCP，自己写客户端直连本地 Bridge |
| [5. 实现细节](docs/reference.md#5-实现细节) | 目录结构、page revision 与 `element_id`、frame 路由、截图与文件传输 |

## 12. 许可证

本项目采用 [Apache License 2.0](LICENSE)，包含第 3 节专利授权。
