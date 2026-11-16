# AgentSurf Remote Gateway Deployment & Integration Guide

This guide explains how to deploy **AgentSurf** as a cloud-accessible MCP gateway so cloud AI agents and web clients (**Gemini Web**, **Notion AI**, **Dify**, **Coze**, **LangChain**, custom workflows, etc.) can securely drive your local Chrome or Edge browser over HTTPS/WSS.

## Architecture

- **Cloud Server**: Runs the single-file `standalone-gateway.js` behind Caddy or Nginx (HTTPS / WSS) and exposes a standard Streamable HTTP MCP endpoint + OAuth 2.0 authorization endpoints.
- **Local PC (Home / Office)**: **No terminal, no SSH tunnel, and no public IP required.** The browser extension opens an outbound encrypted WebSocket connection (`wss://.../ws`) to your gateway. Multiple PCs can stay connected simultaneously without kicking each other offline.

```text
[ Cloud AI / Web MCP Client ]
(Gemini Web OAuth 2.0 / Notion AI / Dify / Custom Agent)
        │  HTTPS (Streamable HTTP MCP)
        ▼
[ Reverse Proxy: Caddy / Nginx (:443 or :9443) ]
        │  reverse_proxy 127.0.0.1:8767
        ▼
[ Cloud Gateway: standalone-gateway.js (:8767) ]
        ▲                       ▲
        │ Outbound WSS          │ Outbound WSS
[ Home Chrome (AgentSurf) ] [ Office Chrome (AgentSurf) ]
```

---

## 1. Server Prerequisites

- A Linux VPS (Ubuntu / Debian recommended).
- A domain pointed to your server's public IP (e.g., `mcp.example.com`).
- Firewall / security group allowing your HTTP/HTTPS ports (`80` for ACME TLS issuance, plus `443` or an alternate port such as `9443`).

---

## 2. Configure Caddy Reverse Proxy

Caddy provisions and renews Let's Encrypt TLS certificates automatically and supports WebSockets out of the box.

### Install Caddy (Debian / Ubuntu)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### Edit `/etc/caddy/Caddyfile`

Use standard port `443`, or any alternate port (e.g., `9443`) if `443` is already used by another service:

```caddy
mcp.example.com {
    reverse_proxy 127.0.0.1:8767
}
```

*(If using port `9443`, replace `mcp.example.com` with `mcp.example.com:9443`. AgentSurf validates non-loopback domains independently of port numbers and builds OAuth metadata dynamically from the incoming `Host`.)*

Reload Caddy:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## 3. Build, Upload & Start the Gateway

### A. Build locally

Run in the project root:

```bash
npm run build
```

This creates a self-contained single file with all dependencies bundled: `dist/mcp/standalone-gateway.js`.

### B. Upload to your server

```bash
scp dist/mcp/standalone-gateway.js root@<SERVER_IP>:/root/
```

### C. Initialize & run with PM2

SSH into your server:

```bash
ssh root@<SERVER_IP>

# 1. Ensure Node.js 20+ is installed
node -v || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)

# 2. Install PM2 if needed
pm2 -v || npm install -g pm2

# 3. Initialize remote configuration (generates Bearer Token + OAuth Client ID/Secret)
node /root/standalone-gateway.js init-remote --url https://mcp.example.com

# 4. Start the gateway in background via PM2
pm2 start /root/standalone-gateway.js --name agentsurf-gateway --max-memory-restart 128M -- start-remote
pm2 startup
pm2 save
```

Save the credentials printed by `init-remote`:
- **Bearer Token**: Used both for pairing your browser extension and for approving OAuth browser consent prompts (and for static Bearer clients like Notion AI).
- **OAuth Client ID** & **OAuth Client Secret**: Used for OAuth 2.0 clients such as **Gemini Web**.

### D. Access Mode (`read-only` vs `interactive`)

Newly initialized gateways start in **`read-only`** mode (page reading, screenshots, and tab listing only). When you are ready to allow clicks, typing, and navigation:

```bash
node /root/standalone-gateway.js set-remote-access --mode interactive
pm2 restart agentsurf-gateway
```

Switch back to read-only anytime:

```bash
node /root/standalone-gateway.js set-remote-access --mode read-only
pm2 restart agentsurf-gateway
```

Run diagnostics anytime (secrets are never printed):

```bash
node /root/standalone-gateway.js doctor --url https://mcp.example.com
```

---

## 4. Pair Your Local Browser Extensions (Single or Multi-PC)

