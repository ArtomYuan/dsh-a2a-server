# dsh-a2a-server

**English** | [简体中文](README.md)

A server plugin library that exposes dsh agent sessions through the A2A
(Agent2Agent) protocol to remote agents (such as Hermes), enabling the
"Hermes = brain, dsh = arms" interoperability.

> Status: **P2a streaming intermediate events + context map cleanup**. The A2A
> server business logic is in place (node:http + Bearer auth +
> `@a2a-js/sdk` JsonRpcTransportHandler + AgentExecutor → synchronous dsh session
> execution); `message.contextId` maps to a dsh session (reuse + resume across
> restart); `preset` is configurable (including agent-team); `SendStreamingMessage`
> pushes thinking / tool / status / text intermediate events in real time; the
> contextMap performs TTL cleanup.

## Installation

This library is an independent public bundle package (not a package inside the
dsh workspace), distributed as a standalone bundle. Choose one of three methods.

### Method A: GitHub install (recommended during development)

```sh
dsh plugin --profile <name> add github:ArtomYuan/dsh-a2a-server#<commit>
```

- **The commit must be pinned** (`#<sha>`): git installs pull source code rather
  than build artifacts, and pinning the commit prevents later pushes from
  silently changing the code executed at install time.
- **allowBuilds authorization**: pnpm >=10 refuses to run the `prepare` script of
  a git dependency by default. The first `add` fails and tells you to add the
  package key to the profile's `pnpm-workspace.yaml`:

  ```yaml
  allowBuilds:
    dsh-a2a-server: true
  ```

  Then rerun `add`. This authorization equals **allowing this package's code to
  run on your machine at install time** (outside the agent sandbox); only grant
  it to trusted sources with a pinned commit.

### Method B: npm

```sh
dsh plugin --profile <name> add dsh-a2a-server
```

Published to npm with a prebuilt `lib/`, so no build authorization is required.

### Method C: tarball

```sh
pnpm pack                 # produces dsh-a2a-server-<version>.tgz
dsh plugin --profile <name> add ./dsh-a2a-server-<version>.tgz
```

### Uninstall

```sh
dsh plugin --profile <name> remove dsh-a2a-server
```

## Package structure (bundle)

- `package.json`: the `dsh.bundle.patch` declaration plus `@deepseek-ai/cordis`
  peer/dev mirror.
- `cordis.patch.yml`: an array of patch entries that `insert` one A2A server
  plugin line. It does **not** `insert` an `agent-presets` line (the full
  profile's web-app bundle already provides it; inserting it again fails to load
  with a duplicate entry id); a dsh-base-only profile must add the
  `agent-presets` line itself.
- `src/index.ts`: the plugin entry (`name` / `inject` / `apply`).
- `tsdown.prepare.config.ts`: the self-contained transpile config for `prepare`
  on git installs (transpiles `src/` → `lib/`, no project references, no type
  checking).

## Sections

### Service API

The A2A server exposes two endpoints (JSON-RPC binding, protocol version `1.0`):

- `GET /.well-known/agent-card.json`: the public agent card (JSON). Contains
  `supportedInterfaces[].protocolBinding = "JSONRPC"`, `protocolVersion = "1.0"`,
  `capabilities.streaming = true`.
