import { Task as T } from '@homingbird/kernel'
import type { Credential, Me } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { api, launch, loadAgents, loadChannels, renameCredential, revokeCredential } from '../actions.ts'
import { hrefFor } from '../routes.ts'
import { agentReport, channels, directory } from '../state.ts'
import { strings } from '../strings.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, channelChips, dateTimeLabel, field, presenceBadges } from './parts.ts'
import { pip } from './pip.ts'
import { freshSessionSuggestions } from './session-health-view.ts'

/** "Connection": the person's devices and agents, whether the desk is awake, and how to connect one. */
export const connectionSection = (life: Lifetime, me: Me): HTMLElement => {
  const credentials = signal<ReadonlyArray<Credential> | null>(null)
  const reload = (): void => {
    launch(loadAgents)
    launch(
      T.map((listed: { credentials: ReadonlyArray<Credential> }) => credentials.set(listed.credentials))(
        api['credentials.list']({}),
      ),
    )
  }
  reload()
  return h(
    'div',
    { class: 'agent-connection' },
    deskRecommendation(),
    region(life, [agentReport], () => {
      const report = agentReport.get()
      return report === null || report === 'failed' ? null : freshSessionSuggestions(report.sessions.latest)
    }),
    region(life, [directory], () => {
      const presence = directory.get().find((entry) => entry.member.id === me.member.id)?.presence
      return presence === undefined ? null : h('p', { class: 'desk-state' }, presenceBadges(presence, true))
    }),
    h(
      'section',
      { class: 'connected-agents', 'aria-labelledby': 'connected-agents' },
      h('h3', { id: 'connected-agents' }, strings.credentialsTitle),
      h('p', { class: 'trust-footnote' }, strings.credentialsIntro),
      region(life, [credentials], () => {
        const listed = credentials.get()
        if (listed === null) return h('p', { class: 'loading' }, strings.loading)
        return [
          !listed.some((credential) => credential.kind === 'agent' && credential.revokedAt === null) &&
            h('p', { class: 'no-agents' }, strings.noAgentsYet),
          h(
            'ul',
            { class: 'credentials' },
            listed.map((credential) => credentialRow(credential, reload)),
          ),
        ]
      }),
    ),
    helpedChannels(life, me),
    h('details', { class: 'have-a-code' }, h('summary', {}, strings.codeFallback), codeForm()),
    h('p', { class: 'hint not-set-up' }, strings.notSetUp),
  )
}

/** The channels where the person's agent answers questions, as colleagues see them. */
export const helpedChannels = (life: Lifetime, me: Me): HTMLElement => {
  launch(loadChannels(''))
  return h(
    'fieldset',
    { class: 'appearance my-channels' },
    h('legend', {}, strings.profileAgent),
    region(life, [channels, directory], () => {
      const helped = channels.get().filter((channel) => channel.answering)
      const fromDirectory = directory.get().find((entry) => entry.member.id === me.member.id)?.channels ?? []
      const slugs = helped.length > 0 ? helped.map((channel) => channel.slug) : fromDirectory
      return slugs.length === 0 ? h('p', {}, strings.noChannelsHelped) : channelChips(slugs)
    }),
    h('a', { class: 'button', href: hrefFor({ name: 'channels' }) }, strings.browseChannels),
  )
}

export const deskRecommendation = (): HTMLElement =>
  h(
    'div',
    { class: 'desk-recommendation', role: 'note' },
    pip('sign-in', 3),
    h('div', {}, h('strong', {}, strings.deskTitle), h('p', {}, strings.deskBody)),
  )

/** The code a device sign-in shows, for an agent that printed one instead of a link. */
export const codeForm = (): HTMLElement => {
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
    h('p', {}, strings.deviceIntro),
    field(strings.deviceCodeLabel, code),
    h('button', { type: 'submit', class: 'primary' }, strings.deviceContinue),
  )
}

const credentialRow = (credential: Credential, reload: () => void): HTMLElement =>
  h(
    'li',
    {
      class: `credential ${credential.revokedAt === null ? '' : 'is-revoked'}`,
      data: { credentialId: credential.id },
    },
    h(
      'div',
      { class: 'credential-main' },
      h(
        'div',
        { class: 'credential-name' },
        h('strong', {}, credential.name),
        h('span', { class: `kind is-${credential.kind}` }, strings.credentialKind[credential.kind]),
        credential.current && h('span', { class: 'kind is-current' }, strings.credentialCurrent),
        credential.current && youMarkFor(strings.credentialThisBrowser),
        credential.revokedAt !== null && h('span', { class: 'kind is-revoked' }, strings.credentialRevoked),
      ),
      h('span', { class: 'credential-client' }, credential.client),
      h(
        'dl',
        { class: 'facts' },
        fact(strings.credentialLastUsed, dateTimeLabel(credential.lastUsedAt, strings.credentialNeverUsed)),
        fact(strings.credentialExpires, dateTimeLabel(credential.expiresAt, '')),
      ),
    ),
    credential.revokedAt === null &&
      h(
        'div',
        { class: 'credential-actions' },
        h(
          'button',
          { type: 'button', ...opensDialog(strings.renameTitle, () => renameForm(credential, reload)) },
          strings.rename,
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'danger',
            ...opensDialog(credential.current ? strings.revokeCurrentTitle : strings.revokeTitle, () =>
              revokeForm(credential, reload),
            ),
          },
          strings.revoke,
        ),
      ),
  )

const youMarkFor = (text: string): HTMLElement => h('small', { class: 'is-you' }, text)

const fact = (term: string, value: string): Child => [h('dt', {}, term), h('dd', {}, value)]

const renameForm = (credential: Credential, reload: () => void): Child => {
  const name = h('input', { name: 'name', required: true, maxlength: '200', value: credential.name })
  return h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(renameCredential(credential.id, name.value.trim()), () => {
            closeDialog()
            reload()
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

const revokeForm = (credential: Credential, reload: () => void): Child =>
  h(
    'div',
    { class: 'dialog-body' },
    h(
      'p',
      {},
      credential.current
        ? strings.revokeCurrentBody({ name: credential.name })
        : strings.revokeBody({ name: credential.name }),
    ),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      button(
        strings.revoke,
        () =>
          launch(revokeCredential(credential.id), () => {
            closeDialog()
            if (credential.current) location.assign('/')
            else reload()
          }),
        { class: 'danger' },
      ),
    ),
  )