1. Load `dist/` (or click **Reload** in `chrome://extensions`) on each computer you want to control (e.g., Home and Office).
2. Click the **AgentSurf** toolbar icon and switch on **Remote Gateway**.
3. Click **Configure / Edit**:
   - **Gateway WSS URL**: `wss://mcp.example.com/ws` (or `wss://mcp.example.com:9443/ws` if using port `9443`)
   - **Pairing Token (Bearer Token)**: Paste the Bearer Token from `init-remote`
   - **Device Name (Optional)**: e.g., `Home` or `Office`
   - Click **Save & Connect**
4. Once connected, `https://mcp.example.com/health` reports `"extension_connected": true` and `connected_devices`.

### How Multi-Computer Routing Works
- Both `Home` and `Office` stay connected to the same `/ws` endpoint without disconnecting each other.
- Whenever you actively focus a Chrome window or switch tabs on a computer, the extension updates its activity timestamp (`last_active_at`). Background reconnects from an idle computer do **not** steal control.
- Once `browser_start_session` begins on a browser, all operations in that session stay bound to that device.
- Need to override? Click **Pin as active** in the popup, pass `device: "Office"` to `browser_start_session`, or connect your MCP client to `https://mcp.example.com/mcp?device=Home`.

---

## 5. Connect Remote MCP Clients

### Option 1: Gemini Web (OAuth 2.0 + PKCE)

Gemini Web's **Connect to MCP server** dialog requires an **OAuth Client ID**, **OAuth Client Secret**, and a **Redirect URI**.

1. If you upgraded an existing `remote-config.json` created before OAuth support, generate OAuth credentials without changing your existing Bearer Pairing Token:
   ```bash
   node /root/standalone-gateway.js init-oauth
   ```
2. In Gemini Web:
   - **MCP server URL**: `https://mcp.example.com/mcp`
   - **Client ID**: Paste your `OAuth Client ID`
   - **Client Secret**: Paste your `OAuth Client Secret`
3. Click **Copy redirect URI** in Gemini and register it on your server (takes effect immediately, no restart required):
   ```bash
   node /root/standalone-gateway.js add-oauth-redirect --uri "<paste-redirect-uri>"
   ```
4. Click **Next** in Gemini. When redirected to the AgentSurf authorization page, enter your **Bearer Pairing Token** and click **Authorize**.
5. **(Optional) Skip per-tool confirmation prompts**: When tools run for the first time, Gemini prompts `Let Gemini use ...?`. To let multi-step browser tasks run smoothly without stopping at every step, click **`Review permissions`** on the prompt card (or open **Agentsurf → App actions** in Gemini) and switch the **`Write / delete` (31)** group dropdown to **`Always allow`** (keep gateway `read-only` mode or per-action prompts enabled when you want stricter control).

To rotate the OAuth Client Secret (immediately revokes previously issued OAuth tokens):
```bash
node /root/standalone-gateway.js rotate-oauth-secret
```

### Option 2: Notion AI (Bearer Token)

1. Open **Notion** -> **Settings** -> **Connections** -> **Add MCP connection**.
2. Configure:
   - **Name**: `AgentSurf`
   - **URL**: `https://mcp.example.com/mcp`
   - **Authentication**: `Bearer Token`
   - **Token**: Paste your Bearer Token

### Option 3: Generic HTTP MCP Clients (Dify, FastGPT, LangChain, Custom Agents)

- **Transport**: Streamable HTTP (`HTTP`)
- **URL**: `https://mcp.example.com/mcp`
- **Header**: `Authorization: Bearer <your-pairing-token>`

---

## 6. Troubleshooting

1. **Extension cannot connect or client gets `502`**:
   ```bash
   pm2 status
   curl -i http://127.0.0.1:8767/healthz
   pm2 logs agentsurf-gateway --lines 100
   sudo journalctl -u caddy -n 50 --no-pager
   ```
2. **Tabs from Home appear in Office Chrome**:
   - AgentSurf stores session/lease state strictly in `chrome.storage.local` and never syncs across devices. If you sign into the same Google account in Chrome on both PCs, disable **Saved Tab Groups / Open Tabs** in Chrome Sync settings, or pass `close_opened_tabs: true` when ending a session.
3. **Rotate pairing token** (also revokes existing OAuth tokens):
   ```bash
   node /root/standalone-gateway.js rotate-remote-token
   ```
   Update the new token in your Chrome extension(s) and Bearer-auth MCP clients.
