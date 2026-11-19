import type { ConsentRequest } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { logoOf, wordmark } from '../models/branding.ts'
import {
  type ConnectModel,
  type DeviceStage,
  connectionName,
  consentModel,
  deviceModel,
} from '../models/connect.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { codeForm } from './connection.ts'
import type { ViewContext } from './context.ts'
import { button, field, loading } from './parts.ts'
import { pip } from './pip.ts'

/** Approving a device sign-in: the code, then what the device asks for, then the outcome. */
export const deviceView = (context: ViewContext, life: Lifetime, code: string | null): HTMLElement => {
  const { actions } = context
  const stage = signal<DeviceStage>({ step: code === null ? 'ask' : 'loading' })
  if (code !== null)
    actions.lookUpDevice(code, {
      done: (request) => stage.set({ step: 'decide', request }),
      failed: () => stage.set({ step: 'ask' }),
      attempt: 'device',
    })
  const decide = (approve: boolean, typed: string): void => {
    const current = stage.get()
    if (current.step !== 'decide') return
    actions.decideDevice(current.request.userCode, approve, connectionName(typed, current.request.client), {
      done: () => stage.set({ step: 'done', approved: approve }),
    })
  }
  return connectWindow(
    context,
    strings.deviceTitle,
    region(life, [stage], () => renderConnect(deviceModel(stage.get()), context, decide)),
    true,
  )
}

/** Approving an agent's sign-in by consent: what it asks for, then the outcome, then back to the agent. */
export const consentView = (context: ViewContext, life: Lifetime, id: string): HTMLElement => {
  const { actions } = context
  const request = signal<ConsentRequest | null>(null)
  const decided = signal<{ readonly approved: boolean } | null>(null)
  actions.lookUpConsent(id, { done: (loaded) => request.set(loaded) })
  const decide = (approve: boolean, typed: string): void => {
    const loaded = request.get()
    if (loaded === null) return
    actions.decideConsent(loaded.id, approve, connectionName(typed, loaded.client), {
      done: (answer) => {
        decided.set({ approved: approve })
        actions.returnAfterAMoment(answer.redirectTo)
      },
    })
  }
  return connectWindow(
    context,
    strings.consentTitle,
    region(life, [request, decided], () =>
      renderConnect(consentModel(request.get(), decided.get()), context, decide),
    ),
  )
}

const renderConnect = (
  model: ConnectModel,
  context: ViewContext,
  decide: (approve: boolean, name: string) => void,
): HTMLElement => {
  switch (model.kind) {
    case 'code':
      return codeForm(context)
    case 'loading':
      return loading()
    case 'outcome':
      return h(
        'div',
        { class: `outcome ${model.approved ? 'is-approved' : 'is-denied'}`, role: 'status' },
        pip(model.pip, 4),
        h('h1', {}, model.title),
        h('p', { class: 'outcome-message' }, model.message),
      )
    case 'decide': {
      const name = h('input', { name: 'name', required: true, maxlength: '200', value: model.name })
      return h(
        'form',
        {
          class: 'form',
          on: {
            submit: (event) => {
              event.preventDefault()
              decide(true, name.value)
            },
          },
        },
        model.lines.map((line) => h('p', line.style === null ? {} : { class: line.style }, line.text)),
        field(model.nameLabel, name),
        h(
          'div',
          { class: 'form-actions' },
          button(strings.deny, () => decide(false, name.value)),
          h('button', { type: 'submit', class: 'primary' }, strings.approve),
        ),
      )
    }
  }
}

const connectWindow = (
  context: ViewContext,
  title: string,
  content: Child,
  backToConnect = false,
): HTMLElement => {
  const branding = context.state.branding.get()
  return h(
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
          h('img', { class: 'mark', src: logoOf(branding.logo), alt: '', width: '32', height: '32' }),
          h('span', { class: 'wordmark' }, wordmark(branding.name)),
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
}
