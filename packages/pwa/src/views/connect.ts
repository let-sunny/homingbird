import { Task as T } from '@homingbird/kernel'
import type { ApiError, ConsentRequest, Credential, DeviceRequest } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { api, launch, loadAgents } from '../actions.ts'
import { hrefFor } from '../routes.ts'
import { agentCredentials, branding } from '../state.ts'
import { strings } from '../strings.ts'
import { codeForm } from './connection.ts'
import { button, dateTimeLabel, field, page, wordmark } from './parts.ts'
import { pip } from './pip.ts'

export const deviceView = (life: Lifetime, code: string | null): HTMLElement => {
  const stage = signal<DeviceStage>({ step: code === null ? 'ask' : 'loading' })
  const lookUp = (userCode: string): void =>
    launch(
      T.tapError((_: ApiError) => T.sync(() => stage.set({ step: 'ask' })))(
        T.map((request: DeviceRequest) => stage.set({ step: 'decide', request }))(
          api['device.get']({ params: { userCode } }),
        ),
      ),
      undefined,
      'device',
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
    true,
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
                ? strings.consentApproved({ host: loaded.redirectHost })
                : strings.consentDenied({ host: loaded.redirectHost }),
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

const deviceDecision = (request: DeviceRequest, finish: (approved: boolean) => void): HTMLElement => {
  const name = h('input', { name: 'name', required: true, maxlength: '200', value: request.client })
  const decide = (approve: boolean): void =>
    launch(
      api['device.decide']({
        params: { userCode: request.userCode },
        body: { approve, name: name.value.trim() || request.client },
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
    h('p', { class: 'ask' }, strings.deviceAsks({ client: request.client })),
    h('p', { class: 'code-shown' }, request.userCode),
    h('p', {}, strings.deviceAgentGrant),
    field(strings.deviceNameLabel, name),
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
  )

const connectWindow = (title: string, content: Child, backToConnect = false): HTMLElement =>
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
        h(
          'p',
          { class: 'back-links' },
          backToConnect &&
            h(
              'a',
              { class: 'back-to-connect', href: hrefFor({ name: 'agent', section: 'connection' }) },
              strings.backToConnect,
            ),
          h('a', { class: 'back-to-app', href: hrefFor({ name: 'home' }) }, strings.backToHomingbird),
        ),
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
    h('p', { class: 'ask' }, strings.consentAsks({ client: request.client })),
    h('p', {}, strings.deviceAgentGrant),
    h('p', {}, strings.consentReturnsTo({ host: request.redirectHost })),
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
