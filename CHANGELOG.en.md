# Change Log

[简体中文](CHANGELOG.md)

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-02

### Added

- dsh 0.1.5 / 0.2.0 dual-version compatibility (new `src/compat.ts`):
  - version detection: `dshRuntimeVersion()` reads the real version from
    `@deepseek-ai/dsh-agent/package.json` via `createRequire`; on failure it
    falls back to 0.1.5 behavior with a `console.warn` (never throws);
  - dual message source shapes: 0.2.0 uses the namespace-ized
    `kind: 'plugin:dsh-a2a-server'` (its `MessageSourceMap` dropped the `plugin`
    kind; the legacy shape would make tasks silently never execute), 0.1.5 keeps
    `{kind:'plugin', plugin:'dsh-a2a-server'}`;
  - dual-shape tool_result read: both v4 (`message.toolCallId` + flattened
    `content`) and v3 (`message.content[0]` wrapper block) yield the callId and
    text; wire event field names unchanged;
  - settings panel registration feature-detected into three branches:
    `installSection` (0.1.5 original path) → `register`+`watch` conservative
    replica → neither present (0.2.0 today): one loud warn, A2A service keeps
    working;
  - resume failures upgraded to a diagnostic log (`name`/`code`/`message`/first
    3 `stack` lines + explicit "falling back to a NEW session (contextId mapping
    dropped)"); the degradation behavior is unchanged.
- New `tests/compat.test.mjs` (node:test, stdlib-only, paired v3/v4 tool-result
  fixtures); `pnpm test` runs `build:host` first.

### Changed

- Version bumped to 0.3.0 (agent card `version` updated in sync).
- `package.json`: all dsh peer ranges gained `|| ^0.2.0-rc.2` (0.2.0's version
  gate no longer needs `allow-version` for fresh installs); added optional peer
  + devDependency `@deepseek-ai/dsh-agent-preset-registry@0.2.0-rc.2` (0.2.0's
  preset service provider; its 0.2.0 type chain conflicts with the 0.1.x
  schemastery augmentations, so no `import type {}` augmentation — see docs).
- Docs: new "dsh 0.1.5 / 0.2.0 dual-version compatibility" chapter in
  CONFIGURATION (both languages); a "Versions & Support" matrix and a 0.2.0
  settings-panel note added to the README (both languages); installation docs
  reordered to put npm first (recommended), with GitHub install kept for
  unreleased changes.

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
