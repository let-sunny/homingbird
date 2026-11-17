import { Task as T } from '@homingbird/kernel'
import type { ConsentRequest, DeviceRequest } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { api, launch } from '../actions.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { button, field, page } from './parts.ts'
import { pip } from './pip.ts'

export const deviceView = (life: Lifetime, code: string | null): HTMLElement => {
  const stage = signal<DeviceStage>({ step: code === null ? 'ask' : 'loading' })
  const lookUp = (userCode: string): void =>
    launch(
      T.map((request: DeviceRequest) => stage.set({ step: 'decide', request }))(
        api['device.get']({ params: { userCode } }),
      ),
    )
  if (code !== null) lookUp(code)
  return page(
    strings.deviceTitle,
    region(life, [stage], () => {
      const current = stage.get()
      if (current.step === 'ask') return codeForm()
      if (current.step === 'loading') return h('p', { class: 'loading' }, strings.loading)
      if (current.step === 'done') return outcome(current.message)
      return deviceDecision(current.request, (message) => stage.set({ step: 'done', message }))
    }),
  )
}

export const consentView = (life: Lifetime, id: string): HTMLElement => {
  const request = signal<ConsentRequest | null>(null)
  const decided = signal<string | null>(null)
  launch(T.map((loaded: ConsentRequest) => request.set(loaded))(api['consent.get']({ params: { id } })))
  return page(
    strings.consentTitle,
    region(life, [request, decided], () => {
      const loaded = request.get()
      const message = decided.get()
      if (message !== null) return outcome(message)
      return loaded === null
        ? h('p', { class: 'loading' }, strings.loading)
        : consentDecision(loaded, (approved) =>
            decided.set(
              approved
                ? strings.consentApproved(loaded.redirectHost)
                : strings.consentDenied(loaded.redirectHost),
            ),
          )
    }),
  )
}

type DeviceStage =
  | { readonly step: 'ask' }
  | { readonly step: 'loading' }
  | { readonly step: 'decide'; readonly request: DeviceRequest }
  | { readonly step: 'done'; readonly message: string }

const codeForm = (): HTMLElement => {
  const code = h('input', {
    name: 'code',
    required: true,
    autocomplete: 'off',
    autocapitalize: 'characters',
    placeholder: strings.deviceCodePlaceholder,
    class: 'code-input',
  })
  return h(
    'form',
    {
      class: 'form',
      on: {
        submit: (event) => {
          event.preventDefault()
          location.hash = hrefFor({ name: 'device', code: code.value.trim() })
        },
      },
    },
    pip('sign-in', 4),
    h('p', {}, strings.deviceIntro),
    field(strings.deviceCodeLabel, code),
    h('button', { type: 'submit', class: 'primary' }, strings.deviceContinue),
  )
}

const deviceDecision = (request: DeviceRequest, finish: (message: string) => void): HTMLElement => {
  const name = h('input', { name: 'name', required: true, maxlength: '200', value: request.client })
  const allowApproval = h('input', { type: 'checkbox', name: 'allowApproval' })
  const decide = (approve: boolean): void =>
    launch(
      api['device.decide']({
        params: { userCode: request.userCode },
        body: { approve, name: name.value.trim() || request.client, allowApproval: allowApproval.checked },
      }),
      () => finish(approve ? strings.deviceApproved : strings.deviceDenied),
    )
  return h(
    'form',
    {
      class: 'form',
      on: {
        submit: (event) => {
          event.preventDefault()
          decide(true)
        },
      },
    },
    pip('sign-in', 4),
    h('p', { class: 'ask' }, strings.deviceAsks(request.client)),
    h('p', { class: 'code-shown' }, request.userCode),
    h('p', {}, strings.deviceAgentGrant),
    field(strings.deviceNameLabel, name),
    request.wantsApproval &&
      h(
        'label',
        { class: 'choice grant' },
        allowApproval,
        h('span', {}, strings.deviceApprovalLabel, h('small', {}, strings.deviceApprovalHint)),
      ),
    decisionButtons(() => decide(false)),
  )
}

const RETURN_DELAY_MS = 1500

const outcome = (message: string): HTMLElement =>
  h(
    'div',
    { class: 'outcome', role: 'status' },
    pip(message === strings.deviceDenied ? 'discarded' : 'approved', 4),
    h('p', { class: 'banner' }, message),
    h('a', { class: 'button primary', href: hrefFor({ name: 'home' }) }, strings.openHomingbird),
  )

const consentDecision = (request: ConsentRequest, finish: (approved: boolean) => void): HTMLElement => {
  const name = h('input', { name: 'name', required: true, maxlength: '200', value: request.client })
  const decide = (approve: boolean): void =>
    launch(
      T.map((decided: { redirectTo: string }) => {
        finish(approve)
        setTimeout(() => location.assign(decided.redirectTo), RETURN_DELAY_MS)
      })(
        api['consent.decide']({
          params: { id: request.id },
          body: { approve, name: name.value.trim() || request.client },
        }),
      ),
    )
  return h(
    'form',
    {
      class: 'form',
      on: {
        submit: (event) => {
          event.preventDefault()
          decide(true)
        },
      },
    },
    pip('sign-in', 4),
    h('p', { class: 'ask' }, strings.consentAsks(request.client)),
    h('p', {}, strings.deviceAgentGrant),
    h('p', {}, strings.consentReturnsTo(request.redirectHost)),
    field(strings.consentNameLabel, name),
    decisionButtons(() => decide(false)),
  )
}

const decisionButtons = (deny: () => void): Child =>
  h(
    'div',
    { class: 'form-actions' },
    button(strings.deny, deny),
    h('button', { type: 'submit', class: 'primary' }, strings.approve),
  )
