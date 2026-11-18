import { Task as T } from '@homingbird/kernel'
import type { ConsentRequest, DeviceRequest } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { api, launch } from '../actions.ts'
import { hrefFor } from '../routes.ts'
import { branding } from '../state.ts'
import { strings } from '../strings.ts'
import { button, field, wordmark } from './parts.ts'
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
  return connectWindow(
    strings.deviceTitle,
    region(life, [stage], () => {
      const current = stage.get()
      if (current.step === 'ask') return codeForm()
      if (current.step === 'loading') return h('p', { class: 'loading' }, strings.loading)
      if (current.step === 'done') return outcome(current.approved, current.message)
      return deviceDecision(current.request, (approved) =>
        stage.set({
          step: 'done',
          approved,
          message: approved ? strings.deviceApproved : strings.deviceDenied,
        }),
      )
    }),
  )
}

export const consentView = (life: Lifetime, id: string): HTMLElement => {
  const request = signal<ConsentRequest | null>(null)
  const decided = signal<{ readonly approved: boolean; readonly message: string } | null>(null)
  launch(T.map((loaded: ConsentRequest) => request.set(loaded))(api['consent.get']({ params: { id } })))
  return connectWindow(
    strings.consentTitle,
    region(life, [request, decided], () => {
      const loaded = request.get()
      const outcomeOf = decided.get()
      if (outcomeOf !== null) return outcome(outcomeOf.approved, outcomeOf.message)
      return loaded === null
        ? h('p', { class: 'loading' }, strings.loading)
        : consentDecision(loaded, (approved) =>
            decided.set({
              approved,
              message: approved
                ? strings.consentApproved(loaded.redirectHost)
                : strings.consentDenied(loaded.redirectHost),
            }),
          )
    }),
  )
}

type DeviceStage =
  | { readonly step: 'ask' }
  | { readonly step: 'loading' }
  | { readonly step: 'decide'; readonly request: DeviceRequest }
  | { readonly step: 'done'; readonly approved: boolean; readonly message: string }

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

const deviceDecision = (request: DeviceRequest, finish: (approved: boolean) => void): HTMLElement => {
  const name = h('input', { name: 'name', required: true, maxlength: '200', value: request.client })
  const allowApproval = h('input', { type: 'checkbox', name: 'allowApproval' })
  const decide = (approve: boolean): void =>
    launch(
      api['device.decide']({
        params: { userCode: request.userCode },
        body: { approve, name: name.value.trim() || request.client, allowApproval: allowApproval.checked },
      }),
      () => finish(approve),
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

const outcome = (approved: boolean, message: string): HTMLElement =>
  h(
    'div',
    { class: `outcome ${approved ? 'is-approved' : 'is-denied'}`, role: 'status' },
    pip(approved ? 'approved' : 'discarded', 6),
    h('h1', {}, approved ? strings.connectedTitle : strings.deniedTitle),
    h('p', { class: 'outcome-message' }, message),
    h('a', { class: 'button', href: hrefFor({ name: 'home' }) }, strings.openHomingbird),
  )

const connectWindow = (title: string, content: Child): HTMLElement =>
  h(
    'div',
    { class: 'sign-in connect' },
    h(
      'div',
      { class: 'window connect-window' },
      h('div', { class: 'window-title' }, title),
      h(
        'div',
        { class: 'connect-body' },
        h(
          'p',
          { class: 'connect-brand' },
          h('img', {
            class: 'mark',
            src: branding.get().logo ?? '/icons/mark.svg',
            alt: '',
            width: '32',
            height: '32',
          }),
          h('span', { class: 'wordmark' }, wordmark(branding.get().name)),
        ),
        content,
      ),
    ),
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
