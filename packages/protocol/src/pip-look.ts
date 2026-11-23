import { COLORS, CharacterSpec, type PaletteKey } from '@homingbird/sprites'

/** Whether a character looks exactly like Pip, the brand: Pip's colors and no markings, whatever its id or name. */
export const isPipLook = (input: unknown): boolean => {
  const decoded = CharacterSpec.decode(input)
  if (decoded._tag !== 'Ok') return false
  const { palette, marks, noFeet } = decoded.value
  return marks.length === 0 && noFeet !== true && PALETTE_KEYS.every((key) => hasPipColor(palette, key))
}

const hasPipColor = (palette: CharacterSpec['palette'], key: PaletteKey): boolean =>
  (palette[key] ?? COLORS[key]).toUpperCase() === COLORS[key]

const PALETTE_KEYS: ReadonlyArray<PaletteKey> = ['B', 'D', 'O', 'F', 'K']
