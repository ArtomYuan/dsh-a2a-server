import { defineConfig } from 'tsdown'

// Consumer-side build for git installs (the `prepare` script): transpile
// straight from src/ without tsc project references or type checking. Git
// installs fetch sources, not built artifacts, so pnpm runs this after
// `dsh plugin add github:...`; it must stay self-contained (no sibling
// monorepo checkout). `tsconfig: false` stops tsdown auto-picking an ancestor
// tsconfig (e.g. the harness monorepo's) so the build depends only on this
// package. `pnpm run typecheck` (P0+) owns type checking.
// `src/compat.ts` 单独成 entry：版本探测/双形状适配是纯 stdlib 模块，
// 以 lib/compat.js 独立产物供 tests/ 直接单测，不必加载整个插件图。
// `src/client/mount-strategy.ts` 同理：客户端设置卡挂载策略的纯函数，单独成
// lib/client/mount-strategy.js 供 tests/mount-strategy.test.mjs 在无 DOM 的 node 里单测。
// `src/client/primitive-symbols.ts` 同理：跨版本宿主符号解析的纯函数（无 React/JSX），
// 单独成 lib/client/primitive-symbols.js 供 tests/primitive-symbols.test.mjs 单测。
export default defineConfig({
  entry: ['src/index.ts', 'src/compat.ts', 'src/client/mount-strategy.ts', 'src/client/primitive-symbols.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  tsconfig: false,
})
