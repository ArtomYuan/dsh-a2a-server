/**
 * dsh-a2a-server 的 settings 命名空间（host 半边）。
 *
 * 通过官方 settings seam（`ctx.settings.installSection`）注册 `a2a-server`
 * 命名空间：cordis entry config 作为 base 层，面板写入落在 `$DSH_HOME/
 * settings.yaml` 的用户覆盖层（schema 默认 < base < user）。浏览器半边的卡片
 * 以同一命名空间为 key 挂进 `settings.plugin.item` 槽，两半边自动配对。
 *
 * settings 服务是可选依赖：没有挂 settings provider 的 profile 里
 * `ctx.inject(['settings'])` 的回调不会运行，插件照常用 entry config 工作。
 */

import type { Context } from '@deepseek-ai/cordis'
// 类型声明合并：让 ctx.settings（installSection 契约）在 Context 上有类型
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** 命名空间名 = 浏览器半边卡片在 `settings.plugin.item` 槽下的 key */
export const A2A_SETTINGS_NS = 'a2a-server'

/** settings 命名空间模式（与 dsh-settings 的 `^[a-z][a-z0-9-]*$` 一致） */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/

if (!NAMESPACE_PATTERN.test(A2A_SETTINGS_NS)) {
  throw new TypeError(`settings namespace "${A2A_SETTINGS_NS}" must match ${String(NAMESPACE_PATTERN)}`)
}

/** settings 文档里 `a2a-server` 段的值（全部字段可选） */
export interface A2ASettings {
  /** 监听端口（1–65535 整数）；重启后生效 */
  port?: number
  /** 监听地址；重启后生效 */
  host?: string
  /** Bearer token；只写不回显，下一请求生效 */
  authToken?: string
  /** 后端 provider；下一请求生效 */
  provider?: string
  /** 执行任务的模型；空串 = 跟随 dsh 用户/默认设置；下一请求生效 */
  model?: string
  /** 挂载的 agent preset；下一请求生效 */
  preset?: string
  /** 任务工作目录；空 = 进程 cwd；下一请求生效 */
  cwd?: string
  /** contextId→session 映射持久文件路径；重启后生效 */
  contextMapPath?: string
  /** 映射条目 TTL 天数（≥1 整数）；下一次落盘清理生效 */
  contextMapTtlDays?: number
}

/**
 * `a2a-server` 段 schema。全部字段可选；只有 provider/model/preset/
 * contextMapTtlDays 带 default；authToken 无 default 且 role('secret')，
 * 保证任何线上读路径都被结构性脱敏（`toJSON()` 不会带出明文）。
 */
export const A2ASettingsSchema: z<A2ASettings> = z.object({
  port: z.number().step(1).min(1).max(65535),
  host: z.string(),
  authToken: z.string().role('secret'),
  provider: z.string().default('deepseek-official'),
  model: z.string().default('deepseek-v4-flash'),
  preset: z.string().default('standard'),
  cwd: z.string(),
  contextMapPath: z.string(),
  contextMapTtlDays: z.number().step(1).min(1).default(7),
})

/**
 * 挂载 `a2a-server` settings 命名空间。安装时（`installSection` attach）会
 * 同步 apply 一次 resolved 值，之后每次 settings commit 都经 `applyResolved`
 * 重新生效；settings 服务缺失/分离时回落到 entry config。
 *
 * @param ctx - 插件 context（installSection 的 owner）
 * @param config - cordis entry config（作为 base 层与回落值）
 * @param applyResolved - 整份 resolved 值落到 runtimeConfig 的函数
 */
export function installA2ASettings(
  ctx: Context,
  config: A2ASettings,
  applyResolved: (resolved: A2ASettings) => void,
): void {
  let source = (): A2ASettings => config
  const onChange = (): void => {
    applyResolved(source())
  }

  // 可选依赖：没有 settings 服务的 profile 里回调不运行，插件照常用
  // entry config 工作（graceful degradation）。
  ctx.inject(['settings'], (settingsCtx) => {
    try {
      settingsCtx.settings.installSection(ctx, A2A_SETTINGS_NS, A2ASettingsSchema, config, {
        // 约束 schema 表达不了的规则：host 显式给出时不得为空串。
        // port 的 1–65535 整数约束已由 schema 表达，这里不再重复。
        validate: (value) => {
          if (value.host !== undefined && value.host.trim().length === 0) {
            throw new TypeError('[dsh-a2a-server] settings host must not be an empty string')
          }
        },
        setSource: (current) => {
          source = current
        },
        onChange,
      })
    } catch (e) {
      // 对 fails-loud 惯例的有意偏离（决策 C4）：installSection 在注册时就会
      // 解析 stored section，settings.yaml 里若已有坏段会在这里抛错；不接住
      // 的话 apply 抛 → 本 fiber FAILED → `dsh web` 整个起不来。宁可大声降级
      // 为「只用 cordis entry config」，保住 A2A 服务本身。
      console.warn(
        '[dsh-a2a-server] settings section registration failed; falling back to cordis entry config only:',
        (e as Error)?.message ?? e,
      )
    }
  })
}
