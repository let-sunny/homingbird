import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { featureOn } from '../features.ts'
import { type ConnectionModel, type CredentialRow, connectionModel } from '../models/connection.ts'
import { serviceBannerModel } from '../models/service-banner.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import { cloudDeskSection } from './cloud-desk.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { joinCodeSection } from './join-code.ts'
import { channelChips, field, loading, presenceBadges } from './parts.ts'
import { serviceBanner } from './service-banner.ts'
import { freshSessionSuggestions } from './session-health-view.ts'

/** "Connection": the person's devices and agents, whether the desk is awake, and how to connect one. */
export const connectionSection = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  const credentials = signal<ReadonlyArray<AsRead.Credential> | null>(null)
  const reload = (): void => {
    actions.loadAgents()
    actions.listCredentials({ done: (listed) => credentials.set(listed) })
  }
  reload()
  actions.loadKnownChannels()
  const model = (): ConnectionModel =>
    connectionModel({
      viewerId: me.member.id,
      directory: state.directory.get(),
      credentials: credentials.get(),
      channels: state.channels.get(),
      joinCodes: featureOn('joinCodes', state.serverInfo.get()),
    })
  return h(
    'div',
    { class: 'agent-connection' },
    region(life, [credentials], () =>
      serviceBanner(
        serviceBannerModel({
          credentials: credentials.get(),
          origin: context.page.origin,
          now: context.clock.now(),
          joinCodes: featureOn('joinCodes', state.serverInfo.get()),
        }),
      ),
    ),
    region(life, [state.directory], () => renderRecommendation(model())),
    featureOn('joinCodes', state.serverInfo.get()) && joinCodeSection(context, life, null),
    region(life, [state.agentReport], () => {
      const report = state.agentReport.get()
      return report === null || report === 'failed' ? null : freshSessionSuggestions(report.sessions.latest)
    }),
    region(life, [state.directory], () => renderDeskState(model())),
    h(
      'section',
      { class: 'connected-agents', 'aria-labelledby': 'connected-agents' },
      h('h3', { id: 'connected-agents' }, strings.credentialsTitle),
      h('p', { class: 'trust-footnote' }, strings.credentialsIntro),
      region(life, [credentials], () => renderCredentials(model(), context, reload)),
    ),
    h(
      'fieldset',
      { class: 'appearance my-channels' },
      h('legend', {}, strings.profileAgent),
      region(life, [state.channels, state.directory], () => renderHelped(model())),
      h('a', { class: 'button', href: hrefFor({ name: 'channels' }) }, strings.browseChannels),
    ),
    featureOn('cloudDesk', state.serverInfo.get()) && cloudDeskSection(context, life, credentials),
    h('details', { class: 'have-a-code' }, h('summary', {}, strings.codeFallback), codeForm(context)),
    h('p', { class: 'hint not-set-up' }, strings.notSetUp),
  )
}

/** The code a device sign-in shows, for an agent that printed one instead of a link. */
export const codeForm = (context: Pick<ViewContext, 'page'>): HTMLElement => {
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
          context.page.go(hrefFor({ name: 'device', code: code.value.trim() }))
        },
      },
    },
    h('p', {}, strings.deviceIntro),
    field(strings.deviceCodeLabel, code),
    h('button', { type: 'submit', class: 'primary' }, strings.deviceContinue),
  )
}

const renderCredentials = (model: ConnectionModel, context: ViewContext, reload: () => void): Child => {
  if (model.credentials === null) return loading()
  return [
    model.credentials.noAgents && h('p', { class: 'no-agents' }, strings.noAgentsYet),
    h(
      'ul',
      { class: 'credentials' },
      model.credentials.rows.map((row) => credentialRow(row, context, reload)),
    ),
  ]
}

const credentialRow = (row: CredentialRow, context: ViewContext, reload: () => void): HTMLElement =>
  h(
    'li',
    { class: `credential ${row.revoked ? 'is-revoked' : ''}`, data: { credentialId: row.credential.id } },
    h(
      'div',
      { class: 'credential-main' },
      h(
        'div',
        { class: 'credential-name' },
        h('strong', {}, row.credential.name),
        h('span', { class: `kind is-${row.credential.kind}` }, row.kind),
        row.marks.map((mark) =>
          mark.style === 'is-you'
            ? h('small', { class: 'is-you' }, mark.text)
            : h('span', { class: `kind ${mark.style}` }, mark.text),
        ),
      ),
      h('span', { class: 'credential-client' }, row.client),
      h(
        'dl',
        { class: 'facts' },
        row.facts.map((fact) => [h('dt', {}, fact.term), h('dd', {}, fact.value)]),
      ),
    ),
    !row.revoked &&
      h(
        'div',
        { class: 'credential-actions' },
        h(
          'button',
          {
            type: 'button',
            ...opensDialog(context, strings.renameTitle, () => renameForm(row.credential, context, reload)),
          },
          strings.rename,
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'danger',
            ...opensDialog(context, row.revokeTitle, () => revokeForm(row, context, reload)),
          },
          strings.revoke,
        ),
      ),
  )

const renameForm = (credential: AsRead.Credential, context: ViewContext, reload: () => void): Child => {
  const name = h('input', { name: 'name', required: true, maxlength: '200', value: credential.name })
  return h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.renameCredential(credential.id, name.value.trim(), {
            done: () => {
              closeDialog(context)
              reload()
            },
          })
        },
      },
    },
    field(strings.renameLabel, name),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      h('button', { type: 'submit', class: 'primary' }, strings.save),
    ),
  )
}

const revokeForm = (row: CredentialRow, context: ViewContext, reload: () => void): Child =>
  h(
    'div',
    { class: 'dialog-body' },
    h('p', {}, row.revokeBody),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      h(
        'button',
        {
          type: 'button',
          class: 'danger',
          on: {
            click: () =>
              context.actions.revokeCredential(row.credential.id, {
                done: () => {
                  closeDialog(context)
                  if (row.credential.current) context.page.assign('/')
                  else reload()
                },
              }),
          },
        },
        strings.revoke,
      ),
    ),
  )

const renderRecommendation = (model: ConnectionModel): HTMLElement | null =>
  model.recommendation === null
    ? null
    : h(
        'div',
        { class: 'desk-recommendation', role: 'note' },
        h('div', {}, h('strong', {}, model.recommendation.title), h('p', {}, model.recommendation.body)),
      )

const renderDeskState = (model: ConnectionModel): HTMLElement | null =>
  model.presence === null
    ? null
    : h(
        'div',
        { class: 'desk-state' },
        h('p', {}, presenceBadges(model.presence)),
        ...model.unavailable.map((line) => h('p', { class: 'hint', role: 'status' }, line)),
      )

const renderHelped = (model: ConnectionModel): HTMLElement =>
  model.helped.length === 0 ? h('p', {}, strings.noChannelsHelped) : channelChips(model.helped)
