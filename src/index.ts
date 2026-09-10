// dsh-a2a-server plugin entry point.
//
// P-1 skeleton: reserve the plugin contract (name / inject / apply) so the
// bundle layer loads cleanly. The A2A server itself is implemented in P0.

import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-a2a-server'

export const inject: readonly string[] = []

export function apply(ctx: Context): void {
  // TODO(P0): start the A2A server and register its disposal through the
  // context (e.g. `ctx.on('dispose', () => server.close())`). P-1 ships no
  // logic, so `ctx` is unused until then.
  void ctx
}
