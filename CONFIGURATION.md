# dsh-a2a-server 配置与机制说明

> 状态：**P2a 流式中间事件 + 映射清理**。A2A server 业务逻辑已落地
> （node:http + Bearer 认证 + `@a2a-js/sdk` JsonRpcTransportHandler + AgentExecutor
> → dsh 会话同步执行）；`message.contextId` 映射到 dsh 会话（复用 + 跨重启 resume）；
> `preset` 可配置（含 agent-team）；`SendStreamingMessage` 实时推思考/工具/状态/文本
> 中间事件；contextMap 带 TTL 清理。

## 安装（完整途径）

本库是独立公开 bundle 包（非 dsh workspace 内包），以 standalone bundle 形态
分发，三种途径任选。

### 方式 A：GitHub 安装（开发期推荐）

```sh
dsh plugin --profile <name> add github:ArtomYuan/dsh-a2a-server#<commit>
```

- **必须固定 commit**（`#<sha>`）：git 安装拉取的是源码而非构建产物，固定
  commit 可防止后续 push 静默改变安装时执行的代码。
- **allowBuilds 授权**：pnpm ≥10 默认拒绝运行 git 依赖的 `prepare` 脚本。首次
  `add` 会失败并提示把包键加入 profile 的 `pnpm-workspace.yaml`：

  ```yaml
  allowBuilds:
    dsh-a2a-server: true
  ```

  然后重跑 `add`。该授权等于**允许在安装时于你的机器上执行本包代码**（在
  agent 沙箱之外）；只对信任来源、且已固定 commit 的包授权。

### 方式 B：npm

```sh
dsh plugin --profile <name> add dsh-a2a-server
```

发布到 npm 时自带预构建的 `lib/`，无需 build 授权。

### 方式 C：tarball

```sh
pnpm pack                 # 生成 dsh-a2a-server-<version>.tgz
dsh plugin --profile <name> add ./dsh-a2a-server-<version>.tgz
```

### 卸载

```sh
dsh plugin --profile <name> remove dsh-a2a-server
```

## 包结构（bundle）

- `package.json`：`dsh.bundle.patch` 声明 + `@deepseek-ai/cordis` peer/dev 镜像。
- `cordis.patch.yml`：patch 条目数组，`insert` 一条 A2A server 插件行。**不**
  `insert` `agent-presets` 行（完整 profile 的 web-app bundle 已提供，重复插入会
  duplicate entry id 加载失败）；dsh-base-only profile 需自行补 `agent-presets` 行。
- `src/index.ts`：插件入口（`name` / `inject` / `apply`）。
- `tsdown.prepare.config.ts`：git 安装时 `prepare` 的自包含转译配置（转译
  `src/` → `lib/`，不做项目引用、不做类型检查）。

## 服务 API

A2A server 暴露两个端点（JSON-RPC binding，协议版本 `1.0`）：

- `GET /.well-known/agent-card.json`：公开的 agent card（JSON）。含
  `supportedInterfaces[].protocolBinding = "JSONRPC"`、`protocolVersion = "1.0"`、
  `capabilities.streaming = true`。
- `POST /`：JSON-RPC。`method: "SendMessage"`（阻塞）携带用户文本消息，服务端
  `AgentExecutor` 把文本投给 dsh agent 会话同步执行，最终输出作为 artifact
  （`lastChunk: true`）返回，任务状态流为 `submitted → working → completed`。
  `method: "SendStreamingMessage"`（流式）同参数，但以 SSE 逐步推送中间事件
  （见下「流式中间事件」）。

认证：配置 `authToken` 后，所有请求必须带 `Authorization: Bearer <token>`，
否则 `401`。

### contextId 会话映射

`params.message.contextId`（Hermes 由 origin 派生）映射到 dsh 会话——同 contextId
复用同一 dsh 会话（上下文连续），异 contextId 隔离；映射持久化到
`$DSH_HOME/storages/a2a-context-map.json`（格式 `contextId\0cwd → {sessionId,
lastUsedAt}`），server 重启后同 contextId 经 `ctx.agents.resume` 续接；条目按
`lastUsedAt` 做 TTL 清理（默认 7 天）。缺 contextId 时 server 生成随机 contextId
（等于每次新建，不复用）。

### 流式中间事件

`SendStreamingMessage` 下，DshAgentExecutor 订阅 dsh agent 的 `session/event`，把
高信号中间事件实时推为 A2A 流式事件——

