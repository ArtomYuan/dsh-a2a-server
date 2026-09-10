/**
 * dsh-a2a-server — 在 dsh profile 内启动 A2A (Agent2Agent) server，把 dsh
 * agent 会话通过 A2A 协议暴露给远端 agent（如 Hermes）。
 *
 * P0 最小闭环：
 *   - node:http 常驻 listener（Bearer token 认证 + 路由），挂
 *     `@a2a-js/sdk` v1.1.0 的 `JsonRpcTransportHandler`。
 *   - `AgentExecutor` 把 A2A task 的文本同步投给 dsh agent 会话执行，最终
 *     assistant 输出作为 A2A artifact 返回。
 *
 * P1 contextId 会话映射：
 *   - A2A `message.contextId`（Hermes 传 origin 派生）→ dsh 会话键。同
 *     contextId 复用同一 dsh 会话（上下文连续），异 contextId 隔离。
 *   - 两级接管：持久映射命中 → `ctx.agents.resume`；未命中 → 新建 + 写映射。
 *     映射持久化到 `$DSH_HOME/storages/a2a-context-map.json`，跨重启续接。
 *
 * P2a 流式中间事件 + 映射清理：
 *   - `SendStreamingMessage` 流式模式下，订阅 dsh agent 的 `session/event`，
 *     把思考/工具/状态/文本等中间事件作为 A2A `artifactUpdate`（文本用 text
 *     Part、非文本用 data Part 私有扩展）实时推给客户端。
 *   - contextMap 每条目记 lastUsedAt，TTL（默认 7 天）清理过期孤儿条目。
 */

import type { Context } from '@deepseek-ai/cordis'
// 类型声明合并：让 ctx.agents / ctx.agentPresets 在 Context 上有类型
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
  TaskState,
  formatSSEEvent,
} from '@a2a-js/sdk'
import type { AgentCard, Part } from '@a2a-js/sdk'
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  ServerCallContext,
} from '@a2a-js/sdk/server'
import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server'

/** Cordis 插件名 */
export const name = 'dsh-a2a-server'

/** 声明依赖的核心服务（必须与代码里的 ctx.get / 直接调用对齐） */
export const inject = ['agents', 'agentPresets', 'sessions']

/** 插件配置 */
export interface Config {
  /** 监听端口；缺省探测 8092/8093/8094 首个空闲端口 */
  port?: number
  /** 监听地址（默认 127.0.0.1，仅本机） */
  host?: string
  /** Bearer token（设置后所有请求必须带 Authorization: Bearer <token>） */
  authToken?: string
  /** 后端 provider（默认 deepseek-official） */
  provider?: string
  /** 执行任务的模型（默认 deepseek-v4-flash；空串 = 跟随 dsh 用户/默认设置） */
  model?: string
  /** 挂载的 agent preset（默认 standard；可设 agent-team 等） */
  preset?: string
  /** 任务工作目录（默认进程 cwd） */
  cwd?: string
  /** contextId→session 映射持久文件路径（默认 $DSH_HOME/storages/a2a-context-map.json） */
  contextMapPath?: string
  /** contextId→session 映射条目 TTL 天数（默认 7，超期条目在加载/写入时清理） */
  contextMapTtlDays?: number
}

/** 运行时配置（apply 时从 config / 环境初始化，提供安全默认值） */
const runtimeConfig = {
  provider: 'deepseek-official',
  // 空字符串 = 不覆盖 model，跟随 dsh 的用户/默认设置；显式配置则覆盖
  model: 'deepseek-v4-flash',
  preset: 'standard',
  authToken: '',
  cwd: '',
  contextMapTtlDays: 7,
}

/** 构造一个纯文本 Part */
function textPart(value: string): Part {
  return {
    content: { $case: 'text', value },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  }
}

/** 构造一个结构化 data Part（私有扩展：承载思考/工具/状态等中间事件） */
function dataPart(value: unknown): Part {
  return {
    content: { $case: 'data', value },
    metadata: undefined,
    filename: '',
    mediaType: 'application/json',
  }
}

