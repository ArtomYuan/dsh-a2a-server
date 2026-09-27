/**
 * dsh-a2a-server 设置卡片的浏览器半边：注册双语文案，并把 A2A 卡片挂进
 * `settings.plugin.item` 槽（key = settings 命名空间 `a2a-server`，与 host
 * 半边注册的名字配对）。
 *
 * settingsScope 用嵌套 inject：不把它写进模块级 inject，让缺少该服务的
 * 老 host 上整个插件仍能挂载，只是不出现卡片。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 类型声明合并：ctx.locale（LocaleRuntime + register/bind）
import type {} from '@deepseek-ai/dsh-client-locale/client'
// 类型声明合并：ctx.settingsScope（SettingsScopeBinder）
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// 类型声明合并：settings.plugin.item 槽声明（slot-contract）
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// 类型声明合并：ctx.slots（SlotRegistry）
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { A2ASettingsCard } from './A2ASettingsCard.tsx'
import { A2A_SETTINGS_NS, A2ASettingsCardController } from './card-controller.ts'
import { en, zh } from './locales.ts'

/** Cordis 插件名 */
export const name = 'dsh-a2a-server'

/** 依赖的服务（settingsScope 走嵌套 inject，见模块注释） */
export const inject = ['slots', 'locale']

/** 文案命名空间（双字典键集一致，见 locales.ts） */
const NS = 'settings.a2aServer'

/**
 * 挂载设置卡片：注册字典 + 在 settingsScope 就绪后注册
 * `settings.plugin.item` 槽下的 `a2a-server` 条目。
 * @param ctx - 浏览器插件 context
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-a2a-server: card dictionaries')

  ctx.inject(['settingsScope'], (scoped) => {
    const controller = new A2ASettingsCardController(
      scoped.settingsScope.bind({ namespace: A2A_SETTINGS_NS }),
      scoped.settingsScope.describe(),
      scoped,
    )
    scoped.slots.inject('settings.plugin.item', () => scoped.slots.register({
      name: 'settings.plugin.item',
      key: A2A_SETTINGS_NS,
      locale: NS,
      inject: () => controller.inject(),
    }, A2ASettingsCard))
  })
}
