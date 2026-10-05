/**
 * src/compat.ts 的纯 stdlib 单测（node:test + node:assert/strict，无新框架）。
 *
 * 运行：`pnpm test`（先 `pnpm run build:host` 产出 lib/compat.js 再跑）。
 * 覆盖：
 *  - supportsNamespacedMessageSource 的版本判定（0.1.5-rc.2 / 0.2.0-rc.2 /
 *    0.2.0 / 未知）；
 *  - readToolResult 对 v3 夹具与 v4 夹具（同一语义、两种形状）的双形状读取；
 *  - pluginMessageSource 在两种判定下的 source 形状与探测一致性。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dshRuntimeVersion,
  isVolatile,
  supportsNamespacedMessageSource,
  pluginMessageSource,
  pluginMessageSourceFor,
  readToolResult,
  sourceModeForSessionVersion,
  unwrapVolatile,
} from '../lib/compat.js'

// ── supportsNamespacedMessageSource：版本判定 ────────────────────────────

test('supportsNamespacedMessageSource: 0.1.x 一律为假', () => {
  assert.equal(supportsNamespacedMessageSource('0.1.5-rc.2'), false)
  assert.equal(supportsNamespacedMessageSource('0.1.2-rc.1'), false)
  assert.equal(supportsNamespacedMessageSource('0.1.99'), false)
})

test('supportsNamespacedMessageSource: 0.2.0 起（含预发布）为真', () => {
  assert.equal(supportsNamespacedMessageSource('0.2.0-rc.2'), true)
  assert.equal(supportsNamespacedMessageSource('0.2.0-rc.1'), true)
  assert.equal(supportsNamespacedMessageSource('0.2.0'), true)
  assert.equal(supportsNamespacedMessageSource('0.2.1'), true)
  assert.equal(supportsNamespacedMessageSource('0.3.0'), true)
  assert.equal(supportsNamespacedMessageSource('1.0.0'), true)
})

test('supportsNamespacedMessageSource: 未知/无法解析按假处理（回落 0.1.5）', () => {
  assert.equal(supportsNamespacedMessageSource(undefined), false)
  assert.equal(supportsNamespacedMessageSource(''), false)
  assert.equal(supportsNamespacedMessageSource('garbage'), false)
  assert.equal(supportsNamespacedMessageSource('0.2'), false)
})

// ── readToolResult：同一语义、两种形状的对照夹具 ────────────────────────

/** 两种形状共同语义：callId='call-42'，结果文本='stdout line' */
const CALL_ID = 'call-42'
const RESULT_TEXT = 'stdout line'

/** v3（0.1.5）：toolCallId 与文本都嵌在 content[0] 的 tool-result 包装块里 */
const TOOL_RESULT_V3 = {
  turn: 1,
  step: 3,
  message: {
    content: [
      {
        toolCallId: CALL_ID,
        content: [{ type: 'text', text: RESULT_TEXT }],
      },
    ],
  },
}

/** v4（0.2.0 实测形状）：data 键 ['error','message','step','turn']；
 *  toolCallId 在 message 层、content 已展平、role='tool' */
const TOOL_RESULT_V4 = {
  error: undefined,
  step: 3,
  turn: 1,
  message: {
    id: 'msg-7',
    isError: false,
    role: 'tool',
    source: { kind: 'tool', toolCallId: CALL_ID },
    toolCallId: CALL_ID,
    content: [{ type: 'text', text: RESULT_TEXT }],
  },
}

test('readToolResult: v3 夹具读出 callId 与 text', () => {
  assert.deepEqual(readToolResult(TOOL_RESULT_V3), { callId: CALL_ID, text: RESULT_TEXT })
})

test('readToolResult: v4 夹具读出与 v3 相同的 callId 与 text（同一语义）', () => {
  assert.deepEqual(readToolResult(TOOL_RESULT_V4), { callId: CALL_ID, text: RESULT_TEXT })
})

test('readToolResult: v3/v4 夹具结果完全一致（对照用例）', () => {
  assert.deepEqual(readToolResult(TOOL_RESULT_V3), readToolResult(TOOL_RESULT_V4))
})

test('readToolResult: v4 展平多文本块按出现顺序拼接，非 text 块忽略', () => {
  const read = readToolResult({
    message: {
      toolCallId: 'c1',
      content: [
        { type: 'text', text: 'line1' },
        { type: 'image', text: 'not-a-text-block' },
        { type: 'text', text: 'line2' },
      ],
    },
  })
  assert.deepEqual(read, { callId: 'c1', text: 'line1\nline2' })
})

test('readToolResult: v3 无 text 块时 text 为 undefined（不抛）', () => {
  assert.deepEqual(readToolResult({ message: { content: [{ toolCallId: 'c2', content: [] }] } }), {
    callId: 'c2',
    text: undefined,
  })
})

