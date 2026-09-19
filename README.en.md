# AgentSurf

[![CI](https://github.com/ztao0916/agentsurf-browser-control-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/ztao0916/agentsurf-browser-control-runtime/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/ztao0916/agentsurf-browser-control-runtime?label=License)](LICENSE)
[![Open Source](https://img.shields.io/badge/Open%20Source-Yes-2ea44f)](https://opensource.org/license/apache-2-0)

[中文](README.md) ｜ **English**

> This project is published in the [LINUX DO](https://linux.do/) community.

AgentSurf lets your AI agent operate the local Chrome browser you are already using. Think of it as a universal version of the ChatGPT browser plugin: it is not tied to one model or client, and any MCP-capable agent can use it.

It reuses your existing sessions and tabs and supports common browser actions such as reading pages, clicking, typing, scrolling, taking screenshots, uploading files, working with iframes, and reading the console. You do not need to switch browsers or sign in again.

![AgentSurf demo: an agent controls the user's signed-in Chrome through the local runtime](docs/assets/agentsurf-demo.svg)

> Tested with Codex, Command Code agent, and pi agent; all connected and worked correctly. Windows and macOS have both been tested on real machines, and first-time setup usually takes 5–10 minutes.

## Quick start

Give this README to an agent that can operate your computer and let it guide you through setup, or follow the steps below manually.

### 1. Prerequisites

| Requirement | Version and check |
| --- | --- |
| Node.js | 20+, run `node -v` |
| Git | run `git --version` |
| Chrome | 116+, open `chrome://version` |

> Administrator access is not required, and your existing Chrome sessions and settings will not be changed.

### 2. Install

1. Clone the repository and enter the project directory:

```bash
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
```

2. Run the setup wizard:

```bash
npm run setup
```

The setup wizard installs dependencies, builds the project, registers the native host, and prompts you to:

1. Open `chrome://extensions` and enable Developer mode;
2. Click “Load unpacked” and select the project's `dist/` directory;
3. Copy the extension ID shown on the AgentSurf card and paste it back into the terminal;
4. Save the MCP config JSON printed by the setup wizard.

### 3. Check the extension connection

1. Return to `chrome://extensions` and click **Reload** on the AgentSurf card;
2. Click the AgentSurf icon in Chrome's toolbar;
3. Seeing `● connected` means the extension is connected.

If it is not connected: click **Disconnect** once, wait one second, then click **Connect**.

### 4. Connect your agent (MCP config)

Copy the complete JSON printed by the installer into your agent's MCP config, then restart the agent. The config file location differs by client; if you are unsure, give the installer output to your agent and ask it to configure the client for you.

The block below is only a structure example. Always use the JSON printed by the installer:

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "<absolute path to the launcher printed by the installer>"
    }
  }
}
```

macOS example (replace `XXX` with your username):

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "/Users/XXX/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh"
    }
  }
}
```

## Use and verify

In the conversation, tell your agent:

```text
Open https://example.com and tell me the page title.
```

If it can open the page and return the title, AgentSurf is working. You can then ask it to read, click, type, take screenshots, or perform other browser actions.

## Safety

- Start in read-only mode; require your explicit approval before submitting, saving, deleting, publishing, uploading, or sending anything;
- Never send passwords, verification codes, cookies, or tokens to an agent;
- Screenshots show a “Chrome is being debugged” banner; reload the tab afterwards to remove it;
- For your first run, test on an ordinary page before using AgentSurf on important pages.

AgentSurf is licensed under the [Apache License 2.0](LICENSE).
