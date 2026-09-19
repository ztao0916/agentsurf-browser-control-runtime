# AgentSurf

[![CI](https://github.com/ztao0916/agentsurf-browser-control-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/ztao0916/agentsurf-browser-control-runtime/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/ztao0916/agentsurf-browser-control-runtime?label=License)](LICENSE)
[![Open Source](https://img.shields.io/badge/Open%20Source-Yes-2ea44f)](https://opensource.org/license/apache-2-0)

[中文](README.md) ｜ **English**

> This project is linked with and recognizes the [LINUX DO](https://linux.do/) community.

AgentSurf is a local Chrome control runtime for AI agents. It drives **the Chrome you already use**, so it keeps your existing logins, and exposes page reading, clicking, typing, screenshots, iframes, and console inspection as a uniform set of `browser.*` tools through a local MCP server. It ships no model calls, no task planning, and no vendor lock-in.

![AgentSurf animated demo: an agent operating the user's signed-in Chrome through a local runtime](docs/assets/agentsurf-demo.svg)

> This project is **not distributed through the Chrome Web Store** and publishes no public npm package. The supported path is: build from source, load the extension as an unpacked extension, and register the native host locally.
>
> The full chain has been verified on both Windows and macOS; there is no Linux installer yet. First setup usually takes 5–10 minutes, and the steps say **which window to use**, **what you should see**, and **where to look when it fails**.

## Quick start

Use the setup wizard for dependency installation, build, and native-host registration:

```bash
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm run setup
```

The wizard installs dependencies, builds the extension, asks you to load `dist/` in `chrome://extensions`, registers the native host after you enter the extension ID, and prints the MCP config JSON to paste into your agent. In an interactive terminal it can also run a smoke test.

For manual installation or step-by-step troubleshooting, see [section 4](#4-installation).

## Table of contents

- [1. What it is](#1-what-it-is)
- [2. How it works](#2-how-it-works)
- [3. Choosing an integration path](#3-choosing-an-integration-path)
- [4. Installation (Windows / macOS)](#4-installation)
- [5. Verifying the setup](#5-verifying-the-setup)
- [6. Driving it from an agent](#6-driving-it-from-an-agent)
- [7. Updating, moving, uninstalling](#7-updating-moving-uninstalling)
- [8. Troubleshooting](#8-troubleshooting)
- [9. Safety boundaries](#9-safety-boundaries)
- [10. Current limitations](#10-current-limitations)
- [11. Further reference](#11-further-reference)
- [12. License](#12-license)

## 1. What it is

In one sentence: **when your agent needs to operate a web page, it borrows the Chrome you are already using instead of launching a clean browser profile.**

What it gives you:

- your existing Chrome sessions and tabs — no re-login, no cookie export;
- **30 `browser.*` tools**: tabs, page reading, element clicks and typing, forms, scrolling, drag, screenshots, iframes, console, downloads, file upload;
- an **opaque `element_id`** model instead of CSS selectors, with every action re-checked for visibility, enabled state, and page revision;
- a local MCP server, so the agent side is just one stdio MCP entry.

What it does not do:

- no built-in model, no task planning;
- no cloud browser: everything talks over `127.0.0.1`;
- no CAPTCHA solving or anti-bot evasion.

### How it differs from chrome-devtools MCP

AgentSurf is designed to operate **the Chrome session you are already using**.
It reuses existing logins and tabs, which makes it suitable for user environments,
authenticated sites, and workflows that may need human takeover. chrome-devtools
MCP is a better fit when you need deeper CDP capabilities or a clean, repeatable
test profile.

The trade-off is that AgentSurf currently has no tracing, heap snapshots, or
Lighthouse, and its `chrome.debugger` use conflicts with an open DevTools
session. See the [browser runtime report](docs/browser-tooling-report.md) for
the current scope, verification status, and known limitations.

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
              │  chrome.tabs.sendMessage / chrome.debugger
              ▼
        the page (Page Agent content script, injected into every frame)
```

Key consequences:

- **The extension is the initiator.** It calls `connectNative` on startup, which starts the native host, which starts the bridge. You never need to run `npm run bridge` for normal use.
- The extension **listens on no port at all**; the bridge only binds `127.0.0.1` and requires a token (generated by the installer, stored on disk, never pasted into a chat).
- The MCP server and the native host **share the same local config**, so you do not copy tokens between them.
- A standalone bridge exists only for protocol development — see [Development and debugging](docs/reference.en.md#3-development-and-debugging).

## 3. Choosing an integration path

### Option A: MCP server (recommended)

Agent ↔ `dist/mcp/cli.js` (stdio MCP server) ↔ Bridge ↔ extension. The agent gets every tool and its schema for free.

### Option B: your own client against the Bridge

Your program ↔ the local WebSocket bridge, doing the `auth` handshake and request framing itself. Use this for non-MCP runtimes or when you need fine control over timeouts and concurrency. Protocol: [External protocol](docs/reference.en.md#4-external-protocol).

Both options still require the extension + native host from section 4 — that is the foundation.

## 4. Installation

Windows and macOS are both covered here. Read the comparison table in 4.1 first; from then on every step has one block per platform, so **follow the block for your system**. Nothing needs administrator rights, and nothing changes the logins or settings you already have in Chrome.

### 4.1 How the two platforms differ

| | Windows | macOS |
| --- | --- | --- |
| Command line | **PowerShell** (search for `PowerShell` in the Start menu) | **Terminal** (`⌘ + Space`, type "Terminal") |
| Install first | [Node.js LTS](https://nodejs.org/) (includes npm), [Git](https://git-scm.com/), Chrome 116+ | The same, or `brew install node git` |
| Register the native host | `npm run native-host:install -- -ExtensionId <extension ID>` | `npm run native-host:install:macos -- "<extension ID>"` |
| Administrator rights | Not needed (writes to the current user's registry hive) | **Do not add `sudo`** — it registers the manifest for the wrong user |
| Where registration goes | Registry `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.browsercontrol.runtime` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.browsercontrol.runtime.json` |
| Runtime directory | `%LOCALAPPDATA%\BrowserControlRuntime\` | `~/Library/Application Support/BrowserControlRuntime/` |
| Launcher for the MCP client | `agentsurf-mcp.exe` | `agentsurf-mcp.sh` |
| The extension itself | Identical — the same `dist/` | Identical |

In one sentence: **the extension, the protocol, and the MCP config format are the same on both platforms; only the commands and the file locations differ.**

> ✅ The full chain has been verified on both Windows and macOS; there is no Linux installer yet.

### 4.2 Prerequisites

| Needed | Check | If it is missing |
| --- | --- | --- |
| Node.js 20+ | `node -v` | Download **LTS** from [nodejs.org](https://nodejs.org/): `.msi` on Windows, `.pkg` on macOS, then click through the installer |
| npm 10+ | `npm -v` | It ships with Node, nothing extra to install |
| Git | `git --version` | Windows: install from [git-scm.com](https://git-scm.com/); macOS: this command offers to install it |
| Chrome 116+ | open `chrome://version` | Update Chrome |

After installing Node or Git, **open a new terminal window** — otherwise the command is still not found.

### 4.3 Clone and build

> You can also run `npm run setup` in the project directory: it performs the install and build below, then guides you through the extension ID and native-host registration. The manual steps remain here for troubleshooting.

**Windows (PowerShell)**

```powershell
cd $HOME\Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

**macOS (Terminal)**

```sh
cd ~/Desktop
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm install
npm run build
```

`npm run build` ending with `Done in ...` means it worked, and the project now contains a `dist/` folder.

Three rules that are easy to get wrong:

- Chrome loads **`dist/`**, not `src/`;
- `dist/` is **not committed to Git** and has to be built once on every machine;
- after changing the source you **must run `npm run build` again** — Chrome does not pick it up by itself.

### 4.4 Load the extension into Chrome

Identical on both platforms:

1. Open `chrome://extensions` in Chrome;
2. turn on **Developer mode** in the top right;
3. click **Load unpacked** and pick the **`dist`** folder in the project (not the project root);
4. note the **extension ID** on the AgentSurf card (32 lowercase letters, e.g. `hpageihlnphdohcplmimhmghljpilbpa`).

The card may show that it cannot connect — **that is expected**, the native host is not registered yet.

> ⚠️ The extension ID can change when you switch machines, move the project, or remove and re-add the extension. **Always use the ID currently shown in `chrome://extensions`**, not one copied from older docs or chat logs.

### 4.5 Register the native host

Replace `<extension ID>` with the value from step 4.4. **Run this inside the project directory.**

**Windows (PowerShell)**

```powershell
$extensionId = "<extension ID>"
npm run native-host:install -- -ExtensionId $extensionId
```

**macOS (Terminal)**

```sh
npm run native-host:install:macos -- "<extension ID>"
```

The installer does four things (see the table in 4.1 for the per-platform locations):

| Action | Purpose |
| --- | --- |
| Writes `config.json` | Records the port (default `8765`) and a random 64-character token |
| Generates the native host launcher | Pins the absolute paths of your Node install and the project `dist/` |
| Writes the native messaging manifest | `allowed_origins` allows only the extension ID you passed |
| Registers it with the system | Windows: registry; macOS: a manifest under your home directory |

When it finishes, it **prints a ready-made MCP config JSON block** — copy that whole block in the next step instead of assembling paths yourself.

On Windows, if the installer reports that a file is in use, **disable** AgentSurf in `chrome://extensions` (or close Chrome), wait a second, and run the command again. Reinstalling **reuses the existing valid token**, so you do not have to reconfigure MCP.

### 4.6 Reload the extension and confirm the link

1. Back in `chrome://extensions`, click the **reload** button (🔄) on the AgentSurf card;
2. open the address below (or just click the AgentSurf icon in the toolbar — it opens the same page):

```text
chrome-extension://<extension ID>/debug.html
```

3. You should see:

```text
● connected
Host      com.browsercontrol.runtime
Endpoint  ws://127.0.0.1:8765
Pending   0
```

If it is not connected: click **Disconnect** once, wait a second, then click **Connect**. **Do not click Reconnect repeatedly** — that produces a reconnect storm.

### 4.7 Connect your agent (MCP config)

Paste the JSON the installer printed in step 4.5 into your agent's MCP config file. Using pi's `~/.pi/agent/mcp.json` as the example:

**Windows**

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "C:/Users/<username>/AppData/Local/BrowserControlRuntime/agentsurf-mcp.exe"
    }
  }
}
```

**macOS**

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "/Users/<username>/Library/Application Support/BrowserControlRuntime/agentsurf-mcp.sh"
    }
  }
}
```

> Other MCP clients work the same way; only the **location** of the config file differs, and the JSON you paste is identical.

Four things to know:

- there are **no `args`**. Copy the printed block verbatim — **do not assemble the path yourself**;
- **restart the MCP client** (or its session) after editing the config; it is only read at startup;
- no environment variables are needed; the MCP server reads the `config.json` written in step 4.5;
- after switching machines, moving the project, or changing your Node install, **re-run the single command from step 4.5** to regenerate the launcher.

<details>
<summary>Alternative: skip the launcher and point straight at node and cli.js</summary>

If your client insists on an explicit interpreter:

**Windows**

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/Users/<username>/Desktop/agentsurf-browser-control-runtime/dist/mcp/cli.js"]
    }
  }
}
```

```powershell
(Get-Command node).Source            # path to the Node executable
(Resolve-Path dist/mcp/cli.js).Path  # path to the MCP server entry point
```

**macOS**

```json
{
  "mcpServers": {
    "agentsurf": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/<username>/Desktop/agentsurf-browser-control-runtime/dist/mcp/cli.js"]
    }
  }
}
```

```sh
which node                 # path to the Node executable
realpath dist/mcp/cli.js   # path to the MCP server entry point
```

The cost: you maintain two absolute paths yourself, and the client's process environment must be able to see `node` (GUI clients often cannot). The launcher wraps all of that.

</details>

### 4.8 Confirm the tools are available

Ask your agent:

```text
List the browser_* tools you have available.
```

You should see **30** tools, including `browser_get_frames`, `browser_select_text`, `browser_get_console_messages`, and `browser_screenshot`.

(The client gets the tool list from the server, so there is no separate capability-query tool; `browser.get_capabilities` was removed.)

### 4.9 How to tell it really works

- Verify the whole link **without the MCP client** (run it in the project directory; `ok: true` plus a list of tabs means the link is fine):

```powershell
node scripts/call-tool.mjs '{"protocol_version":"1","request_id":"smoke","tool":"browser.list_tabs","args":{}}'
```

  PowerShell, bash, and zsh all take the JSON in single quotes; do not put spaces inside the JSON or PowerShell will split the argument.

- Fails here → the link is the problem, see [section 8, Troubleshooting](#8-troubleshooting);
- Works here but fails inside the agent → MCP config problem, check the path and the client restart in step 4.7;
- Full verification checklist (is the bridge listening, end-to-end smoke test): see [section 5](#5-verifying-the-setup).

## 5. Verifying the setup

Verify from the inside out; this is what makes failures easy to localize.

### 5.1 Is the bridge listening?

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

### 5.2 Does the whole link work without the MCP client?

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
| Fails here | link problem — see [section 8](#8-troubleshooting) |
| Works here, fails in MCP | MCP config problem (paths, Node, client not restarted) |

### 5.3 End-to-end smoke test

In the agent, in order: `browser_list_tabs`, then `browser_get_page_content` on a normal page, then `browser_screenshot`. Screenshots go through CDP, so the tab shows a "Chrome is being debugged" banner; reloading that tab removes it.

## 6. Driving it from an agent

### 6.1 Read-only pass first

```text
1. browser_list_tabs                                  # see what exists before touching anything
2. browser_open {"url":"https://example.com","activate":true}
3. browser_get_page {"tab_id":...}                    # URL, load state, revision
4. browser_get_page_content {"tab_id":...}            # body text
```

`browser_get_page` returns **metadata, not article text**. To open a URL use `browser_open`; there is **no** `browser_navigate`.

### 6.2 Element actions (the `element_id` model)

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

### 6.3 iframes (important)

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

### 6.4 Observability

```text
browser_get_console_messages {"tab_id": 123}                 # console output, exceptions, rejections
browser_get_console_messages {"tab_id": 123, "frame_id": 561}
browser_observe {"tab_id": 123}                              # state + interactives + AX + screenshot
```

Console collection runs in the page's MAIN world so it sees the page's own output. It is installed **only on tabs a session has claimed, and re-injected after every navigation**: a page the agent never touched keeps its own `console` untouched. `available: false` means **the collector was not present — an empty list is not proof of silence**.

### 6.5 Parallel conversations (isolated by default)

Each conversation's MCP server process owns a session, so **the agent does not have to create one or pass `session_id`**:

- tabs it opens with `browser_open` are claimed automatically and put in **this conversation's Chrome tab group**; the title **defaults to the title of the first page the conversation touches** (for example "ZenTao - Task 17824", or its hostname while the tab is still loading), falling back to `AgentSurf` when that page gives nothing;
- **to make the group read as the task**, pass `session_name` on any call (for example `{"tab_id": 123, "session_name": "ZenTao 17824"}`): it sticks for the conversation, renames an existing group on the spot, and stops page titles from overriding it;
- another conversation is refused those tabs (`tab_in_use`), so conversations stop stepping on each other;
- use `browser_claim_tab` to take over a tab the user already had open: it claims and, by default, groups it (pass `group: false` to claim without moving it);
- `browser_list_tabs` returns this conversation's tabs plus unclaimed ones and reports the rest in `other_session_tabs`; pass `include_all: true` to see every tab (for scripts and troubleshooting);
- **leases apply to every caller**: a session-less call (a script, the CLI) is refused with `tab_in_use` on a tab another conversation holds instead of silently bypassing the check — a script that wants such a tab calls `browser.start_session` (still in the protocol, just not advertised to agents) and claims it;
- `browser_reset_sessions` ungroups, releases this conversation's leases, and **closes the tabs this conversation opened itself** — never a tab the user already had open.

Caveats:

- automatic isolation assumes **one conversation = one MCP server process** (PiDeck starts a separate process per conversation, which satisfies this). If a client multiplexes several conversations through one process, they share a session and you must pass an explicit `session_id` to separate them;
- `browser_open` on an existing `tab_id` claims that tab but deliberately leaves the tab bar alone;
- leases live in the extension's `storage.session` (**restarting Chrome clears them**), while session records persist in `storage.local`;
- **idle reclaim**: if a conversation is closed without a clean finish, the tabs it claimed are freed **and ungrouped** after **30 minutes of inactivity**, and another conversation can take them over, while a session that keeps using its tab keeps refreshing the lease;
- **finish the job**: call `browser_reset_sessions` when the work is done — it ungroups, releases the leases, and **closes the tabs this conversation opened itself** immediately (a tab the user already had open is only ungrouped, not closed); otherwise the group stays until the idle timeout. Pass `close_opened_tabs: false` to keep the tabs, and read `closed_tab_ids` to see which ones went;
- **process-exit backstop**: ending a conversation kills the MCP server process (or closes its stdin), so the process makes one best-effort `reset_sessions` before it exits. A SIGKILL cannot be caught, and that case still falls to the idle reclaim below;
- **after a reload or restart**: reloading the extension or restarting Chrome clears the leases (a Chrome behaviour), so on startup the runtime also ungroups any group whose owner no longer holds a lease, leaving no orphaned groups behind; tabs with a live lease are left alone;
- **manual escape hatch**: `browser_reset_sessions` releases this conversation's own session and any lease whose owner is gone — which is what recovers tabs stuck on a vanished conversation. Other conversations are untouched, and `other_sessions_kept` reports how many were left alone; pass `force: true` only when you really mean to release every session and ungroup their tabs, and note that **`force` only ungroups — it never closes tabs**, because that would destroy work another conversation is still doing.

## 7. Updating, moving, uninstalling

### 7.1 What to do for each kind of change

| Change | Action |
| --- | --- |
| extension / content script / page agent code | `npm run build` → reload the extension |
| **manifest.json (e.g. content_scripts)** | `npm run build` → **must** reload the extension; refreshing a page is not enough |
| native host source or installer | disable extension → build → reinstall native host → re-enable |
| MCP server code | build → restart the MCP client |
| project path / extension ID / Node path | re-register the native host |

A running host never picks up new JS on its own; restart it by reloading the extension.

### 7.2 Full update (Windows)

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

### 7.3 Moving the project

The launcher hard-codes the project path recorded at install time (`<project>/dist/native-host/host.js`). After moving or renaming:

1. disable the old extension;
2. in the new location: `npm install && npm run build`;
3. load the new `dist/` in Chrome and copy the new extension ID;
4. run `native-host:install` from the new location;
5. reload the extension and restart the MCP client.

> Verified detail: the `host.js` copy in `%LOCALAPPDATA%\BrowserControlRuntime\` is a **stale leftover that nothing references** (the launcher points at the repo's `dist/`). Do not let it mislead you while debugging.

### 7.4 Uninstalling

```powershell
npm run native-host:uninstall              # Windows
npm run native-host:uninstall:macos        # macOS
```

This removes the native host registration and launcher, **keeps the config**, and touches neither the Chrome extension nor the project. To clean up fully: remove the extension in `chrome://extensions`, then delete the project directory and `%LOCALAPPDATA%\BrowserControlRuntime` (`~/Library/Application Support/BrowserControlRuntime` on macOS).

## 8. Troubleshooting

### 8.1 Symptom table

| Symptom | Meaning and fix |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:8765` | Nothing is listening: extension disabled, host not installed, or the extension has not finished connecting. **Check `debug.html` first.** |
| `Chrome Extension is not connected` | The bridge is alive but no extension is attached. Check `debug.html`, the host handshake, and whether `dist` is current. |
| `EADDRINUSE` | Port 8765 is taken: a stray standalone bridge, an old host, or another profile's copy of the extension. |
| `frame_not_found` | The target frame no longer exists (navigation/rebuild). Retry after `browser_get_frames`. |
| `stale_element` | The element ID is outdated **or you are looking in the wrong place** (e.g. missing `frame_id`). Re-run `browser_get_interactives`. |
| `element_not_visible` / `element_disabled` / `element_not_editable` | The element exists but cannot be acted on yet. Inspect the real page state. |
| `unsupported_page` | Chrome forbids injecting a Page Agent there (`chrome://`, Web Store). Use a normal HTTP/HTTPS page. |
| `screenshot_unavailable` | The capture call failed: the fallback path needs an active tab, or Chrome itself failed. **A page that changes during capture is no longer an error** — the result carries `page_changed: true`. |
| `tool is unsupported` | That tool does not exist in this runtime. Compare against the tool list your agent has. |
| `native-host.exe` in use during install | Disable the extension, let the old host exit, then install. Do **not** kill every `node.exe`. |

### 8.2 Order of investigation

1. `chrome://extensions` — enabled? any error?
2. `debug.html` (or the toolbar icon) — connection state and recent events;
3. is anything listening on the port (5.1);
4. `node scripts/call-tool.mjs ...` (5.2) to separate a link problem from an MCP config problem;
5. the extension's **Service Worker inspector** for native messaging errors.

### 8.3 The three most common mistakes

1. **Editing `manifest.json` and only refreshing the page** — reload the extension instead.
2. **Using a stale extension ID** — the host's `allowed_origins` will not match and Chrome refuses the connection.
3. **Switching Node versions (nvm)** — the launcher's recorded Node path goes stale; re-run the installer.

Redact the token and any sensitive page data before sharing logs.

## 9. Safety boundaries

AgentSurf acts on your logged-in pages, and file upload is powerful. Encode these rules in your agent's instructions:

- **read-only by default**; ask the user before submitting, saving, deleting, publishing, uploading, or sending anything;
- the user logs in themselves: never request passwords or codes, never read or print cookies, tokens, or local storage;
- never commit `config.json` or the token, and never paste them into a chat;
- never expose the bridge beyond localhost;
- screenshots go through CDP, which shows a "Chrome is being debugged" banner and conflicts with the user's own DevTools; reload that tab afterwards to clear it.

These are **instructions for the agent**, not an enforced approval layer. The caller still owns the authorization boundary.

## 10. Current limitations

- **No OCR**: text inside images needs screenshots plus the model's own vision.
- **No Shadow DOM support**: open shadow roots contribute text to page content, but their elements do not appear in `get_interactives`.
- **Frames are explicit**: the top document is the default; use `browser.get_frames`. Cross-origin frames cannot be driven.
- **Protected pages cannot be injected**: `chrome://`, the Chrome Web Store, and similar.
- **CDP conflicts with DevTools**: attaching fails if DevTools is already open on that tab, and shows a debug banner.
- **Console buffers are per document and lost on navigation**, and only cover the period after the collector started.
- **Session isolation is automatic in the MCP server**: each conversation gets its own session and tabs; passing `session_id` explicitly is only for lower-level protocol callers.
- **Files and downloads**: uploads need absolute local paths; downloads expose only Chrome Downloads API metadata and cannot be reliably tied to a source tab.
- **Platform coverage**: verified on both Windows and macOS; no Linux installer.
- **No automated real-Chrome E2E yet**: CI covers type-checking, lint, unit tests, and builds; real-browser behaviour (injection, screenshots, CDP, iframes) still needs manual smoke verification.

## 11. Further reference

For developers, and for anyone integrating below the MCP layer, the following now lives in a separate file: [docs/reference.en.md](docs/reference.en.md).

| Content | What is in it |
| --- | --- |
| [1. Tool reference](docs/reference.en.md#1-tool-reference) | The 30 `browser.*` tools grouped by purpose, where `frame_id` / `modifiers` apply, and the filtering and truncation semantics of `get_interactives` |
| [2. Error codes and retry semantics](docs/reference.en.md#2-error-codes-and-retry-semantics) | The structured error object, whether each `code` is retryable, and the suggested action |
| [3. Development and debugging](docs/reference.en.md#3-development-and-debugging) | Build / lint / test commands, the extension status page, the standalone bridge |
| [4. External protocol](docs/reference.en.md#4-external-protocol) | Speaking to the local bridge directly instead of going through MCP |
| [5. Implementation notes](docs/reference.en.md#5-implementation-notes) | Layout, page revisions and `element_id`, frame routing, screenshots and files |
| [Contributing](CONTRIBUTING.md) | Development setup, required checks, and pull request expectations |
| [Changelog](CHANGELOG.md) | Release history and notable changes |

## 12. License

AgentSurf is licensed under the [Apache License 2.0](LICENSE), including the patent grant in Section 3.