/** 从 A2A user message 提取文本（拼接所有 text part） */
function userMessageText(message: { parts: Part[] }): string {
  return message.parts
    .map((p) => (p.content?.$case === 'text' ? p.content.value : ''))
    .join('\n')
    .trim()
}

/** cwd realpath 规范化（解析符号链接与 .. 段），失败回退 resolve */
async function canonicalCwd(raw: string): Promise<string> {
  try {
    return await realpath(raw)
  } catch {
    return resolve(raw)
  }
}

/** 读取 HTTP 请求体为 UTF-8 字符串 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectBody)
  })
}

/** 探测端口是否空闲（check-then-listen 的 dev 级探测，竞态可忽略） */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const probe = http.createServer()
    probe.once('error', () => resolveFree(false))
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolveFree(true))
    })
  })
}

// ── contextId 会话映射（P1）────────────────────────────────────────────
// 键 `${contextId}\0${cwd}` → sessionId（同 harness-mcp-server 的 origin-map
// 格式）。同 contextId 复用同一 dsh 会话；映射持久化跨重启 resume。

/** 映射条目：sessionId + 最近使用时间戳（TTL 清理依据） */
interface ContextMapEntry {
  sessionId: string
  lastUsedAt: number
}

/** 常驻内存映射：复合键（contextId\0cwd）→ { sessionId, lastUsedAt } */
const contextMap = new Map<string, ContextMapEntry>()

/** 映射落盘路径；apply() 解析 dshHomePath 服务后赋值 */
let contextMapPath: string | null = null

/** 映射落盘串行链（避免并发写交错） */
let contextMapWriteChain = Promise.resolve()

/** 清理超期条目（lastUsedAt 超过 TTL 天）；返回清理数 */
function cleanupContextMap(): number {
  const ttlMs = runtimeConfig.contextMapTtlDays * 24 * 60 * 60 * 1000
  const now = Date.now()
  let removed = 0
  for (const [k, entry] of contextMap) {
    if (now - entry.lastUsedAt > ttlMs) {
      contextMap.delete(k)
      removed++
    }
  }
  if (removed > 0) console.log(`[dsh-a2a-server] context-map cleanup: removed ${removed} expired entries`)
  return removed
}

/** 读 a2a-context-map.json 回填 contextMap 并清理过期条目（ENOENT 静默空映射） */
async function loadContextMap(): Promise<void> {
  if (contextMapPath === null) return
  try {
    const raw = await readFile(contextMapPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        // 向后兼容：旧格式 v 为 string（sessionId）；新格式为 { sessionId, lastUsedAt }
        if (typeof v === 'string') {
          contextMap.set(k, { sessionId: v, lastUsedAt: Date.now() })
        } else if (v && typeof v === 'object' && typeof (v as { sessionId?: unknown }).sessionId === 'string') {
          const entry = v as { sessionId: string; lastUsedAt?: unknown }
          contextMap.set(k, {
            sessionId: entry.sessionId,
            lastUsedAt: typeof entry.lastUsedAt === 'number' ? entry.lastUsedAt : Date.now(),
          })
        }
      }
    }
    cleanupContextMap()
  } catch (e) {
    if ((e as { code?: string }).code !== 'ENOENT') {
      console.warn('[dsh-a2a-server] context-map load failed:', (e as Error)?.message ?? e)
    }
  }
}

/** 串行落盘 contextMap（先清理过期 → 快照 → mkdir → tmp 写 → rename 原子覆盖）；失败仅 warn 不阻断 */
function persistContextMap(): Promise<void> {
  contextMapWriteChain = contextMapWriteChain.then(async () => {
    if (contextMapPath === null) return
    cleanupContextMap()
    const snapshot = JSON.stringify(Object.fromEntries(contextMap), null, 2)
    const tmp = `${contextMapPath}.tmp`
    try {
      await mkdir(dirname(contextMapPath), { recursive: true })
      await writeFile(tmp, snapshot)
      await rename(tmp, contextMapPath)
    } catch (e) {
      console.warn('[dsh-a2a-server] context-map persist failed:', (e as Error)?.message ?? e)
    }
  })
  return contextMapWriteChain
}

