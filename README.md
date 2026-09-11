# dsh-a2a-server

[English](README.en.md) | **简体中文**

dsh 侧的 A2A (Agent2Agent) server 插件库：把 dsh agent 会话以 A2A 协议暴露给远端
agent（如 Hermes），实现「Hermes = brain，dsh = arms」的互操作。

## 效果

本库负责在 dsh 侧暴露 A2A server 与流式中间事件；**客户端侧的直播呈现**（工具命令 /
执行结果 / 最终文本的代码框渲染、进度推送到飞书 / QQ）由
[hermes-a2a-bridge](https://github.com/ArtomYuan/hermes-a2a-bridge) 负责，实际效果见其
README 的「效果展示」章节。

## 流程图

```
A2A 客户端（如 Hermes）
        │  JSON-RPC over node:http
        ▼
dsh-a2a-server
   ├─ GET /.well-known/agent-card.json   （agent card）
   ├─ POST /（SendMessage / SendStreamingMessage）
   ├─ Bearer 认证（authToken）
   └─ AgentExecutor → 会话映射（contextId）
        │
        ▼
dsh agent 会话（执行 / 复用 / 跨重启 resume）
```

## 安装说明

本库是独立公开 bundle 包（非 dsh workspace 内包），以 standalone bundle 形态分发。

1. 装进 dsh profile（开发期推荐 GitHub 安装，**必须固定 commit**）：

   ```sh
   dsh plugin --profile <name> add github:ArtomYuan/dsh-a2a-server#<commit>
   ```

   首次 `add` 会因 pnpm ≥10 默认拒绝 git 依赖的 `prepare` 脚本而失败，按提示把包键
   加入 profile 的 `pnpm-workspace.yaml` 后重跑：

   ```yaml
   allowBuilds:
     dsh-a2a-server: true
   ```

2. 在 profile 的 cordis 配置里给 A2A server 插件填最小配置（`port` / `authToken` /
   `preset`）：

   ```yaml
   - id: a2a-server
     config:
       port: 8092
       authToken: <token>
       preset: standard
   ```

   `token` 需与 Hermes 侧 `a2a_agents.dsh.auth.token` 一致。

## 链接

- 详细配置与机制说明：[CONFIGURATION.md](CONFIGURATION.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)
- 许可证：[License & Attribution](#license--attribution)

## License & Attribution

本项目以 GNU General Public License v3.0（GPL-3.0）分发，全文见 `LICENSE`。部分实现
（agent 会话接管 / agentLocks / origin-map 会话复用模式）移植自
[chushixixin/dsh-harness-mcp-server](https://github.com/chushixixin/dsh-harness-mcp-server)
（MIT License，Copyright chushixixin），原 MIT 版权声明保留，按 MIT 条款再许可纳入本项目。
