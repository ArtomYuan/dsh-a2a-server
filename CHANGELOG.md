# Changelog

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

（暂无未发布变更）

## [0.1.0] - 2026-09-12

### Added

- A2A server 初始实现：JSON-RPC over node:http，`@a2a-js/sdk`
  JsonRpcTransportHandler + AgentExecutor 把 A2A task 文本投给 dsh agent 会话
  同步执行。
- agent card：`GET /.well-known/agent-card.json` 公开端点（JSONRPC binding、
  protocolVersion 1.0、capabilities.streaming）。
- Bearer 认证：配置 `authToken` 后强制校验 `Authorization: Bearer <token>`。
- contextId 会话复用 + 跨重启 resume：`message.contextId` 映射到 dsh 会话，映射
  持久化到 `$DSH_HOME/storages/a2a-context-map.json`，带 TTL 清理（默认 7 天）。
- agent-team preset 挂载（`preset: agent-team`）。
- 流式中间事件：`SendStreamingMessage` 实时推思考 / 工具 / 状态 / 文本中间事件
  （text Part + data Part 私有扩展）。
- `SendMessage` 阻塞式返回最终文本（artifact，lastChunk）。

### Changed

- LICENSE 由 MIT 改为 GPL-3.0。

### Security

- 项目以 GPL-3.0 分发；部分实现（agent 会话接管 / agentLocks / origin-map 会话
  复用模式）移植自 chushixixin/dsh-harness-mcp-server（MIT License，Copyright
  chushixixin），原 MIT 版权声明保留，按 MIT 条款再许可纳入本项目（见 README
  「License & Attribution」）。

### Docs

- 双语 README（README.md + README.en.md）。
