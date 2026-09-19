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

把安装脚本终端打印的那段 JSON 整段粘到 Agent 的 MCP 配置文件里。以 pi 的 `~/.pi/agent/mcp.json` 为例（`command` 用脚本打印的那个路径）：

```jsonc
{
  "mcpServers": {
    "agentsurf": {
      "command": "安装脚本打印的启动器的绝对路径"
      // 例如："command": "/Users/XXX/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh"
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
- [4. 在 Agent 里怎么用](#4-在-agent-里怎么用)
- [5. 安全边界](#5-安全边界)
- [6. 许可证](#6-许可证)

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

## 4. 在 Agent 里怎么用

直接在对话里让 Agent 操作浏览器，例如打开网页、读取页面内容或截图。

如果它能完成操作，就说明已经接好了。

## 5. 安全边界

AgentSurf 能操作你登录态下的页面，文件上传等能力很强。建议在 Agent 的使用规则里写死：

- **默认只读**；提交、保存、删除、发布、上传、发送消息等会修改线上数据的操作，先取得用户明确授权；
- 登录由用户自行完成：不索取密码/验证码，不读取或输出 Cookie、Token、LocalStorage 等认证信息；
- 不把本机 `config.json`、token、敏感页面数据提交进仓库或粘贴到聊天里；
- 不把 Bridge 暴露到外网；
- 截图会经由 CDP 弹“Chrome 正在被调试”横幅，并与用户自己的 DevTools 冲突；用完重新加载该标签页即可去掉。

以上是**给 Agent 的使用约束**，不代表运行时已实现人工审批；调用方仍需自己管理授权边界。

## 6. 许可证

本项目采用 [Apache License 2.0](LICENSE)，包含第 3 节专利授权。
