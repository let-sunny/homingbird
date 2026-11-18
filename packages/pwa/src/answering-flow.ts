import { ANSWERING_FLOW_MAX_CHARACTERS } from '@homingbird/protocol'

export const flowToSave = (typed: string): string | null => {
  const trimmed = typed.trim()
  return trimmed === '' ? null : trimmed
}

export const flowLength = (
  typed: string,
): { readonly used: number; readonly max: number; readonly over: boolean } => ({
  used: typed.length,
  max: ANSWERING_FLOW_MAX_CHARACTERS,
  over: typed.length > ANSWERING_FLOW_MAX_CHARACTERS,
})

export const mayInsertExample = (typed: string): boolean => typed.trim() === ''
