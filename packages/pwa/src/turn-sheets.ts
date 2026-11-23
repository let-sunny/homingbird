import type { CharacterSpec } from '@homingbird/protocol'
import { birdTurnSheet } from '@homingbird/sprites'
import type { Page } from './browser-page.ts'

/**
 * The address of a character's 16-direction turn sheet, drawn in this browser from the shared slices and
 * the character's colors and markings. Drawing takes tens of milliseconds, so each look is drawn once.
 */
export const turnSheetUrl = (spec: CharacterSpec, page: Pick<Page, 'pngUrlOf'>): string => {
  const key = JSON.stringify([Object.entries(spec.palette).sort(), spec.marks, spec.noFeet === true])
  const cached = SHEETS.get(key)
  if (cached !== undefined) return cached
  const url = page.pngUrlOf(birdTurnSheet(spec))
  if (SHEETS.size >= SHEETS_CACHED) SHEETS.delete(SHEETS.keys().next().value!)
  SHEETS.set(key, url)
  return url
}

const SHEETS = new Map<string, string>()

const SHEETS_CACHED = 32
