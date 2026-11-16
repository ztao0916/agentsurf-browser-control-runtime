# AgentSurf Agent Rules

This repository (`browser-control-runtime` / **AgentSurf**) uses root `AGENTS.md` as the default agent entrypoint.

## Default Minimum Read Set

Before planning or executing non-trivial tasks, read the minimal current-state files first:

1. `memory-bank/state/brief.md` — project positioning, architecture summary, and verified baseline
2. `memory-bank/state/context.md` — active workstream, current next items, and known blockers
3. `memory-bank/state/source-of-truth.md` — single source of truth index

Read `memory-bank/strategy/` and `memory-bank/operations/` only when the current task needs architectural decisions, promotion/outreach guidelines, or release history.

## Core Rules

1. **Single Source of Truth**: Keep current facts in `memory-bank/state/`, durable decisions & promotion plans in `memory-bank/strategy/`, and shipped milestones in `memory-bank/operations/`. Never duplicate live tracking across multiple files.
2. **Privacy & Public Repo Hygiene**: Never commit server IPs, SSH credentials, pairing tokens, OAuth client secrets, cookies, or personal account handles into `memory-bank/` or any tracked file.
3. **Verification First**: Run affected checks (`npm run typecheck`, `npm run lint`, targeted `vitest`, `npm run build`) before claiming completion.
4. **Docs Sync**: When remote gateway behavior, MCP tool annotations, or client limitations change, update both `README.md` / `README.zh-CN.md` and `docs/remote-gateway.en.md` / `docs/remote-gateway.md`.
