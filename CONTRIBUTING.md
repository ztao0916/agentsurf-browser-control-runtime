# Contributing to AgentSurf

Thanks for taking the time to improve AgentSurf. Bug reports, focused patches,
documentation fixes, and reproducible compatibility findings are all welcome.

## Before you start

- For a bug or feature request, use the GitHub issue templates.
- For a vulnerability, do not open a public issue. Follow [SECURITY.md](SECURITY.md).
- Keep changes scoped. Avoid unrelated refactors or formatting churn.

## Development setup

Requirements: Node.js 20+ and npm.

```sh
git clone https://github.com/ztao0916/agentsurf-browser-control-runtime.git
cd agentsurf-browser-control-runtime
npm ci
```

Use `npm run setup` when you need a full local Chrome installation. For code-only
work, `npm run build` produces the extension under `dist/`.

## Checks

Run these before opening a pull request:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

CI runs the same checks on Node.js 20, 22, and 24. A change is ready only when
the checks pass.

## Pull requests

- Explain the problem, the chosen approach, and how the change was verified.
- Add or update tests when behavior changes.
- Update the user or developer documentation when commands, configuration, or
  supported behavior changes.
- Keep the pull request focused on one coherent change.
- Do not bump the package version or update the changelog for routine pull
  requests unless a maintainer asks for it.

## Platform verification

Windows and macOS are the supported installation platforms. If a change affects
native messaging, installers, Chrome APIs, or browser behavior, state which
operating system and Chrome version you tested. Linux support is not yet
available.
