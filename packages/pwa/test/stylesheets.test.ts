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

  it('make the app the box that clips whatever it positions, so a long thread cannot stretch the page', () => {
    const rule = new Map(appRule())
    expect(rule.get('position')).toBe('relative')
    expect(rule.get('overflow')).toBe('clip')
  })
})

describe('the hierarchy rules in the stylesheets', () => {
  const SIZE =
    /var\(--hb-(?:text-(?:meta|body|lead|heading|page|page-compact|label|code|wordmark|wordmark-large)|control-text(?:-field)?)\)/
  const WEIGHT = /^var\(--hb-weight-(?:body|label|heading)\)$/
  const MONO_ALLOWED = ['code', 'pre', 'code-input', 'cloud-desk-prompt']

  it('size every text from the five-step scale', () => {
    expect(
      offenders(
        (declaration) =>
          !(declaration.property === 'font-size' || declaration.property === 'font') ||
          declaration.value === 'inherit' ||
          SIZE.test(declaration.value),
      ),
    ).toEqual([])
  })

  it('weigh every text as body, label or heading', () => {
    expect(
      offenders(
        (declaration) =>
          (declaration.property !== 'font-weight' || WEIGHT.test(declaration.value)) &&
          (declaration.property !== 'font' || !/^\d/.test(declaration.value)),
      ),
    ).toEqual([])
  })

  it('write no label in capitals: only a code a person types back keeps them', () => {
    expect(
      offenders(
        (declaration) => declaration.property !== 'text-transform' || declaration.value !== 'uppercase',
      ),
    ).toEqual(['components.css: text-transform: uppercase'])
  })

  it('keep the monospace font for code and commands', () => {
    const rules = COMPONENT_SHEETS.flatMap((sheet) =>
      [
        ...readFileSync(join(STYLES, sheet), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .matchAll(/([^{}]+)\{([^{}]*)\}/g),
      ]
        .filter((match) => match[2]!.includes('--hb-font-mono'))
        .map((match) => match[1]!.trim()),
    )
    expect(rules.length).toBeGreaterThan(0)
    for (const selector of rules)
      expect(MONO_ALLOWED.some((allowed) => selector.includes(allowed))).toBe(true)
  })

  it('set a page title well above its body text, and above a section heading', () => {
    const tokens = declaredIn(firstRootBlock())
    const rem = (name: string): number => Number.parseFloat(tokens.get(name)!)
    expect(rem('--hb-text-page') / rem('--hb-text-body')).toBeGreaterThanOrEqual(1.6)
    expect(rem('--hb-text-page')).toBeGreaterThan(rem('--hb-text-heading'))
    expect(rem('--hb-text-heading')).toBeGreaterThan(rem('--hb-text-lead'))
    expect(rem('--hb-text-lead')).toBeGreaterThan(rem('--hb-text-body'))
    expect(rem('--hb-text-body')).toBeGreaterThan(rem('--hb-text-meta'))
    expect(rem('--hb-space-8')).toBeGreaterThanOrEqual(3 * rem('--hb-space-2'))
  })

  it('keep orange for actions: neither a current tab nor a count is painted with it', () => {
    const sheet = readFileSync(join(STYLES, 'components.css'), 'utf8')
    for (const selector of ['.tab[aria-current="page"]', '.subtabs a[aria-current="page"]', '.count'])
      expect(ruleBody(sheet, selector)).not.toContain('--hb-color-action')
  })
})

const ruleBody = (sheet: string, selector: string): string => {
  const at = sheet.indexOf(`\n${selector} {`)
  if (at === -1) throw new Error(`${selector} is not styled`)
  return sheet.slice(at, sheet.indexOf('}', at))
}

const appRule = (): Array<[string, string]> => {
  const text = readFileSync(join(STYLES, 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const body = /(?:^|\n)#app\s*\{([^}]*)\}/.exec(text)![1]!
  return [...body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()])
}

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
  if (reference !== null) return resolve(tokens, reference[1]!)
  const mix = /^color-mix\(in srgb, var\((--hb-[\w-]+)\) (\d+)%, var\((--hb-[\w-]+)\)\)$/.exec(value)
  return mix === null
    ? value
    : mixed(resolve(tokens, mix[1]!), Number(mix[2]) / 100, resolve(tokens, mix[3]!))
}

const mixed = (first: string, share: number, second: string): string =>
  `#${[1, 3, 5]
    .map((at) =>
      Math.round(
        Number.parseInt(first.slice(at, at + 2), 16) * share +
          Number.parseInt(second.slice(at, at + 2), 16) * (1 - share),
      )
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

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
  ['on-badge', 'badge'],
  ['text', 'pending-wash'],
  ['muted', 'pending-wash'],
]

const BOUNDARY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['line', 'page'],
  ['line', 'surface'],
  ['line', 'sunken'],
  ['switch-off-edge', 'surface'],
  ['switch-off-edge', 'page'],
  ['switch-thumb-on', 'switch-on'],
  ['focus', 'page'],
  ['focus', 'surface'],
  ['focus', 'sunken'],
  ['focus', 'bubble-mine'],
  ['focus', 'pending-wash'],
  ['focus-on-titlebar', 'titlebar'],
  ['focus-on-pending', 'pending'],
  ['tour', 'page'],
  ['tour', 'surface'],
  ['tour', 'sunken'],
  ['tour-on-titlebar', 'titlebar'],
  ['current-on-titlebar', 'titlebar'],
  ['current', 'page'],
  ['current', 'surface'],
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
