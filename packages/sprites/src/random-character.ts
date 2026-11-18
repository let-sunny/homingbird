import { hsl } from './color.ts'
import {
  type EditorState,
  SLOTS,
  type SlotId,
  composeCharacter,
  editorFromPreset,
  emptyEditor,
} from './editor.ts'
import { validateCharacter } from './rules.ts'

/**
 * A random character that passes every rule. The same seed always gives the same character, so callers
 * take the seed from the random service and can replay it. Colors grow from one body hue with darker and
 * lighter steps and one accent, so the result looks designed rather than noisy.
 */
export const randomCharacter = (seed: number): EditorState => {
  const next = seededRandom(seed)
  const pick = <A>(items: ReadonlyArray<A>): A => items[Math.floor(next() * items.length)]!
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const hue = Math.floor(next() * 360)
    const saturation = 28 + next() * 30
    const lightness = 45 + next() * 22
    const accentHue = next() < 0.5 ? (hue + 180 + (next() * 60 - 30) + 360) % 360 : 25 + next() * 20
    const beak =
      next() < 0.5 ? hsl(accentHue, 70, 62) : hsl(hue, saturation * 0.6, Math.min(lightness + 25, 90))
    const wing = hsl(hue, saturation, lightness - 14)
    const name = pick(NAMES)
    const parts = Object.fromEntries(
      SLOTS.map((slot) => [
        slot.id,
        next() < (PART_CHANCE[slot.id] ?? 0.5) ? pick(slot.options.slice(1)).id : 'none',
      ]),
    ) as Record<SlotId, string>
    const candidate: EditorState = {
      ...emptyEditor(),
      id: `my-${name.toLowerCase()}`,
      name,
      palette: {
        B: hsl(hue, saturation, lightness),
        D: wing,
        O: beak,
        F: next() < 0.5 ? wing : beak,
        K: '#1B2333',
      },
      marking: next() < 0.6 ? hsl(hue, saturation, lightness - 26) : hsl(accentHue, 45, lightness - 10),
      detail: next() < 0.5 ? '#2E2018' : hsl(accentHue, 60, 55),
      parts,
      feet: parts.under === 'none',
      eye: 'auto',
    }
    if (validateCharacter(composeCharacter(candidate)).length === 0) return candidate
  }
  return { ...editorFromPreset('owl')!, eye: 'auto' }
}

/** mulberry32: small, fast and good enough for picking art. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MAX_ATTEMPTS = 60
const PART_CHANCE: Partial<Record<SlotId, number>> = { under: 0.15, spikes: 0.25 }
const NAMES = [
  'Pebble',
  'Mochi',
  'Biscuit',
  'Nori',
  'Clover',
  'Juniper',
  'Toast',
  'Maple',
  'Sprout',
  'Button',
  'Pickle',
  'Waffle',
  'Hazel',
  'Dumpling',
  'Fig',
  'Bean',
  'Sunny',
  'Truffle',
  'Ziggy',
  'Olive',
  'Pudding',
  'Comet',
]
