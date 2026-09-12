# dsh-a2a-server

**English** | [简体中文](README.md)

A server plugin library that exposes dsh agent sessions through the A2A
(Agent2Agent) protocol to remote agents (such as Hermes), enabling the
"Hermes = brain, dsh = arms" interoperability.

## Preview

The following effects are driven by this library's A2A server and streaming
events; client-side rendering is done by
[hermes-a2a-bridge](https://github.com/ArtomYuan/hermes-a2a-bridge) (code-block
rendering of tool commands / execution results / final text, and progress pushed
to Feishu / QQ).

### Live stream

When a dsh task is submitted, the client consumes the SSE stream and pushes
intermediate progress back to the messaging surface in real time. The live
sequence a user sees in Feishu / QQ looks like this (commands and results are
rendered as code blocks):

```
🚀 开始执行
🧠 思考中…
🔧 `bash`                    <- tool call, command in a code block
    ┌─ ```bash
    │  ls -la /tmp
    └─ ```
📋 `bash` 完成               <- tool result, output in a code block
    ┌─ ```
    │  total 4
    │  drwxrwxrwt  2 root root 40 Sep 11 14:00 .
    └─ ```
📖 输出完成                  <- long result rendered as a code block
✅ 完成
```

Long text exceeding the gateway's per-message limit is split at code-block
boundaries; continuation chunks are joined with a `⏩ 续` marker, so code blocks
never break across chunks.

### Code blocks

Operation content — tool commands, execution results, and final text — is
automatically rendered as code blocks:

- **Feishu**: fenced content triggers post rich text; code blocks are scrollable;
- **QQ / other mainstream gateways**: markdown code blocks render as code blocks;
- **plain-text platforms**: automatically degraded to plain text (no garbling).

Sample code-block content (an `ls -la` output block):

```text
total 4
drwxrwxrwt  2 root root 40 Sep 11 14:00 .
drwxrwxrwt  2 root root 40 Sep 11 14:00 ..
-rw-r--r--  1 root root  0 Sep 11 14:00 demo.txt
```

> Actual rendering depends on each gateway's client.

### Event stream

The streaming event form produced by this library (under
`SendStreamingMessage`: text Part + data Part private extension; fields taken from
the source `StreamEventDescriptor`):

```
artifactUpdate  artifactId: "stream-text"  append: true         <- text chunk, text Part
artifactUpdate  artifactId: <uuid>  mediaType: application/json  <- intermediate event, data Part
  kind: "tool_call"    { turn, step, name, arguments }
  kind: "tool_result"  { turn, step, name, text }
  kind: "thinking"     { turn, step, text }
  kind: "turn_start"   { turn, step }
  kind: "turn_end"     { turn, step, reason? }
statusUpdate   submitted → working → completed
```

See [CONFIGURATION.en.md](CONFIGURATION.en.md) for full fields and mechanics.

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
