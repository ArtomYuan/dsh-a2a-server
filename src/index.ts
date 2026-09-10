/**
 * dsh-a2a-server — 在 dsh profile 内启动 A2A (Agent2Agent) server，把 dsh
 * agent 会话通过 A2A 协议暴露给远端 agent（如 Hermes）。
 *
 * P0 最小闭环：
 *   - node:http 常驻 listener（Bearer token 认证 + 路由），挂
 *     `@a2a-js/sdk` v1.1.0 的 `JsonRpcTransportHandler`。
 *   - `AgentExecutor` 把 A2A task 的文本同步投给一个**新建**的 dsh agent
 *     会话执行，最终 assistant 输出作为 A2A artifact 返回。
 *   - 会话策略（最小版）：每次任务新建独立会话，任务毕释放句柄；
 *     origin/sessionId 复用映射留 P1。
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
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
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
export const inject = ['agents', 'agentPresets']

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
  /** 挂载的 agent preset（默认 standard） */
  preset?: string
  /** 任务工作目录（默认进程 cwd） */
  cwd?: string
}

/** 运行时配置（apply 时从 config / 环境初始化，提供安全默认值） */
const runtimeConfig = {
  provider: 'deepseek-official',
  // 空字符串 = 不覆盖 model，跟随 dsh 的用户/默认设置；显式配置则覆盖
  model: 'deepseek-v4-flash',
  preset: 'standard',
  authToken: '',
  cwd: '',
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

      // 3. dsh 真实执行（新建会话 → followup → whenIdle → 读最终文本）
      const resultText = await this.runDshTask(text)

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

  /** 新建一个 dsh 会话同步执行任务，返回最终 assistant 文本；句柄任务毕释放 */
  private async runDshTask(text: string): Promise<string> {
    const cwd = await canonicalCwd(runtimeConfig.cwd || process.cwd())
    const sessionId = SessionId(randomUUID())
    const handle: AgentHandle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd, agentPreset: runtimeConfig.preset },
      agentOptions: {
        provider: runtimeConfig.provider,
        // model 为空则省略，让 dsh 跟随用户/默认设置
        ...(runtimeConfig.model ? { model: runtimeConfig.model } : {}),
      },
      setup: async (agentCtx) => {
        // dsh rc.6 bug 兜底：setup 收到的 agent ctx 可能丢 scope tag，
        // 无 scope 时跳过挂载（降级为无工具 agent），避免整体崩溃
        if (scopeOf(agentCtx) === undefined) {
          console.warn('[dsh-a2a-server] agent ctx unscoped; preset mount skipped')
          return
        }
        await this.ctx.agentPresets.mount(agentCtx, runtimeConfig.preset)
      },
    })

    try {
      const baseline = ((handle.agent.session as unknown as { log?: unknown[] }).log ?? []).length
      handle.agent.followup(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: 'dsh-a2a-server' },
        }),
      )
      await handle.agent.whenIdle()

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
      // 最小版：新建独立会话，任务毕释放句柄（会话持久化保留，可凭 sessionId 续接）
      try {
        await handle.dispose()
      } catch {
        /* 释放失败不影响结果返回 */
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
  // 运行配置也可从环境读（覆盖 cordis 配置之外的最简通道）
  if (process.env.A2A_SERVER_TOKEN) runtimeConfig.authToken = process.env.A2A_SERVER_TOKEN

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

  // 标准 cordis 生命周期：卸载时关闭 server
  ctx.effect(() => {
    return () => {
      server.close()
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
