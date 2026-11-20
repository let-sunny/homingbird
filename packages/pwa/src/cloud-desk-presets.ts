/**
 * Setup helpers for a cloud desk, as data: each fills in an address format and headers to complete.
 * The server knows nothing of them; it calls the address the person saves.
 */
export const CLOUD_DESK_PRESETS = [
  {
    id: 'routine',
    urlPlaceholder: 'https://api.anthropic.com/v1/claude_code/routines/trig_…/fire',
    headers: [
      { name: 'Authorization', value: '', placeholder: 'Bearer sk-ant-oat01-…' },
      { name: 'anthropic-version', value: '2023-06-01', placeholder: '' },
      { name: 'anthropic-beta', value: 'experimental-cc-routine-2026-04-01', placeholder: '' },
    ],
  },
  {
    id: 'generic',
    urlPlaceholder: 'https://',
    headers: [{ name: 'Authorization', value: '', placeholder: 'Bearer …' }],
  },
] as const satisfies ReadonlyArray<CloudDeskPreset>

export type CloudDeskPresetId = (typeof CLOUD_DESK_PRESETS)[number]['id']

export interface CloudDeskPreset {
  readonly id: string
  readonly urlPlaceholder: string
  readonly headers: ReadonlyArray<{
    readonly name: string
    readonly value: string
    readonly placeholder: string
  }>
}