test('readToolResult: 回落 data.callId', () => {
  assert.deepEqual(readToolResult({ callId: 'c3' }), { callId: 'c3', text: undefined })
})

test('readToolResult: 任何形状都取不到 → 双 undefined（不抛）', () => {
  assert.deepEqual(readToolResult({}), { callId: undefined, text: undefined })
  assert.deepEqual(readToolResult(undefined), { callId: undefined, text: undefined })
  assert.deepEqual(readToolResult(null), { callId: undefined, text: undefined })
  assert.deepEqual(readToolResult('garbage'), { callId: undefined, text: undefined })
})

// ── pluginMessageSource：source 形状选择 ─────────────────────────────────

test('pluginMessageSource: 0.1.5 判定给出 legacy 形状', () => {
  assert.deepEqual(pluginMessageSource('0.1.5-rc.2'), {
    kind: 'plugin',
    plugin: '@artomyuan/dsh-a2a-server',
  })
})

test('pluginMessageSource: 0.2.0 判定给出命名空间化形状', () => {
  assert.deepEqual(pluginMessageSource('0.2.0-rc.2'), { kind: 'plugin:@artomyuan/dsh-a2a-server' })
  assert.deepEqual(pluginMessageSource('0.2.0'), { kind: 'plugin:@artomyuan/dsh-a2a-server' })
})

test('pluginMessageSource: 探测一致性（不抛，形状与显式版本判定一致）', () => {
  // 本仓库 devDep 的 dsh-agent exports 含 ./package.json，探测应成功返回
  // 版本串；无参调用（真实探测）与按探测版本显式判定的形状一致。
  const version = dshRuntimeVersion()
  assert.equal(typeof version, 'string')
  assert.match(version, /^\d+\.\d+\.\d+/)
  assert.deepEqual(pluginMessageSource(), pluginMessageSource(version))
})

test('pluginMessageSource: 无法解析的显式版本回落 legacy 形状（不抛）', () => {
  assert.deepEqual(pluginMessageSource('garbage'), {
    kind: 'plugin',
    plugin: '@artomyuan/dsh-a2a-server',
  })
})

test('sourceModeForSessionVersion: v4 起为 namespaced，v3 及未知为 legacy', () => {
  assert.equal(sourceModeForSessionVersion(4), 'namespaced')
  assert.equal(sourceModeForSessionVersion(5), 'namespaced')
  assert.equal(sourceModeForSessionVersion(3), 'legacy')
  assert.equal(sourceModeForSessionVersion(0), 'legacy')
  assert.equal(sourceModeForSessionVersion(undefined), 'legacy')
})

test('pluginMessageSourceFor: 显式 mode 给出对应形状（重试兜底用）', () => {
  assert.deepEqual(pluginMessageSourceFor('legacy'), { kind: 'plugin', plugin: '@artomyuan/dsh-a2a-server' })
  assert.deepEqual(pluginMessageSourceFor('namespaced'), { kind: 'plugin:@artomyuan/dsh-a2a-server' })
})

// ── unwrapVolatile：volatile 引用对象解包（纯函数、双版本都要） ──────────

test('unwrapVolatile: plain 标量原样返回（幂等）', () => {
  assert.equal(unwrapVolatile(42), 42)
  assert.equal(unwrapVolatile('str'), 'str')
  assert.equal(unwrapVolatile(true), true)
  assert.equal(unwrapVolatile(null), null)
})

test('unwrapVolatile: undefined 原样返回', () => {
  assert.equal(unwrapVolatile(undefined), undefined)
})

test('unwrapVolatile: 引用对象取 get()', () => {
  assert.equal(unwrapVolatile({ get: () => 'value' }), 'value')
})

test('unwrapVolatile: 引用对象内嵌引用对象递归 get()', () => {
  assert.equal(unwrapVolatile({ get: () => ({ get: () => 'inner' }) }), 'inner')
})

test('unwrapVolatile: 嵌套对象/数组逐层解包，普通值不丢', () => {
  const nested = {
    port: { get: () => 8092 },
    deep: { host: { get: () => '127.0.0.1' } },
    list: [{ get: () => 'a' }, 2, null],
  }
  assert.deepEqual(unwrapVolatile(nested), {
    port: 8092,
    deep: { host: '127.0.0.1' },
    list: ['a', 2, null],
  })
})

test('isVolatile: 结构判定（typeof v?.get === "function"）', () => {
  assert.equal(isVolatile({ get: () => 1 }), true)
  assert.equal(isVolatile({ get: 1 }), false)
  assert.equal(isVolatile(null), false)
  assert.equal(isVolatile(undefined), false)
  assert.equal(isVolatile('x'), false)
  assert.equal(isVolatile([1, 2]), false)
  assert.equal(isVolatile(42), false)
})
