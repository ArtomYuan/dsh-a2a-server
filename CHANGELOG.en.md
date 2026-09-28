# Change Log

[简体中文](CHANGELOG.md)

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-09-28

### Fixed

- Sessions now auto-register to their workspace (grouped immediately after creation), and orphaned ungrouped sessions are re-attached in a startup backfill, fixing sessions created via A2A showing as "Ungrouped" in the Web UI.
- The startup backfill now waits for `workspaceRegistry` to be ready (a `ctx.inject` runtime dependency), fixing the restart race that left `attached=0`.

## [0.2.0] - 2026-09-27

### Added

- Settings panel: a new `a2a-server` settings card in the dsh Web UI under
  Settings → Plugins → Plugin configuration (official settings seam — registers the
  `a2a-server` namespace, no changes to the dsh repository, no allowlist). Read/write
  provider / model / preset / cwd / port / host / authToken / contextMapPath /
  contextMapTtlDays; layering is schema defaults < `cordis.patch.yml` <
  `$DSH_HOME/settings.yaml` user overrides, with per-field "clear override".
- Browser half and build output: new client settings card (react + locales +
  card-controller); published artifacts now include both the host half `lib/` and the
  browser half `client/`.
- New dependencies: `@deepseek-ai/schemastery` (dependencies), plus react and
  `@deepseek-ai/dsh-client-*` (devDependencies).

### Changed

- The settings card is now a collapsible card: collapsed by default, click the card
  header to expand/collapse; it auto-collapses after a successful save while rejected
  writes stay expanded; an "Unsaved" tag appears on the header when there are pending
  edits. The interaction matches the official plugin card (PluginCard): the header
  button carries `aria-expanded` and a bilingual `aria-label`, the chevron is reused
  from the module-table shared package `@deepseek-ai/dsh-client-ui-primitives`, and the
  look follows `--dsw-*` tokens. Collapse state is exposed via `data-open` on the root
  node; the `data-testid` / `data-ns` / `data-scope-status` contract is unchanged.
- The `build` / `prepare` scripts now produce both halves — host (`lib/`) and client
  (`client/`); git installs build automatically via `prepare`.

### Fixed

- `runtimeConfig` assignment changed from truthy guards to a wholesale assignment of
  resolved values (including `undefined` fallback), fixing "clearing a field /
  clearing an override has no effect".

## [0.1.0] - 2026-09-12

### Added

- Initial A2A server implementation: JSON-RPC over node:http, with the `@a2a-js/sdk`
  JsonRpcTransportHandler + AgentExecutor delivering A2A task text to a dsh agent
  session for synchronous execution.
- Agent card: public `GET /.well-known/agent-card.json` endpoint (JSONRPC binding,
  protocolVersion 1.0, capabilities.streaming).
- Bearer auth: when `authToken` is configured, `Authorization: Bearer *** is enforced.
- contextId session reuse + cross-restart resume: `message.contextId` maps to a dsh
  session; the mapping persists to `$DSH_HOME/storages/a2a-context-map.json` with TTL
  cleanup (7 days by default).
- agent-team preset mounting (`preset: agent-team`).
- Streaming intermediate events: `SendStreamingMessage` pushes thinking / tool /
  status / text intermediate events in real time (text part + private data-part
  extension).
- `SendMessage` returns the final text synchronously (artifact, lastChunk).

### Changed

- LICENSE changed from MIT to GPL-3.0.

### Security

- The project is distributed under GPL-3.0; parts of the implementation (agent session
  takeover / agentLocks / origin-map session reuse pattern) are ported from
  chushixixin/dsh-harness-mcp-server (MIT License, Copyright chushixixin). The original
  MIT notice is retained, and those parts are relicensed into this project under the
  MIT terms (see the README "License & Attribution" section).

### Docs

- Bilingual README (README.md + README.en.md).