- `POST /`: JSON-RPC. `method: "SendMessage"` (blocking) carries the user text
  message; the server's `AgentExecutor` submits the text to a dsh agent session
  for synchronous execution, and the final output is returned as an artifact
  (`lastChunk: true`). The task status flow is `submitted → working → completed`.
  `method: "SendStreamingMessage"` (streaming) takes the same parameters but
  pushes intermediate events progressively over SSE (see "Streaming intermediate
  events" below).

Auth: once `authToken` is configured, every request must carry
`Authorization: Bearer <token>`, otherwise `401`.

**contextId session mapping**: `params.message.contextId` (derived by Hermes from
origin) maps to a dsh session — the same contextId reuses the same dsh session
(continuous context), different contextIds are isolated. The mapping is persisted
to `$DSH_HOME/storages/a2a-context-map.json` (format
`contextId\0cwd → {sessionId, lastUsedAt}`); after a server restart the same
contextId resumes via `ctx.agents.resume`; entries are TTL-cleaned by
`lastUsedAt` (default 7 days). When contextId is absent the server generates a
random contextId (equivalent to creating a new session each time, no reuse).

**Streaming intermediate events**: under `SendStreamingMessage`, DshAgentExecutor
subscribes to the dsh agent's `session/event` and pushes high-signal intermediate
events as A2A streaming events in real time —

- text chunks → `artifactUpdate` (text Part, `artifactId: "stream-text"`,
  `append: true`);
- reasoning, tool calls/results, turn boundaries → `artifactUpdate` (**data Part
  private extension**, `mediaType: application/json`, value is a JSON descriptor).

The data Part descriptor `kind` values: `thinking` (`{text}`), `tool_call`
(`{name, arguments}`), `tool_result` (`{name, text}`), `turn_start` /
`turn_end` (`{turn, step, reason?}`). During the test phase reasoning is passed
through verbatim for verification.

### Events

A synchronous task (`SendMessage`) returns task → statusUpdate → artifact →
statusUpdate. A streaming task (`SendStreamingMessage`) additionally pushes
thinking / tool / status / text intermediate events in real time (see "Streaming
intermediate events"), then the final artifact completes.

### Extension points / configuration

`Config` fields (cordis.yml plugin `config`; the token can also be read from the
environment variable `A2A_SERVER_TOKEN`):

- `port`: listen port (defaults to probing 8092/8093/8094 for the first free port).
- `host`: listen address (default `127.0.0.1`, local only).
- `authToken`: Bearer token (enforced once set).
- `provider`: backend provider (default `deepseek-official`).
- `model`: execution model (default `deepseek-v4-flash`; empty string = follow the
  dsh user/default setting).
- `preset`: the agent preset to mount (default `standard`; can be `agent-team`
  etc., see below).
- `cwd`: task working directory (default process cwd).
- `contextMapPath`: persistent file path for the contextId→session mapping
  (default `$DSH_HOME/storages/a2a-context-map.json`).
- `contextMapTtlDays`: mapping entry TTL in days (default 7; expired entries are
  cleaned on load/write).

Injected dependencies: `agents`, `agentPresets`, `sessions`.

### agent-team mount (deployment notes)

The `agent-team` preset depends on the tool-subagent `modelSelectionSettings`
(web-app-only host service `subagent-model-selection-settings`) and nine Team
tools (from the `@deepseek-ai/dsh-experimental-agent-team-profile` bundle). A
dsh-base-only standalone profile lacks these host lines, so they must be added to
the profile's cordis tree (equivalent to the agent-team-profile bundle's
`cordis.patch.yml` + the web-app host lines). dsh-base also does not provide the
`agent-presets` line, so it must be inserted as well (the full profile's web-app
already provides it; duplicating it creates a duplicate entry id):

```yaml
- insert:
    - id: agent-presets
      name: '@deepseek-ai/dsh-agent-presets'
      config:
        default: minimal
- id: tool-subagent-control
  disabled: true
- id: tool-subagent-list-agents
  disabled: true
- id: tool-subagent
  config:
    provider: spawn
    toolName: subagent
    backgroundMode: one-shot
- id: tool-subagent-fork
  config:
    provider: fork
    toolName: subagent_fork
    backgroundMode: one-shot
- insert:
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
    - id: agent-team
      name: '@deepseek-ai/dsh-experimental-agent-team'
      config:
        maxMembers: 8
        maxTasks: 256
        maxPendingMessagesPerMember: 64
        maxMessageBytes: 65536
        disposalTimeoutMs: 5000
    - id: tool-agent-team
      name: '@deepseek-ai/dsh-experimental-tool-agent-team'
      config:
        freshProvider: spawn
        forkProvider: fork
- id: a2a-server
  config:
    preset: agent-team
```

Where `@deepseek-ai/dsh-experimental-agent-team` / `-tool-agent-team` must be
resolvable (the full profile ships them; a standalone profile mounts them via
`dsh plugin add link:<source-tree-path>`). The `agent-team` preset itself comes
from the user root (`$DSH_HOME/.agent-presets/agent-team`, `includeUserRoot`
includes it by default).

### Design notes

- Conversation semantics: A2A `message.contextId` ↔ dsh session. The same
  contextId reuses the same dsh session (continuous context), different
  contextIds are isolated; two-level takeover (persisted mapping hit → resume,
  miss → create + write mapping); the mapping persists across restart and
  resumes, with TTL cleanup (default 7 days). On task completion, flush + release
  the handle.
- Streaming granularity: the blocking `SendMessage` returns the final result;
  `SendStreamingMessage` pushes thinking / tool / status / text intermediate
  events in real time (text Part + data Part private extension).
- Transport choice: JSON-RPC over node:http (self-built listener, not express);
  the agent card is served from the public `/.well-known/agent-card.json`
  endpoint.

### Naming

- Package name: `dsh-a2a-server` (the `name` referenced by the bundle patch for
  Node resolution).
- Patch line logical id: `a2a-server`.
- Plugin role: `Executor` (corresponds to the A2A `AgentExecutor` mapping, which
  submits the A2A task text to a dsh agent session for execution).

## License & Attribution

This project is distributed under the GNU General Public License v3.0 (GPL-3.0);
see `LICENSE` for the full text.

Parts of the implementation (the agent session takeover / agentLocks / origin-map
session-reuse pattern) are ported from
[chushixixin/dsh-harness-mcp-server](https://github.com/chushixixin/dsh-harness-mcp-server)
(MIT License, Copyright chushixixin). The original MIT copyright notice is
retained, and the code is re-licensed into this project under the MIT terms.

## Development

```sh
pnpm install      # independent workspace (isolated by pnpm-workspace.yaml, does not touch the main repo lockfile)
pnpm run build    # tsdown transpiles src/ → lib/ (standalone, no project references)
pnpm run typecheck # tsc --noEmit
```

`lib/index.js` is transpiled directly by tsdown (ESM); `@deepseek-ai/*` and
`@a2a-js/sdk` are external dependencies and are not bundled into the artifact;
they are resolved inside the profile at runtime.
