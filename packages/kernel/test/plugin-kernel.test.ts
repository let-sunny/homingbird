import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import * as Stream from '../src/stream.ts'
import * as T from '../src/task.ts'

// The Claude Code plugin may import only its own files, so it carries the kernel's Task and Stream as one
// generated module. Run with HB_WRITE_PLUGIN_BUNDLES=1 to write it again after changing the kernel.
const MODULE = new URL('../../plugin/hooks/kernel.mjs', import.meta.url).pathname

const HEADER = '// Generated from packages/kernel by its plugin-kernel test. Do not edit.\n'

const kernelModule = async (): Promise<string> => {
  const built = await build({
    stdin: {
      contents: [
        "export * as T from './src/task.ts'",
        "export * as Stream from './src/stream.ts'",
        "export { makeDeferred } from './src/concurrent.ts'",
      ].join('\n'),
      resolveDir: new URL('..', import.meta.url).pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    write: false,
  })
  return `${HEADER}${built.outputFiles[0]!.text}`
}

// Under mutation testing the sources are instrumented, so only the behaviour can be compared.
const INSTRUMENTED = readFileSync(new URL('../src/task.ts', import.meta.url), 'utf8').includes('@ts-nocheck')

describe('the kernel the plugin carries', () => {
  it.skipIf(INSTRUMENTED)('is exactly the kernel’s Task and Stream, bundled', async () => {
    const fresh = await kernelModule()
    if (process.env.HB_WRITE_PLUGIN_BUNDLES === '1') await writeFile(MODULE, fresh)
    expect(await readFile(MODULE, 'utf8')).toBe(fresh)
    expect(fresh).not.toContain('import(')
  })

  it('declares only what it exports', async () => {
    const bundled = await import(MODULE)
    const declared = await readFile(new URL('../../plugin/hooks/kernel.d.mts', import.meta.url), 'utf8')
    const names = (block: string) =>
      [
        ...(new RegExp(`namespace ${block} \\{([\\s\\S]*?)\\n\\}`).exec(declared)?.[1] ?? '').matchAll(
          /^ {2}const (\w+):/gm,
        ),
      ].map((match) => match[1]!)
    expect(names('T').length).toBeGreaterThan(10)
    for (const name of names('T')) expect(bundled.T).toHaveProperty(name)
    for (const name of names('Stream')) expect(bundled.Stream).toHaveProperty(name)
    expect(bundled.makeDeferred).toBeTypeOf('function')
  })

  it('runs a task and a stream as the kernel does', async () => {
    const bundled = await import(MODULE)
    const task = (kernel: typeof T) =>
      kernel.gen(function* () {
        const one = yield* kernel.succeed(1)
        return one + (yield* kernel.promise(() => Promise.resolve(2)))
      })
    expect(await bundled.T.runPromise(task(bundled.T))).toBe(await T.runPromise(task(T)))
    const seen: number[] = []
    await bundled.T.runPromise(
      bundled.Stream.forEach((n: number) => bundled.T.sync(() => seen.push(n)))(Stream.of(1, 2)),
    )
    expect(seen).toEqual([1, 2])
    const deferred = bundled.makeDeferred()
    deferred.resolve('x')
    expect(await bundled.T.runPromise(deferred.wait)).toBe('x')
  })
})