/** 会话解析结果：disposeAfter = true 表示任务毕须 flush + dispose 释放句柄 */
interface ResolvedSession {
  sessionId: SessionId
  handle: AgentHandle
}

/** 流式中间事件描述符（dsh 会话事件 → 高信号映射，见 runDshTask 的订阅器） */
interface StreamEventDescriptor {
  kind: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'turn_start' | 'turn_end'
  turn?: number
  step?: number
  text?: string
  name?: string
  arguments?: string
  reason?: string
}

/** 组装 agent 的 provider/model/preset 选项（创建与 resume 共用的 agentOptions + setup） */
function agentComposition(ctx: Context) {
  return {
    agentOptions: {
      provider: runtimeConfig.provider,
      // model 为空则省略，让 dsh 跟随用户/默认设置
      ...(runtimeConfig.model ? { model: runtimeConfig.model } : {}),
    },
    setup: async (agentCtx: Context) => {
      // dsh rc.6 bug 兜底：setup 收到的 agent ctx 可能丢 scope tag，
      // 无 scope 时跳过挂载（降级为无工具 agent），避免整体崩溃
      if (scopeOf(agentCtx) === undefined) {
        console.warn('[dsh-a2a-server] agent ctx unscoped; preset mount skipped')
        return
      }
      await ctx.agentPresets.mount(agentCtx, runtimeConfig.preset)
    },
  }
}

/**
 * 解析（或新建）contextId 对应的 dsh 会话。两级接管：
 * 映射命中 → `ctx.agents.resume`（失败懒删映射落到新建分支）；未命中 → 新建 + 写映射。
 */
async function resolveSession(
  ctx: Context,
  cwd: string,
  contextId: string,
): Promise<ResolvedSession> {
  const key = `${contextId}\u0000${cwd}`
  const mapped = contextMap.get(key)
  if (mapped !== undefined) {
    const sid = SessionId(mapped.sessionId)
    try {
      const handle = await ctx.agents.resume({
        resumeSessionId: sid,
        ...agentComposition(ctx),
      })
      // 命中：刷新最近使用时间戳（TTL 依据）
      mapped.lastUsedAt = Date.now()
      return { sessionId: sid, handle }
    } catch (e) {
      // resume 失败（会话已删/损坏）：懒删映射，落到下方新建分支（不抛错）
      contextMap.delete(key)
      void persistContextMap()
      console.warn('[dsh-a2a-server] contextId resume failed, falling back to new session:', (e as Error)?.message ?? e)
    }
  }
  const newSessionId = SessionId(randomUUID())
  const handle = await ctx.agents.create({
    sessionId: newSessionId,
    ...agentComposition(ctx),
    meta: { cwd, agentPreset: runtimeConfig.preset },
  })
  contextMap.set(key, { sessionId: String(newSessionId), lastUsedAt: Date.now() })
  void persistContextMap()
  return { sessionId: newSessionId, handle }
}

/**
 * 把 A2A task 映射为一次 dsh agent 同步执行（最小版：每次新建独立会话）。
 * `execute` 按 A2A 规范发布 task → statusUpdate(working) → artifact →
 * statusUpdate(completed) 事件流；dsh 执行抛错时异常向上传播，由
 * DefaultRequestHandler 合成 FAILED 状态返回给客户端。
 */
class DshAgentExecutor implements AgentExecutor {
  private readonly cancelled = new Set<string>()

  constructor(private readonly ctx: Context) {}

