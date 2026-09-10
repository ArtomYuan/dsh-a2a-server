# dsh-a2a-server

dsh 侧的 A2A (Agent2Agent) server 插件库：把 dsh agent 会话以 A2A 协议暴露给
远端 agent（如 Hermes），实现「Hermes = brain，dsh = arms」的互操作。

> 状态：**P-1 骨架**。本仓库当前只建立 bundle 包形态、cordis 补丁骨架、插件
> 入口骨架与部署说明；A2A server 的业务逻辑在 P0 落地，通过 P0 闭环验证后才
> 推送 GitHub。

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

## 章节骨架（正文待 P0+ 填写）

### 服务 API

TODO(P0)：A2A server 暴露的端点（`/agent-card`、`/tasks` send、`/tasks/{id}`
get/cancel 等）及请求/响应字段。

### 事件

TODO(P0)：server 向 Hermes 侧推送的事件流（思考 / 工具 / 状态 / 文本 / 进度）
及每条事件的字段契约。

### 扩展点 / 配置

TODO(P0)：`Config` 字段（端口、agent card、agent-executor 映射等）及 cordis
注入依赖。

### 设计说明

TODO(P0)：会话语义（一个 Hermes 对话 session ↔ 一个 dsh 会话）、流式粒度、
传输选型与回滚。

### 命名

- 包名：`dsh-a2a-server`（bundle 补丁中 `name` 引用此名做 Node 解析）。
- 补丁行逻辑 id：`a2a-server`。
- P0 的插件 role 参考 `Executor`（对应 A2A `AgentExecutor` 映射）——P-1 只定名，
  未实现。

## License

MIT（暂定，与上游生态一致；最终许可以管理员确认为准）。见 `LICENSE`。

## 开发

TODO(P0)：`pnpm install` / `pnpm run prepare` / `pnpm run typecheck`（类型检查
在 P0 引入 CI 后补齐）。
