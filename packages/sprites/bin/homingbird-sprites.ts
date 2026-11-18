#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { runCli } from '../src/cli.ts'
import { buildAssets, encodePng, gifOf } from '../src/node/index.ts'

process.exitCode = runCli(process.argv.slice(2), {
  readText: (path) => readFileSync(path === '-' ? 0 : path, 'utf8'),
  writeFile: (path, data) => writeFileSync(path, data),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  buildAssets,
  encodePng,
  encodeGif: (frames, palette) => gifOf(frames, 8, palette),
})
