# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-10-25

### Added

- **Remote Gateway & Notion AI Integration**: Full support for cloud-hosted AI agents (e.g. Notion AI) via reverse WebSocket gateway and HTTPS MCP endpoints.
- **Unified Extension Panel**: Revamped Chrome extension popup with single-panel layout, local native baseline channel, and toggleable remote gateway.
- **Dual Mutual Exclusion Switches**: Elegant toggle switches for Local Native and Remote Gateway with automatic standby coordination.
- **Frosted-Glass Modal Dialogs**: Configuration and unconfigured-state guidance modals with one-click clear-credentials support.
- **Domain Privacy Protection**: Sensitive server hostnames and endpoints are safely folded and hidden once paired.

### Removed

- Removed the page Console collector and `browser.get_console_messages`. AgentSurf
  no longer injects into the page's MAIN world, patches `console`, or listens for
  page errors and unhandled rejections.

## [0.1.0] - 2026-09-19

### Added

- Local stdio MCP server exposing 30 `browser.*` tools for tabs, page reading,
  element actions, forms, screenshots, iframes, console, downloads, and files.
- Manifest V3 Chrome extension, native messaging host, and loopback-only
  WebSocket bridge.
- Windows and macOS install/uninstall scripts plus an interactive setup wizard.
- Bilingual user guides, developer reference, security policy, and CI across
  Node.js 20, 22, and 24.

[Unreleased]: https://github.com/ztao0916/agentsurf-browser-control-runtime/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/ztao0916/agentsurf-browser-control-runtime/compare/v0.1.0...v0.7.0
[0.1.0]: https://github.com/ztao0916/agentsurf-browser-control-runtime/releases/tag/v0.1.0