  async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    this.cancelled.add(taskId)
  }

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId
    const contextId = requestContext.contextId
    const userMessage = requestContext.userMessage
    const text = userMessageText(userMessage)

    try {
      // 1. 每个执行流必须以 task 事件开头
      eventBus.publish(
        AgentEvent.task({
          id: taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          artifacts: [],
          history: [userMessage],
          metadata: userMessage.metadata,
        }),
      )

      // 2. working 状态
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          metadata: {},
        }),
      )

      // 3. dsh 真实执行（按 contextId 复用/新建会话 → followup → whenIdle → 读最终文本），
      //    期间把高信号中间事件实时推为 A2A 流式 artifactUpdate
      const resultText = await this.runDshTask(text, contextId, (desc) => {
        if (desc.kind === 'text') {
          // 文本块：append 到共享 'stream-text' artifact（客户端拼接成连续文本流）
          eventBus.publish(
            AgentEvent.artifactUpdate({
              taskId,
              contextId,
              artifact: {
                artifactId: 'stream-text',
                name: 'StreamText',
                description: '流式文本块',
                parts: [textPart(desc.text ?? '')],
                metadata: undefined,
                extensions: [],
              },
              append: true,
              lastChunk: false,
              metadata: undefined,
            }),
          )
        } else {
          // 思考/工具/状态：data Part 私有扩展（JSON 描述符）
          eventBus.publish(
            AgentEvent.artifactUpdate({
              taskId,
              contextId,
              artifact: {
                artifactId: randomUUID(),
                name: 'StreamEvent',
                description: '流式中间事件',
                parts: [dataPart(desc)],
                metadata: undefined,
                extensions: [],
              },
              append: false,
              lastChunk: false,
              metadata: undefined,
            }),
          )
        }
      })

      if (this.cancelled.has(taskId)) {
        eventBus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_CANCELED,
              timestamp: new Date().toISOString(),
              message: undefined,
            },
            metadata: {},
          }),
        )
        return
      }

      // 4. artifact（最终输出）
      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId: randomUUID(),
            name: 'Result',
            description: 'dsh agent 的最终输出',
            parts: [textPart(resultText)],
            metadata: undefined,
            extensions: [],
          },
          append: false,
          lastChunk: true,
          metadata: undefined,
        }),
      )

      // 5. completed
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          metadata: undefined,
        }),
      )
    } finally {
      this.cancelled.delete(taskId)
    }
  }

  /** 按 contextId 解析 dsh 会话执行任务，返回最终 assistant 文本；句柄任务毕 flush + 释放 */
  private async runDshTask(
    text: string,
    contextId: string,
    onEvent: (desc: StreamEventDescriptor) => void,
  ): Promise<string> {
    const cwd = await canonicalCwd(runtimeConfig.cwd || process.cwd())
    const { sessionId, handle } = await resolveSession(this.ctx, cwd, contextId)

    try {
      const baseline = ((handle.agent.session as unknown as { log?: unknown[] }).log ?? []).length

      // 流式订阅：过滤本会话的 session/event，映射高信号中间事件实时回调。
      // assistant/chunk 按 block index 缓冲 text/reasoning delta，block-end 才 emit（整块）。
      const textBuf: Record<number, string> = {}
      const thoughtBuf: Record<number, string> = {}
      const callNames = new Map<string, string>()
      const dispose = this.ctx.on('session/event', (session, event) => {
        const sid = (session as { header?: { id?: unknown }; id?: unknown }).header?.id
          ?? (session as { id?: unknown }).id
        if (String(sid) !== String(sessionId)) return
        const ev = event as { type?: string; data?: {
          turn?: number
          step?: number
          name?: string
          arguments?: string
          callId?: string
          reason?: { kind?: string }
          chunk?: { type?: string; blockType?: string; index?: number; text?: string; block?: { type?: string } }
          message?: { content?: { type?: string; text?: string; toolCallId?: string; content?: { type?: string; text?: string }[] }[] }
        } }
        const data = ev.data ?? {}
        switch (ev.type) {
          case 'assistant/chunk': {
            const chunk = data.chunk
            if (chunk === undefined || chunk.index === undefined) return
            if (chunk.type === 'block-start') {
              if (chunk.blockType === 'text') textBuf[chunk.index] = ''
              else if (chunk.blockType === 'reasoning') thoughtBuf[chunk.index] = ''
            } else if (chunk.type === 'text-delta') {
              if (textBuf[chunk.index] !== undefined) textBuf[chunk.index] += chunk.text ?? ''
              else if (thoughtBuf[chunk.index] !== undefined) thoughtBuf[chunk.index] += chunk.text ?? ''
            } else if (chunk.type === 'reasoning-delta') {
              if (thoughtBuf[chunk.index] !== undefined) thoughtBuf[chunk.index] += chunk.text ?? ''
            } else if (chunk.type === 'block-end') {
              const t = textBuf[chunk.index]
              delete textBuf[chunk.index]
              if (chunk.block?.type === 'text' && t !== undefined && t.length > 0) {
                onEvent({ kind: 'text', turn: data.turn, step: data.step, text: t })
              }
              const th = thoughtBuf[chunk.index]
              delete thoughtBuf[chunk.index]
              if (chunk.block?.type === 'reasoning' && th !== undefined && th.length > 0) {
                onEvent({ kind: 'thinking', turn: data.turn, step: data.step, text: th })
              }
            }
            return
          }
          case 'turn/start':
            onEvent({ kind: 'turn_start', turn: data.turn, step: data.step })
            return
          case 'turn/end':
            onEvent({ kind: 'turn_end', turn: data.turn, step: data.step, reason: data.reason?.kind })
            return
          case 'tool/call':
            if (data.callId !== undefined && data.name !== undefined) callNames.set(data.callId, data.name)
            onEvent({ kind: 'tool_call', turn: data.turn, step: data.step, name: data.name, arguments: data.arguments })
            return
          case 'tool/result': {
            // tool/result 不带 name（在 tool/call 里）；结果文本嵌在 tool-result 块
            // message.content[0].content[0].text；用 toolCallId 关联名称
            const block = data.message?.content?.[0]
            const toolCallId = block?.toolCallId
            onEvent({
              kind: 'tool_result',
              turn: data.turn,
              step: data.step,
              name: toolCallId !== undefined ? callNames.get(toolCallId) : undefined,
              text: block?.content?.[0]?.text,
            })
            return
          }
          default:
            return
        }
      })

      try {
        handle.agent.followup(
          createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'plugin', plugin: 'dsh-a2a-server' },
          }),
        )
        await handle.agent.whenIdle()
      } finally {
        dispose()
      }

      // 读本次任务的最终 assistant 文本
      const log = ((handle.agent.session as unknown as { log?: unknown[] }).log ?? []).slice(baseline)
      let out = ''
      for (const e of log) {
        const ev = e as { type?: string; data?: { message?: { content?: { type?: string; text?: string }[] } } }
        if (ev.type === 'assistant/message') {
          const content = ev.data?.message?.content
          if (content) {
            out += content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n') + '\n'
          }
        }
      }
      return out.trim() || '(no text output)'
    } finally {
      // 跨重启 resume 依赖会话已持久化：任务毕 flush，再释放句柄
      try {
        await (this.ctx.get('sessions') as { flush?: (s: unknown) => Promise<unknown> } | undefined)?.flush?.(handle.agent.session)
      } catch {
        /* flush 失败不阻断结果返回 */
      }
      try {
        await handle.dispose()
      } catch {
        /* 释放失败不影响结果 */
      }
    }
  }
}

