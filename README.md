# dsh-a2a-server

dsh 侧的 A2A (Agent2Agent) server 插件库：把 dsh agent 会话以 A2A 协议暴露给
远端 agent（如 Hermes），实现「Hermes = brain，dsh = arms」的互操作。

> 状态：**P0 最小闭环**。A2A server 业务逻辑已落地（node:http + Bearer 认证 +
> `@a2a-js/sdk` JsonRpcTransportHandler + AgentExecutor → dsh 会话同步执行），
> 通过 P0 闭环验证（agent card + 真实任务往返）后才推送 GitHub。

## 安装

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
- `cordis.patch.yml`：patch 条目数组，`insert` 一条 A2A server 插件行。
- `src/index.ts`：插件入口（`name` / `inject` / `apply`）。
- `tsdown.prepare.config.ts`：git 安装时 `prepare` 的自包含转译配置（转译
  `src/` → `lib/`，不做项目引用、不做类型检查）。

## 章节

### 服务 API

A2A server 暴露两个端点（JSON-RPC binding，协议版本 `1.0`）：

- `GET /.well-known/agent-card.json`：公开的 agent card（JSON）。含
  `supportedInterfaces[].protocolBinding = "JSONRPC"`、`protocolVersion = "1.0"`、
  `capabilities.streaming = true`。
- `POST /`：JSON-RPC。最小闭环用 `method: "SendMessage"`，`params.message`
  携带用户文本消息；服务端 `AgentExecutor` 把文本投给一个新建的 dsh agent
  会话同步执行，最终输出作为 artifact（`lastChunk: true`）返回，任务状态流
  为 `submitted → working → completed`。流式方法 `SendStreamingMessage` /
  `SubscribeToTask` 以 SSE 返回。

认证：配置 `authToken` 后，所有请求必须带 `Authorization: Bearer <token>`，
否则 `401`。

### 事件

P0 只实现同步任务往返（task → statusUpdate → artifact → statusUpdate），
暂不向客户端推送思考 / 工具 / 文本 / 进度中间事件流；流式事件推送留后续阶段。

### 扩展点 / 配置

`Config` 字段（cordis.yml 插件 `config`，也可从环境 `A2A_SERVER_TOKEN` 读 token）：

- `port`：监听端口（缺省探测 8092/8093/8094 首个空闲端口）。
- `host`：监听地址（默认 `127.0.0.1`，仅本机）。
- `authToken`：Bearer token（设置后强制校验）。
- `provider`：后端 provider（默认 `deepseek-official`）。
- `model`：执行模型（默认 `deepseek-v4-flash`；空串 = 跟随 dsh 用户/默认设置）。
- `preset`：挂载的 agent preset（默认 `standard`）。
- `cwd`：任务工作目录（默认进程 cwd）。

注入依赖：`agents`、`agentPresets`。

### 设计说明

- 会话语义（最小版）：每次 A2A task 新建一个独立 dsh 会话执行，任务毕释放句柄
  （会话持久化保留，可凭 sessionId 续接）。「一个 Hermes 对话 session ↔ 一个
  dsh 会话」的 origin/复用映射留 P1。
- 流式粒度：P0 为同步任务往返（阻塞式 `SendMessage`），不推中间事件流。
- 传输选型：JSON-RPC over node:http（自建 listener，非 express）；agent card
  走 `/.well-known/agent-card.json` 公开端点。

### 命名

- 包名：`dsh-a2a-server`（bundle 补丁中 `name` 引用此名做 Node 解析）。
- 补丁行逻辑 id：`a2a-server`。
- 插件 role：`Executor`（对应 A2A `AgentExecutor` 映射，把 A2A task 文本投给
  dsh agent 会话执行）。

## License

MIT（暂定，与上游生态一致；最终许可以管理员确认为准）。见 `LICENSE`。

## 开发

```sh
pnpm install      # 独立 workspace（pnpm-workspace.yaml 隔离，不碰主仓库 lockfile）
pnpm run build    # tsdown 转译 src/ → lib/（standalone，无项目引用）
pnpm run typecheck # tsc --noEmit
```

`lib/index.js` 由 tsdown 直接转译（ESM），`@deepseek-ai/*` 与 `@a2a-js/sdk`
均为外部依赖，不打包进产物；运行时在 profile 内解析。
