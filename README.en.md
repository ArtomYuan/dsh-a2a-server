# dsh-a2a-server

**English** | [简体中文](README.md)

A server plugin library that exposes dsh agent sessions through the A2A
(Agent2Agent) protocol to remote agents (such as Hermes), enabling the
"Hermes = brain, dsh = arms" interoperability.

## Preview

This library exposes the A2A server and streaming intermediate events on the dsh
side; the **client-side live presentation** (code-block rendering of tool
commands / execution results / final text, and progress pushed to Feishu / QQ) is
handled by [hermes-a2a-bridge](https://github.com/ArtomYuan/hermes-a2a-bridge).
See its README "Preview" section for the actual effect.

## Architecture

```
A2A client (e.g. Hermes)
        │  JSON-RPC over node:http
        ▼
dsh-a2a-server
   ├─ GET /.well-known/agent-card.json   (agent card)
   ├─ POST /（SendMessage / SendStreamingMessage）
   ├─ Bearer auth (authToken)
   └─ AgentExecutor → session mapping (contextId)
        │
        ▼
dsh agent session (execute / reuse / resume across restart)
```

## Installation

This library is an independent public bundle package (not a package inside the dsh
workspace), distributed as a standalone bundle.

1. Add it to a dsh profile (GitHub install recommended during development; the
   **commit must be pinned**):

   ```sh
   dsh plugin --profile <name> add github:ArtomYuan/dsh-a2a-server#<commit>
   ```

   The first `add` fails because pnpm >=10 refuses to run a git dependency's
   `prepare` script; add the package key to the profile's `pnpm-workspace.yaml`
   as prompted, then rerun:

   ```yaml
   allowBuilds:
     dsh-a2a-server: true
   ```

2. Fill the minimal A2A server plugin config (`port` / `authToken` / `preset`) in
   the profile's cordis config:

   ```yaml
   - id: a2a-server
     config:
       port: 8092
       authToken: <token>
       preset: standard
   ```

   The `token` must match Hermes-side `a2a_agents.dsh.auth.token`.

## Links

- Detailed configuration and mechanics: [CONFIGURATION.en.md](CONFIGURATION.en.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- License: [License & Attribution](#license--attribution)

## License & Attribution

This project is distributed under the GNU General Public License v3.0 (GPL-3.0);
see `LICENSE` for the full text. Parts of the implementation (the agent session
takeover / agentLocks / origin-map session-reuse pattern) are ported from
[chushixixin/dsh-harness-mcp-server](https://github.com/chushixixin/dsh-harness-mcp-server)
(MIT License, Copyright chushixixin); the original MIT copyright notice is
retained, and the code is re-licensed into this project under the MIT terms.
