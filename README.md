# AgentSurf

[![CI](https://github.com/ztao0916/agentsurf-browser-control-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/ztao0916/agentsurf-browser-control-runtime/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/ztao0916/agentsurf-browser-control-runtime?label=License)](LICENSE)
[![Open Source](https://img.shields.io/badge/Open%20Source-Yes-2ea44f)](https://opensource.org/license/apache-2-0)

**中文** ｜ [English](README.en.md)

> 本项目已在 [LINUX DO](https://linux.do/) 社区发布。

AgentSurf 让你正在使用的 AI Agent 直接操作你的本机 Chrome。可以把它理解为 ChatGPT 浏览器插件的通用版本：不绑定某个模型或客户端，任何支持 MCP 的 Agent 都可以接入。

它复用你当前的登录态和标签页，支持读取页面、点击、输入、滚动、截图、文件上传、iframe 和 Console 等常见操作。你不需要换浏览器，也不需要重新登录。

![AgentSurf 动态演示：Agent 通过本地运行时操作用户已登录的 Chrome](docs/assets/agentsurf-demo.svg)

> 已在 Codex、Command Code agent 和 pi agent 实测，均可正常接入和操作。Windows 与 macOS 均已真机验证；首次接入通常需要 5–10 分钟。

## 快速开始

把本 README 交给能操作电脑的 Agent，让它带你完成安装；也可以按下面的步骤手动操作。

### 1. 准备环境

| 需要 | 要求与检查方式 |
| --- | --- |
| Node.js | 20+，终端执行 `node -v` |
| Git | 终端执行 `git --version` |
| Chrome | 116+，地址栏打开 `chrome://version` |

> 不需要管理员权限，也不会修改你 Chrome 里已有的登录态和设置。

### 2. 安装

1. 克隆仓库并进入项目目录：

```bash
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
```

2. 执行安装向导：

```bash
npm run setup
```

向导会自动完成依赖安装、构建和 Native Host 注册，并提示你：

1. 打开 `chrome://extensions`，开启开发者模式；
2. 点击“加载已解压的扩展程序”，选择项目里的 `dist/`；
3. 复制 AgentSurf 卡片上显示的扩展 ID，粘贴回终端；
4. 保存终端最后打印的 MCP 配置 JSON。

### 3. 检查扩展连接

1. 回到 `chrome://extensions`，点 AgentSurf 卡片上的 **重新加载**；
2. 点击 Chrome 工具栏里的 AgentSurf 图标；
3. 看到 `● connected` 就表示扩展已连接。

如果没有连接：点一次 **Disconnect**，等 1 秒，再点 **Connect**。

### 4. 接入你的 Agent（MCP 配置）

把安装脚本最后打印的 JSON 整段复制到 Agent 的 MCP 配置里，然后重启 Agent。不同客户端的配置文件位置不同；不知道怎么改时，可以直接把安装脚本输出交给 Agent，让它帮你配置。

下面只是配置结构示例，实际使用时以安装脚本打印的内容为准：

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "<安装脚本打印的启动器绝对路径>"
    }
  }
}
```

macOS 示例（把 `XXX` 替换为你的用户名）：

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "/Users/XXX/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh"
    }
  }
}
```

## 使用与检查

在对话里直接对 Agent 说：

```text
打开 https://example.com，告诉我页面标题。
```

如果它能打开网页并返回标题，就说明 AgentSurf 已经可以正常使用了。之后你可以继续让它读取、点击、输入、截图或完成其他浏览器操作。

## 安全提醒

- 建议先以只读方式使用；提交、保存、删除、发布、上传、发送消息等操作前，先由你明确确认；
- 不要把密码、验证码、Cookie 或 Token 发送给 Agent；
- 截图会显示“Chrome 正在被调试”横幅，用完重新加载该标签页即可去掉；
- 第一次使用时，建议先让 Agent 操作普通网页，确认无误后再用于重要页面。

本项目采用 [Apache License 2.0](LICENSE)。
