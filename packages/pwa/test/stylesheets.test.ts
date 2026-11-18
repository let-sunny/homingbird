import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = join(import.meta.dirname, '..', 'src', 'styles')

const COMPONENT_SHEETS = readdirSync(STYLES).filter((name) => name.endsWith('.css') && name !== 'tokens.css')

interface Declaration {
  readonly sheet: string
  readonly property: string
  readonly value: string
}

const declarationsIn = (sheet: string): Declaration[] => {
  const text = readFileSync(join(STYLES, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...text.matchAll(/(?<![\w-])(-{0,2}[a-z][\w-]*)\s*:\s*([^;{}]+);/g)].map((match) => ({
    sheet,
    property: match[1]!,
    value: match[2]!.replace(/\s+/g, ' ').trim(),
  }))
}

const LITERAL_COLOR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(|\b(?:white|black)\b/i
const TOKEN_ONLY = /^(?:var\(--[\w-]+\)|none)$/
const LITERAL_DURATION = /(?<![\w-])\d*\.?\d+m?s\b/

const offenders = (accepts: (declaration: Declaration) => boolean): string[] =>
  COMPONENT_SHEETS.flatMap(declarationsIn)
    .filter((declaration) => !accepts(declaration))
    .map((declaration) => `${declaration.sheet}: ${declaration.property}: ${declaration.value}`)

describe('component stylesheets', () => {
  it('finds the stylesheets to check', () => {
    expect(COMPONENT_SHEETS).toEqual(expect.arrayContaining(['components.css', 'base.css', 'layout.css']))
  })

  it('write no colour outside tokens.css', () => {
    expect(offenders((declaration) => !LITERAL_COLOR.test(declaration.value))).toEqual([])
  })

  it('take every shadow from a token', () => {
    expect(
      offenders((declaration) => !/shadow$/.test(declaration.property) || TOKEN_ONLY.test(declaration.value)),
    ).toEqual([])
  })

  it('take every gradient and texture from a token', () => {
    expect(offenders((declaration) => !/gradient\(/.test(declaration.value))).toEqual([])
  })

  it('take every corner radius from a token', () => {
    expect(
      offenders(
        (declaration) => !/radius$/.test(declaration.property) || /^var\(--[\w-]+\)$/.test(declaration.value),
      ),
    ).toEqual([])
  })

  it('take every border width from a token', () => {
    expect(
      offenders(
        (declaration) =>
          !/^border(?:-(?:block|inline)(?:-(?:start|end))?|-(?:top|bottom|left|right))?(?:-width)?$/.test(
            declaration.property,
          ) || !/\d+(?:px|rem|em)/.test(declaration.value),
      ),
    ).toEqual([])
  })

  it('take every duration from a token', () => {
    expect(offenders((declaration) => !LITERAL_DURATION.test(declaration.value))).toEqual([])
  })

  it('leave no custom function behind that only a newer browser understands', () => {
    expect(offenders((declaration) => !/^--[\w-]+\(/.test(declaration.value))).toEqual([])
  })
})

const TOKENS = readFileSync(join(STYLES, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const declaredIn = (block: string): ReadonlyMap<string, string> =>
  new Map(
    [...block.matchAll(/(--hb-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1]!,
      match[2]!.replace(/\s+/g, ' ').trim(),
    ]),
  )

const firstRootBlock = (): string => /:root\s*\{([\s\S]*?)\n\}/.exec(TOKENS)![1]!

const schemeBlock = (): string => /@supports[^{]*\{\s*:root\s*\{([\s\S]*?)\}\s*\}/.exec(TOKENS)![1]!

const tokensFor = (scheme: 'light' | 'dark'): ReadonlyMap<string, string> => {
  const base = new Map(declaredIn(firstRootBlock()))
  for (const [name, value] of declaredIn(schemeBlock())) {
    const pair = /^light-dark\((.*)\)$/.exec(value)
    base.set(name, pair === null ? value : splitPair(pair[1]!)[scheme === 'light' ? 0 : 1]!)
  }
  return base
}

const splitPair = (inside: string): [string, string] => {
  let depth = 0
  for (let index = 0; index < inside.length; index++) {
    const character = inside[index]
    if (character === '(') depth++
    if (character === ')') depth--
    if (character === ',' && depth === 0)
      return [inside.slice(0, index).trim(), inside.slice(index + 1).trim()]
  }
  throw new Error(`not a pair: ${inside}`)
}

const resolve = (tokens: ReadonlyMap<string, string>, name: string): string => {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`${name} is not declared`)
  const reference = /^var\((--hb-[\w-]+)\)$/.exec(value)
  return reference === null ? value : resolve(tokens, reference[1]!)
}

const luminance = (hex: string): number => {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex)
  if (digits === null) throw new Error(`${hex} is not a six-digit colour`)
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(digits[1]!.slice(at, at + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['text', 'page'],
  ['text', 'surface'],
  ['text', 'sunken'],
  ['text', 'bubble-mine'],
  ['text', 'bubble-theirs'],
  ['muted', 'page'],
  ['muted', 'surface'],
  ['muted', 'sunken'],
  ['danger-text', 'page'],
  ['danger-text', 'surface'],
  ['on-action', 'action'],
  ['on-accent', 'accent'],
  ['on-titlebar', 'titlebar'],
  ['on-pending', 'pending'],
  ['on-success', 'success'],
  ['on-success', 'switch-on'],
]

const BOUNDARY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['line', 'page'],
  ['line', 'surface'],
  ['line', 'sunken'],
  ['switch-off-edge', 'surface'],
  ['switch-off-edge', 'page'],
  ['switch-thumb-on', 'switch-on'],
]

describe.each(['light', 'dark'] as const)('colour tokens in the %s scheme', (scheme) => {
  const tokens = tokensFor(scheme)
  const ratio = (front: string, back: string): number =>
    contrast(resolve(tokens, `--hb-color-${front}`), resolve(tokens, `--hb-color-${back}`))

  it.each(TEXT_PAIRS)('keep %s readable on %s (4.5:1)', (front, back) => {
    expect(ratio(front, back)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(BOUNDARY_PAIRS)('keep %s visible against %s (3:1)', (front, back) => {
    expect(ratio(front, back)).toBeGreaterThanOrEqual(3)
  })
})

describe('the token contrast check', () => {
  it('measures black on white as 21:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21)
  })

  it('refuses a colour it cannot measure', () => {
    expect(() => luminance('rebeccapurple')).toThrow('six-digit')
  })
})
