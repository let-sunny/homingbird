import type { ConsentRequest, DeviceRequest } from '@homingbird/protocol'
import { clientLabel } from '../client-labels.ts'
import { strings } from '../strings.ts'
import type { PipState } from '../views/pip.ts'

/** Where approving a device sign-in stands: asking for the code, loading it, deciding, or decided. */
export type DeviceStage =
  | { readonly step: 'ask' }
  | { readonly step: 'loading' }
  | { readonly step: 'decide'; readonly request: DeviceRequest }
  | { readonly step: 'done'; readonly approved: boolean }

export const deviceModel = (stage: DeviceStage): ConnectModel => {
  switch (stage.step) {
    case 'ask':
      return { kind: 'code' }
    case 'loading':
      return { kind: 'loading' }
    case 'done':
      return outcomeModel(stage.approved, stage.approved ? strings.deviceApproved : strings.deviceDenied)
    case 'decide':
      return {
        kind: 'decide',
        lines: [
          { text: strings.deviceAsks({ client: clientLabel(stage.request.client) }), style: 'ask' },
          { text: stage.request.userCode, style: 'code-shown' },
          { text: strings.deviceAgentGrant, style: null },
        ],
        nameLabel: strings.deviceNameLabel,
        name: stage.request.client,
      }
  }
}

/** Where approving an agent's sign-in by consent stands: loading, deciding, or decided. */
export const consentModel = (
  request: ConsentRequest | null,
  decided: { readonly approved: boolean } | null,
): ConnectModel => {
  if (decided !== null && request !== null)
    return outcomeModel(
      decided.approved,
      decided.approved
        ? strings.consentApproved({ host: request.redirectHost })
        : strings.consentDenied({ host: request.redirectHost }),
    )
  if (request === null) return { kind: 'loading' }
  return {
    kind: 'decide',
    lines: [
      { text: strings.consentAsks({ client: request.client }), style: 'ask' },
      { text: strings.deviceAgentGrant, style: null },
      { text: strings.consentReturnsTo({ host: request.redirectHost }), style: null },
    ],
    nameLabel: strings.consentNameLabel,
    name: request.client,
  }
}

/** The name to give the connection: what the person typed, else what the agent called itself. */
export const connectionName = (typed: string, client: string): string => typed.trim() || client

export type ConnectModel =
  | { readonly kind: 'code' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'decide'
      readonly lines: ReadonlyArray<{ readonly text: string; readonly style: 'ask' | 'code-shown' | null }>
      readonly nameLabel: string
      readonly name: string
    }
  | {
      readonly kind: 'outcome'
      readonly approved: boolean
      readonly pip: PipState
      readonly title: string
      readonly message: string
    }

const outcomeModel = (approved: boolean, message: string): ConnectModel => ({
  kind: 'outcome',
  approved,
  pip: approved ? 'approved' : 'discarded',
  title: approved ? strings.connectedTitle : strings.deniedTitle,
  message,
})
