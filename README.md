# AgentSurf

[![License](https://img.shields.io/github/license/ztao0916/agentsurf-browser-control-runtime?label=License)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20Streamable%20HTTP-2563eb)](https://modelcontextprotocol.io/)
[![OAuth 2.0](https://img.shields.io/badge/Auth-OAuth%202.0%20%2B%20PKCE-0ea5e9)](docs/remote-gateway.en.md)
[![Browser](https://img.shields.io/badge/Browser-Chrome%20%2F%20Edge%20MV3-f59e0b)](manifest.json)

**English** | [简体中文](README.zh-CN.md)

**Give any AI agent — local or cloud — safe control over the Chrome or Edge browser you are already signed into.**

AgentSurf connects **Claude Desktop, Cursor, Codex, Gemini Web, Notion AI, Dify**, and any MCP-compatible agent to your real desktop browser. It reuses your existing logins and open tabs without launching headless browsers, exporting cookies, or triggering bot-detection walls.

![AgentSurf demo: an agent controls the user's signed-in Chrome through the local runtime](docs/assets/agentsurf-demo.svg)

---

## Why AgentSurf?

Most browser MCP servers launch a fresh headless Playwright/Puppeteer instance. That forces you to re-authenticate on every workflow and often triggers anti-bot challenges. AgentSurf connects directly to the browser you already use every day.

| Capability | AgentSurf | Typical Headless Browser MCP |
| --- | --- | --- |
| **Existing logins & sessions** | Reuses your live Chrome / Edge tabs & cookies | Starts logged out or requires brittle profile copies |
| **Anti-bot friendliness** | Real user browser environment | Often flagged by headless automation signals |
| **Cloud / Web AI Agents** | Built-in **Streamable HTTP + OAuth 2.0 (PKCE)** & **Reverse WSS** | Usually local `stdio` only |
| **Home + Office multi-PC** | Multiple browsers share one gateway via active-window routing | Single local instance |
| **Multi-conversation isolation** | Per-session tab leases + labeled Chrome Tab Groups | Shared browser state across prompts |
| **Safety guardrails** | Remote mode starts `read-only`; no `MAIN`-world `console` patching | Full read/write exposure by default |

---

## Key Features

- **Dual-Channel Transport**:
  - **Local Native (`stdio`)**: Zero network dependencies, ultra-low latency via Chrome Native Messaging + loopback bridge (`127.0.0.1:8765`).
  - **Cloud Remote Gateway (`Streamable HTTP` + `Reverse WSS`)**: Deploy a single self-contained `standalone-gateway.js` on any VPS. Your local browser initiates an outbound encrypted WebSocket connection—no port forwarding, SSH tunnels, or public IP needed on your PC.
- **Full OAuth 2.0 + PKCE & Bearer Token Support**:
  - Implements MCP OAuth discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`), `Client ID` / `Client Secret`, `S256` PKCE, consent UI, and refresh tokens—ready for **Gemini Web**.
  - Also supports static **Bearer Token** headers for **Notion AI**, **Dify**, and custom HTTP MCP agents.
- **Port-Agnostic Public Routing**:
  - Host, Origin, and OAuth metadata adapt dynamically to the incoming request `Host` and `X-Forwarded-Proto`, so one gateway config works across standard port `443` or any alternate reverse-proxy port.
- **Multi-Computer Coexistence (Home + Office)**:
  - Connect multiple computers (e.g., `Home` and `Office`) to the same `wss://.../ws` endpoint without kicking each other offline.
  - Routes automatically to whichever Chrome window you actively focused/used most recently, locks active sessions to their originating computer, and supports pinning in the extension popup or explicit `device` targeting.
- **29 Browser Control Tools (Token-Efficient by Design)**:
  - Semantic interactive element snapshots (`browser_get_interactives` with opaque `element_id`s, in-page filtering by `tag` / `role` / `name_contains` / `visible_only`, and default `150` cap—cutting a heavy 665-element app page from **~66,800 tokens** to **~15,100**, or **~380 tokens** with `visible_only: true`).
  - Page content extraction, click/double-click/type/press/select/checkbox/drag/scroll, viewport & full-page screenshots, iframe navigation, JS dialog handling, downloads, and file uploads (`DOM.setFileInputFiles`).

---

## Architecture

```mermaid
flowchart LR
  subgraph Local["Local Mode (Zero Network)"]
    LAgent["Claude Desktop / Cursor / Codex"] -->|stdio MCP| LServer["agentsurf-mcp"]
    LServer -->|Local WS| NHost["Native Messaging Host"]
    NHost -->|Native Messaging| Ext["AgentSurf Extension (Chrome / Edge)"]
  end

  subgraph Cloud["Cloud Mode (OAuth 2.0 + Reverse WSS)"]
    CAgent["Gemini Web (OAuth 2.0) / Notion AI / Dify"] -->|HTTPS Streamable MCP| Proxy["Caddy / Nginx HTTPS"]
    Proxy --> GW["standalone-gateway.js (:8767)"]
    HomeExt["Home Chrome Extension"] -->|Outbound WSS| GW
    WorkExt["Office Chrome Extension"] -->|Outbound WSS| GW
  end
```

---

## Quick Start

### Prerequisites

| Requirement | Version & Check |
| --- | --- |
| **Node.js** | `20+` (`node -v`) |
| **Git** | `git --version` |
| **Chrome or Edge** | `116+` (`chrome://version` / `edge://version`) |

> No administrator privileges required. Your existing browser profiles, passwords, and settings are never modified.

---

### Path A: Local Deployment (Claude Desktop, Cursor, Codex, etc.)

1. **Clone and run the setup wizard**:

   ```bash
   git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
   cd agentsurf-browser-control-runtime
   npm run setup
   ```

   To configure **both** Chrome and Edge simultaneously (with separate ports and configs):

   ```bash
   npm run setup -- --browser all
   ```

2. **Load the extension in Chrome / Edge**:
   - Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
   - Click **Load unpacked** and select the project's `dist/` folder.
   - Copy the generated **Extension ID** from the AgentSurf card and paste it into the terminal prompt.

   ![Getting the AgentSurf extension ID from its Chrome extension card](docs/assets/agentsurf-extension-id.png)

3. **Reload & verify the extension popup**:
   - Click **Reload** on the AgentSurf extension card, then click the AgentSurf toolbar icon and verify **Local Native** is active.

   ![AgentSurf extension panel status](docs/assets/agentsurf-extension-panel.png)

4. **Add the printed MCP config to your agent**:

   ```json
   {
     "mcpServers": {
       "agentsurf": {
         "command": "<absolute launcher path printed by setup>"
       }
     }
   }
   ```

   When installed with `--browser all`, `setup` prints separate `agentsurf-chrome` and `agentsurf-edge` entries so you can target either browser cleanly.

---

### Path B: Remote Cloud Gateway (Gemini Web, Notion AI, Dify, Remote Agents)

Use Remote Gateway mode when your AI runs in the cloud and needs to control your local browser over HTTPS/WSS.

1. Build the single-file gateway locally (`npm run build` produces `dist/mcp/standalone-gateway.js` with zero `node_modules` needed on the server).
2. Upload `dist/mcp/standalone-gateway.js` to your server behind Caddy/Nginx HTTPS, initialize credentials (`init-remote --url https://mcp.example.com`), and start it with PM2 (`start-remote`).
3. Pair your Chrome/Edge extension in the popup under **Remote Gateway** using your `wss://.../ws` URL, Pairing Token, and an optional **Device Name** (e.g., `Home` / `Office`).
4. Connect your cloud client:
   - **Gemini Web**: Use the generated `OAuth Client ID` and `OAuth Client Secret`, register Gemini's Redirect URI with `add-oauth-redirect --uri "..."`, and approve the browser prompt with your Pairing Token.
   - **Notion AI / Dify / Custom HTTP MCP**: Use `https://mcp.example.com/mcp` with `Authorization: Bearer <token>`.

👉 **Full step-by-step instructions**: **[Remote Gateway & OAuth 2.0 Guide (docs/remote-gateway.en.md)](docs/remote-gateway.en.md)**

---

## Multi-Browser & Multi-Computer Routing

### Multiple browsers on one PC (Chrome + Edge)
Each MCP server entry (`agentsurf` / `agentsurf-chrome` vs `agentsurf-edge`) runs its own isolated bridge, tab leases, and sessions. Do not pass a Chrome `tab_id` or `element_id` to the Edge server.

### Multiple PCs on one Cloud Gateway (Home + Office)
1. Connect both browsers to the same `wss://mcp.example.com/ws` URL with the same Pairing Token and distinct **Device Names** (e.g., `Home`, `Office`).
2. **Automatic active routing**: The gateway defaults to whichever computer's Chrome window was most recently focused or used by you—idle/background browsers reconnecting will not steal control.
3. **Session stickiness**: Once `browser_start_session` starts on a computer, every step of that task stays pinned to that same computer until completion.
4. **Manual control when needed**: Click **Pin as active** in the extension popup to lock a browser, pass `device: "Office"` to `browser_start_session`, or connect via `https://mcp.example.com/mcp?device=Home`.

---

## Use and verify

Ask your connected agent:

```text
Open https://example.com and tell me the page title.
```

> Seeing *"Chrome is being debugged"* during screenshots or file uploads is normal Chrome CDP behavior.

### Safety Recommendations

- **Start in `read-only` mode** when deploying the remote gateway (`init-remote` defaults to `read-only`; explicitly switch to `interactive` only when ready).
- **Keep human confirmation** before consequential actions such as submitting forms, making purchases, deleting records, uploading files, or sending messages.
- **Never share secrets** (passwords, OTPs, cookies, or pairing tokens) inside prompts, and never commit local `config.json` or `remote-config.json` files.

---

## Documentation & Links

- **[Remote Gateway Deployment & OAuth 2.0 Guide](docs/remote-gateway.en.md)** ([中文版](docs/remote-gateway.md))
- **[Developer & Protocol Reference](docs/reference.en.md)** ([中文版](docs/reference.md))
- **[Security Policy](SECURITY.md)**
- **[Contributing](CONTRIBUTING.md)**
- **[Changelog](CHANGELOG.md)**

Licensed under the [Apache License 2.0](LICENSE).
