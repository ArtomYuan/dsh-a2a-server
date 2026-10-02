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
    // A3：注册路径按 settings 服务的实际 seam 特性探测分三支。
    //  - installSection（0.1.5 现状）：走原路径，行为不变；
    //  - register（若未来版本只留 provider 级 register）：用 register + watch
    //    复刻 installSection 的同等语义（保守实现，见该分支注释）；
    //  - 两者皆无（0.2.0 现状：installSection/register/SettingsScope 全不存在）：
    //    响亮 warn 一行，面板不可用但 A2A 服务其余功能照常。
    // typeof 检查用加宽视图（seam）；实际 installSection 调用保留 settings 的
    // 0.1.x 类型以获得 hooks 的上下文类型。0.2.0 上没有这些方法，加宽视图安全。
    const settings = settingsCtx.settings
    const seam = settings as unknown as {
      installSection?: (...args: unknown[]) => unknown
      register?: (...args: unknown[]) => unknown
    }
    try {
      if (typeof seam.installSection === 'function') {
        settings.installSection(ctx, A2A_SETTINGS_NS, A2ASettingsSchema, config, {
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
      } else if (typeof seam.register === 'function') {
        // 保守回退：若 settings 服务只提供 provider 级 register(ns, schema, options)
        // 而无 installSection 消费方语义，用「register + scope.watch」复刻同等语义
        // —— options.base = cordis entry config（composition 层），scope.get() 同步
        // apply 一次 resolved 值（对齐 installSection attach 时的首次 apply），
        // scope.watch 在每次 commit 后重新 apply。已知差异：installSection 的
        // setSource 在 provider 分离时会回落 entry config，register 无此钩子，
        // provider 分离后本插件将停留在最后一次 resolved 值（可接受）。
        // 注：无任何已发布 dsh 版本命中本分支（0.1.5 有 installSection；
        // 0.2.0 两者皆无），契约与 0.1.5 SettingsProvider.register 对齐；
        // 若未来命中且契约不同，注册失败会落入下方 catch 响亮降级，A2A 服务不受影响。
        const scope = seam.register(A2A_SETTINGS_NS, A2ASettingsSchema, {
          base: config,
          validate: (value: A2ASettings) => {
            if (value.host !== undefined && value.host.trim().length === 0) {
              throw new TypeError('[dsh-a2a-server] settings host must not be an empty string')
            }
          },
        }) as {
          get?: () => A2ASettings
          watch?: (cb: (next: A2ASettings) => void | Promise<void>) => () => void
        } | undefined
        if (typeof scope?.watch !== 'function') {
          throw new TypeError('settings.register() returned no watch()-capable scope')
        }
        try {
          const initial = scope.get?.()
          if (initial !== undefined) applyResolved(initial)
        } catch {
          /* 初始 resolved 读取失败不阻断注册（watch 后续仍会 apply） */
        }
        scope.watch((next) => {
          applyResolved(next)
        })
      } else {
        // 0.2.0 现状：无任何注册缝，面板注册不可行。响亮告警点名原因与后续，
        // 插件其余功能（A2A 服务）照常；0.2.0 上改配置回落到 cordis.patch.yml /
        // settings.yaml + 重启，完整移植方案见迁移报告 §A3（Config-as-thunks）。
        console.warn(
          '[dsh-a2a-server] dsh 0.2.0 ships no settings-registration seam (installSection/register absent): ' +
            'the Plugin configuration panel is unavailable on this runtime; see REPORT §A3 for the Config-as-thunks port',
        )
      }
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
