// Bundles the server's persistence module against a stubbed @dcl/sdk/server, then
// runs the test suite. The bundle step is needed because the module is TypeScript
// and imports the SDK, which only resolves inside a running scene.

import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root    = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir  = resolve(root, 'test/.build')
const stub    = resolve(root, 'test/stub-sdk-server.mjs')
const entry   = resolve(outDir, 'entry.mjs')

await mkdir(outDir, { recursive: true })

// Re-export the stub's controls alongside the module under test, so a test can drive
// both. The alias makes persistence.ts and this entry share one stub instance.
await writeFile(entry, [
  `export * from ${JSON.stringify(resolve(root, 'src/server/persistence.ts'))}`,
  `export { calls, setHandler } from ${JSON.stringify(stub)}`,
  '',
].join('\n'))

await build({
  entryPoints: [entry],
  outfile: resolve(outDir, 'persistence.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
  alias: { '@dcl/sdk/server': stub },
})

// Name the files explicitly rather than handing the runner a directory, which it
// resolves as a module to execute instead of a suite to search.
const files = (await readdir(resolve(root, 'test')))
  .filter(f => f.endsWith('.test.mjs'))
  .map(f => `test/${f}`)

if (files.length === 0) {
  console.error('No test files found in test/')
  process.exit(1)
}

const child = spawn(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 1))