- 文本块 → `artifactUpdate`（text Part，`artifactId: "stream-text"`、`append: true`）；
- 思考（reasoning）、工具调用/结果、turn 边界 → `artifactUpdate`（**data Part
  私有扩展**，`mediaType: application/json`，值为 JSON 描述符）。

data Part 描述符 `kind` 取值：`thinking`（`{text}`）、`tool_call`
（`{name, arguments}`）、`tool_result`（`{name, text}`）、`turn_start` /
`turn_end`（`{turn, step, reason?}`）。测试期思考原样透传以便验证。

## 事件

同步任务（`SendMessage`）返回 task → statusUpdate → artifact → statusUpdate。
流式任务（`SendStreamingMessage`）额外实时推送思考 / 工具 / 状态 / 文本中间事件
（见「流式中间事件」），最终 artifact 完成。

## 扩展点 / 配置（字段全集）

`Config` 字段（cordis.yml 插件 `config`，也可从环境 `A2A_SERVER_TOKEN` 读 token）：

- `port`：监听端口（缺省探测 8092/8093/8094 首个空闲端口）。
- `host`：监听地址（默认 `127.0.0.1`，仅本机）。
- `authToken`：Bearer token（设置后强制校验）。
- `provider`：后端 provider（默认 `deepseek-official`）。
- `model`：执行模型（默认 `deepseek-v4-flash`；空串 = 跟随 dsh 用户/默认设置）。
- `preset`：挂载的 agent preset（默认 `standard`；可设 `agent-team` 等，见下）。
- `cwd`：任务工作目录（默认进程 cwd）。
- `contextMapPath`：contextId→session 映射持久文件路径（默认
  `$DSH_HOME/storages/a2a-context-map.json`）。
- `contextMapTtlDays`：映射条目 TTL 天数（默认 7；超期条目在加载/写入时清理）。

注入依赖：`agents`、`agentPresets`、`sessions`。

## agent-team 挂载（部署说明）

`agent-team` 预设依赖 tool-subagent 的 `modelSelectionSettings`（web-app 独有
host 服务 `subagent-model-selection-settings`）与九个 Team 工具（来自
`@deepseek-ai/dsh-experimental-agent-team-profile` bundle）。dsh-base-only 的
独立 profile 缺这些 host 行，须在 profile 的 cordis 树补上（等价于
agent-team-profile bundle 的 `cordis.patch.yml` + web-app 的 host 行）。dsh-base
也不提供 `agent-presets` 行，须一并 insert（完整 profile 的 web-app 已提供，
重复会 duplicate entry id）：

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

其中 `@deepseek-ai/dsh-experimental-agent-team` / `-tool-agent-team` 须可解析
（完整 profile 自带；独立 profile 用 `dsh plugin add link:<源码树路径>` 挂接）。
`agent-team` 预设本体来自 user root（`$DSH_HOME/.agent-presets/agent-team`，
`includeUserRoot` 默认纳入）。

## 设计说明

- 会话语义：A2A `message.contextId` ↔ dsh 会话。同 contextId 复用同一 dsh 会话
  （上下文连续），异 contextId 隔离；两级接管（持久映射命中 → resume，未命中 →
  新建 + 写映射），映射持久化跨重启 resume，带 TTL 清理（默认 7 天）。任务毕
  flush + 释放句柄。
- 流式粒度：阻塞式 `SendMessage` 返回最终结果；`SendStreamingMessage` 实时推
  思考/工具/状态/文本中间事件（text Part + data Part 私有扩展）。
- 传输选型：JSON-RPC over node:http（自建 listener，非 express）；agent card
  走 `/.well-known/agent-card.json` 公开端点。

## 命名

- 包名：`dsh-a2a-server`（bundle 补丁中 `name` 引用此名做 Node 解析）。
- 补丁行逻辑 id：`a2a-server`。
- 插件 role：`Executor`（对应 A2A `AgentExecutor` 映射，把 A2A task 文本投给
  dsh agent 会话执行）。

## 开发

```sh
pnpm install      # 独立 workspace（pnpm-workspace.yaml 隔离，不碰主仓库 lockfile）
pnpm run build    # tsdown 转译 src/ → lib/（standalone，无项目引用）
pnpm run typecheck # tsc --noEmit
```

`lib/index.js` 由 tsdown 直接转译（ESM），`@deepseek-ai/*` 与 `@a2a-js/sdk`
均为外部依赖，不打包进产物；运行时在 profile 内解析。
