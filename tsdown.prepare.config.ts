import { defineConfig } from 'tsdown'

// Consumer-side build for git installs (the `prepare` script): transpile
// straight from src/ without tsc project references or type checking. Git
// installs fetch sources, not built artifacts, so pnpm runs this after
// `dsh plugin add github:...`; it must stay self-contained (no sibling
// monorepo checkout). `tsconfig: false` stops tsdown auto-picking an ancestor
// tsconfig (e.g. the harness monorepo's) so the build depends only on this
// package. `pnpm run typecheck` (P0+) owns type checking.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  tsconfig: false,
})