/** 构造 agent card（url 用实际监听地址，JSONRPC binding，协议版本 1.0） */
function buildAgentCard(host: string, port: number): AgentCard {
  const base = `http://${host}:${port}/`
  return {
    name: 'dsh',
    description: 'DeepSeek Harness agent exposed over the A2A protocol.',
    supportedInterfaces: [
      {
        url: base,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: 'deepseek',
      url: 'https://github.com/deepseek-ai',
    },
    version: '0.1.2-rc.1',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [
      {
        id: 'dsh_task',
        name: 'dsh task',
        description: '执行编码 / 分析 / 命令类任务',
        tags: ['coding', 'task'],
        examples: ['列出当前目录前 5 个文件并告诉我总数'],
        inputModes: ['text'],
        outputModes: ['text', 'task-status'],
        securityRequirements: [],
      },
    ],
    documentationUrl: '',
    signatures: [],
  }
}

/**
 * 插件入口：初始化运行时配置，探测端口，启动 node:http listener 挂
 * JsonRpcTransportHandler，通过 ctx.effect 注册 dispose（关 server）。
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  if (config.provider) runtimeConfig.provider = config.provider
  if (config.model !== undefined) runtimeConfig.model = config.model
  if (config.preset) runtimeConfig.preset = config.preset
  if (config.authToken) runtimeConfig.authToken = config.authToken
  if (config.cwd) runtimeConfig.cwd = config.cwd
  if (config.contextMapTtlDays !== undefined) runtimeConfig.contextMapTtlDays = config.contextMapTtlDays
  // 运行配置也可从环境读（覆盖 cordis 配置之外的最简通道）
  if (process.env.A2A_SERVER_TOKEN) runtimeConfig.authToken = process.env.A2A_SERVER_TOKEN

  // contextId 会话映射持久文件路径: 配置 > dshHomePath 服务 > ~/.dsh fallback
  const dshHome = ctx.get('dshHomePath') as ((...segments: string[]) => string) | undefined
  contextMapPath = config.contextMapPath
    ?? (dshHome ? dshHome('storages', 'a2a-context-map.json') : join(homedir(), '.dsh', 'storages', 'a2a-context-map.json'))
  await loadContextMap()

  const host = config.host ?? '127.0.0.1'
  const port = config.port ?? (await probePort())

  const agentCard = buildAgentCard(host, port)
  const taskStore = new InMemoryTaskStore()
  const executor = new DshAgentExecutor(ctx)
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, executor)
  const transport = new JsonRpcTransportHandler(requestHandler)

  const server = http.createServer(async (req, res) => {
    // Bearer token 认证（配置了 authToken 时强制所有请求校验）
    if (runtimeConfig.authToken) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${runtimeConfig.authToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }))
        return
      }
    }

    try {
      // agent card 公开端点
      if (req.method === 'GET' && (req.url === `/${AGENT_CARD_PATH}` || req.url === `/${AGENT_CARD_PATH}/`)) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(await requestHandler.getAgentCard()))
        return
      }

      // JSON-RPC 端点
      if (req.method === 'POST' && (req.url === '/' || req.url === '')) {
        const rawBody = await readBody(req)
        const requestedVersion =
          (req.headers['a2a-version'] as string | undefined) ?? A2A_PROTOCOL_VERSION
        const context = new ServerCallContext({ requestedVersion })
        const rpcResult = await transport.handle(rawBody, context)
        if (typeof (rpcResult as unknown as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function') {
          // 流式（SendStreamingMessage / SubscribeToTask）→ SSE
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          })
          for await (const ev of rpcResult as AsyncGenerator<unknown, void, undefined>) {
            res.write(formatSSEEvent(ev))
          }
          res.end()
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(rpcResult))
        }
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    } catch (e) {
      console.error('[dsh-a2a-server] request error:', (e as Error)?.message ?? e)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: String((e as Error)?.message ?? e) },
            id: null,
          }),
        )
      }
    }
  })

  server.on('error', (e) => {
    console.error('[dsh-a2a-server] HTTP server error:', (e as Error).message)
  })

  // listen 转 Promise：'error' 只作为本次 listen 的失败通道，成功后移除
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (e: Error) => rejectListen(e)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.removeListener('error', onError)
      resolveListen()
    })
  })
  console.log(`[dsh-a2a-server] A2A server listening on ${host}:${port}`)

  // 标准 cordis 生命周期：卸载时关闭 server + 清空映射
  ctx.effect(() => {
    return () => {
      server.close()
      contextMap.clear()
    }
  }, 'dsh-a2a-server')
}

/** 探测 8092/8093/8094 首个空闲端口；全占用则报错（fail loud） */
async function probePort(): Promise<number> {
  for (const p of [8092, 8093, 8094]) {
    if (await isPortFree(p)) return p
  }
  throw new Error('[dsh-a2a-server] no free port among 8092/8093/8094')
}
