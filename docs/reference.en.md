# AgentSurf — reference

[中文](reference.md) ｜ **English**

This is the deep-dive companion to the [README](../README.en.md): tool reference, error codes, development and debugging, the external protocol, and implementation notes. **For installation and day-to-day use, read the [README](../README.en.md).**

## Table of contents

- [1. Tool reference](#1-tool-reference)
- [2. Error codes and retry semantics](#2-error-codes-and-retry-semantics)
- [3. Development and debugging](#3-development-and-debugging)
- [4. External protocol](#4-external-protocol)
- [5. Implementation notes](#5-implementation-notes)

## 1. Tool reference

30 tools in total.

| Goal | Tools |
| --- | --- |
| Tabs | `browser.list_tabs` / `browser.open` / `browser.switch_tab` / `browser.close_tab` |
| Frames | `browser.get_frames` (plus `frame_id` on the tools below) |
| Navigation | `browser.back` / `browser.forward` / `browser.reload` |
| Page metadata | `browser.get_page` |
| Text | `browser.get_page_content` |
| Interactive elements | `browser.get_interactives` |
| Combined read / screenshot | `browser.observe` / `browser.screenshot` |
| Element click and input | `browser.click` / `browser.double_click` / `browser.type` / `browser.press` |
| Text selection | `browser.select_text` |
| Form state | `browser.set_checked` / `browser.select_option` |
| Element drag and wait | `browser.drag` / `browser.wait_for_element` |
| Scrolling | `browser.scroll` |
| Dialogs | `browser.handle_dialog` |
| Files | `browser.list_downloads` / `browser.wait_for_download` / `browser.set_files` |
| Console | `browser.get_console_messages` |
| Sessions and tab ownership | `browser.claim_tab` / `browser.reset_sessions` |

> `browser.start_session` is still part of the protocol (usable by scripts and external clients) but is **not advertised as an MCP tool**: the MCP server establishes a session per conversation automatically. See [README section 6.5](../README.en.md#65-parallel-conversations-isolated-by-default).

- `modifiers: ["Alt"|"Control"|"Meta"|"Shift"]` is accepted by `browser.press`, `browser.click`, `browser.double_click`.
- `frame_id` is accepted by `browser.get_page`, `browser.get_interactives`, `browser.get_page_content`, `browser.get_console_messages`, and every element action.
- `browser.get_interactives` accepts `limit` (default **150**), `visible_only`, `tag`, `role`, `name_contains`. Filtering and truncation happen inside the page, and the result reports `total` plus `truncated`. Measured: a 665-element page fell from ~66,800 tokens to ~15,100 by the cap alone, and to ~380 tokens with `visible_only: true`.
- **`truncated: true` means the list is incomplete** — do not conclude the element is missing; narrow with a filter instead.
- **`visible_only: false` is the deliberate default**: collapsed panels, inactive tabs, and hover-revealed buttons (`opacity: 0`) are invisible, yet the agent must be able to discover them. Actions still refuse invisible elements. Note there is **no coordinate-level hover tool**, so such a button has to be revealed by clicking its container or by triggering the page's own interaction.
- **`browser.screenshot` / `browser.observe` no longer fail when the page changes**: on a live page (animations, hot reload, polling) they return with `page_changed: true` — a screenshot also carries `page_revision_before` (the revision it started from), an observation carries `page_revision_after` (the revision the page moved on to). Neither field appears while the page holds still. Element actions still validate revisions strictly.
- Authoritative parameters live in `src/core/protocol/tool-contract.ts` and `src/core/protocol/schemas.ts`. Do not guess names or arguments from other browser tools.

## 2. Error codes and retry semantics

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
| `tab_in_use` | no | another session owns the tab: pick another, or let the conversation holding it finish |
| `request_timeout` | yes | raise `timeout_ms` if the operation is legitimately slow |
| `unsupported_page` | no | protected page; use a normal one |
| `screenshot_unavailable` | yes | the capture call failed (the fallback path needs an active tab). A page changing during capture is no longer an error — that is reported as `page_changed` |
| `bridge_unavailable` / `transport_disconnected` | yes | extension not connected / channel dropped |
| `authentication_failed` | no | token mismatch: reinstall the native host or check `config.json` |

## 3. Development and debugging

### 3.1 Commands

| Command | Purpose |
| --- | --- |
| `npm install` | install dependencies |
| `npm run build` | build the extension into `dist/` (includes the native host bundle) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run bridge:call` | send one JSON request straight to the bridge |

`npm run build` runs `scripts/generate-icons.mjs` and `scripts/build.mjs` (esbuild bundling for the extension, the bridge, the MCP server, and a fully self-contained native host bundle).

### 3.2 Extension status page

`chrome-extension://<EXTENSION_ID>/debug.html` is also what the toolbar icon opens. It does **only the one thing code cannot**: show you the link state and let you force a reconnect.

It contains: the connection state (`connected` / `connecting` / `reconnecting` / `error` / `disconnected`) with the last error text, the host name, the endpoint, the pending request count, `Connect` / `Disconnect` / `Reconnect`, the last 5 connection state and error events (tool request/response traffic is excluded — it would flush the history within a dozen calls), and `Copy diagnostics` — which copies the state, extension version, user agent, and recent events (never the token) so you can paste them into a chat or an issue.

The manual tool panels were removed (tabs, element actions, coordinates, screenshots, files, CDP, raw protocol logs). Driving those from code is less work:

```powershell
npm run bridge:call -- '{"protocol_version":"1","request_id":"t","tool":"browser.list_tabs","args":{}}'
```

### 3.3 Standalone bridge (protocol work only)

```powershell
npm run bridge        # start a standalone bridge
npm run bridge:dev    # build first, then start
```

It does **not** inherit control from the extension connected over native messaging, needs a compatible WebSocket client, and must not compete with the native host for the same port. Use `BROWSER_BRIDGE_PORT` / `BROWSER_BRIDGE_TOKEN` to control it; without a token it prints a random one — do not share that output.

## 4. External protocol

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
  "tool": "browser.get_page",
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

## 5. Implementation notes

### 5.1 Layout

| Path | Responsibility |
| --- | --- |
| `src/core/` | Chrome-independent tool contract, argument validation, runtime dispatch |
| `src/chrome/` | Chrome adapters: tabs, CDP, screenshots, downloads, **frame enumeration**, session coordination |
| `src/content/` | Page Agent, element registry, revision tracking, action executor, console collector, agent cursor |
| `src/transport/` | Native messaging, runtime messages, tool transport |
| `src/bridge/` | local WebSocket bridge |
| `src/mcp/` | MCP server, bridge client, native host install CLI |
| `src/native-host/` | native host entry, config, framing |
| `src/debug/` | extension debug page |
| `scripts/` | build, install, and dev call scripts |
| `tests/` | unit tests |
| `docs/` | change and verification reports |

### 5.2 Page revision and element IDs

Each Document — including each frame — keeps its own revision. Navigation, reload, and "important DOM changes" advance it; `revision_reason` reports which (`navigation` / `refresh` / `important_dom`). The observer only reacts to added/removed interactive elements, semantic attribute changes on registered elements, and large structural batches (at most one advance per batch), so ordinary text edits do not invalidate IDs.

`browser.get_interactives` returns `tab_id`, `frame_id`, `page_revision`, `snapshot_id`, and elements with role, tag, accessible name, state, and bounds — **never selectors**. Password fields report `value_state: "redacted"`.

An `element_id` is opaque; the DOM reference lives only in the content script. Because every document gets its own token, **using an ID in the wrong frame surfaces as `stale_element`**.

### 5.3 Frame routing

- content scripts run with `all_frames: true` + `match_about_blank: true`, so `about:blank` / `srcdoc` frames get a Page Agent too;
- requests are addressed with `chrome.tabs.sendMessage(tabId, msg, { frameId })` — without a frame ID the message would race multiple agents for one response;
- on-demand injection targets one frame with `scripting.executeScript({ target: { tabId, frameIds: [frameId] } })`;
- MAIN-world console collection is best effort: it is installed only on tabs a session has claimed (every frame at claim time, then per frame on each navigation commit), and a page CSP may block it without taking the Page Agent down (the result then reports `available: false`); the patch lives as long as the document, so **releasing a lease does not remove it** — the tab's next navigation does;
- the patch makes the page's own `console.error` calls show up as **this extension's errors** in `chrome://extensions`, because the script calling the real console method is ours. That is exactly why it only runs on claimed tabs: a page the agent never touches keeps a clean console;

### 5.4 Screenshots, cursor, files

- screenshots go through CDP `Page.captureScreenshot`, so **background tabs work**; only the `captureVisibleTab` fallback needs an active tab;
- `full_page: true` uses the document's content size, so an app shell that scrolls inside a container can return viewport-sized output;
- element actions briefly draw an `AI` cursor: it does not receive events, is never returned by `get_interactives`, and does not change the revision;
- `browser.set_files` marks the input temporarily, sets files via CDP `DOM.setFileInputFiles`, then cleans up; for non-top frames the lookup walks a `pierce`d node tree.
