import { Task as T } from '@homingbird/kernel'
import type { Credential, Me } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { api, launch, renameCredential, revokeCredential, updateProfile } from '../actions.ts'
import { APPEARANCES, type Appearance, applyAppearance, currentAppearance } from '../appearance.ts'
import { pushIsAvailable, pushIsOn, turnPushOff, turnPushOn } from '../push.ts'
import { notice } from '../state.ts'
import { strings } from '../strings.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, dateTimeLabel, field, page } from './parts.ts'

export const profileView = (life: Lifetime, me: Me): HTMLElement => {
  const name = h('input', { name: 'name', required: true, maxlength: '200', value: me.member.name })
  const profile = h('textarea', { name: 'profile', rows: '3', maxlength: '500' })
  profile.value = me.member.profile
  return page(
    strings.profileTitle,
    h(
      'form',
      {
        class: 'form',
        on: {
          submit: (event) => {
            event.preventDefault()
            launch(updateProfile(name.value.trim(), profile.value.trim()), () =>
              notice.set({ kind: 'info', text: strings.saved }),
            )
          },
        },
      },
      h('p', { class: 'form-who' }, me.member.email),
      field(strings.profileName, name),
      field(strings.profileAgent, profile, strings.profileAgentHint),
      h('button', { type: 'submit', class: 'primary' }, strings.save),
    ),
    h(
      'fieldset',
      { class: 'appearance' },
      h('legend', {}, strings.appearance),
      APPEARANCES.map((appearance) =>
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'radio',
            name: 'appearance',
            value: appearance,
            checked: currentAppearance() === appearance,
            on: { change: () => applyAppearance(appearance) },
          }),
          APPEARANCE_LABELS[appearance],
        ),
      ),
    ),
    notificationsToggle(life),
  )
}

const notificationsToggle = (life: Lifetime): HTMLElement => {
  const isOn = signal(false)
  if (!pushIsAvailable())
    return h('fieldset', { class: 'appearance' }, h('legend', {}, strings.notifications), h('p', {}, strings.notificationsUnavailable))
  launch(T.map((on: boolean) => isOn.set(on))(pushIsOn))
  const toggle = (wanted: boolean): void =>
    launch(
      T.map((on: boolean) => {
        isOn.set(on)
        for (const box of document.querySelectorAll<HTMLInputElement>('input[name=notifications]')) box.checked = on
        if (wanted && !on) notice.set({ kind: 'error', text: strings.notificationsRefused })
      })(wanted ? turnPushOn : turnPushOff),
    )
  return h(
    'fieldset',
    { class: 'appearance' },
    h('legend', {}, strings.notifications),
    region(life, [isOn], () => {
      const box = h('input', { type: 'checkbox', name: 'notifications', checked: isOn.get() })
      box.addEventListener('change', () => toggle(box.checked))
      return h('label', { class: 'choice' }, box, h('span', {}, strings.notificationsToggle, h('small', {}, strings.notificationsHint)))
    }),
  )
}

export const credentialsView = (life: Lifetime): HTMLElement => {
  const credentials = signal<ReadonlyArray<Credential> | null>(null)
  const reload = (): void =>
    launch(T.map((listed: { credentials: ReadonlyArray<Credential> }) => credentials.set(listed.credentials))(api['credentials.list']({})))
  reload()
  return page(
    strings.credentialsTitle,
    h('p', {}, strings.credentialsIntro),
    h('a', { class: 'button', href: '#/device' }, strings.menuConnectDevice),
    region(life, [credentials], () => {
      const listed = credentials.get()
      return listed === null
        ? h('p', { class: 'loading' }, strings.loading)
        : h('ul', { class: 'credentials' }, listed.map((credential) => credentialRow(credential, reload)))
    }),
  )
}

const APPEARANCE_LABELS: Readonly<Record<Appearance, string>> = {
  auto: strings.appearanceAuto,
  light: strings.appearanceLight,
  dark: strings.appearanceDark,
}

const credentialRow = (credential: Credential, reload: () => void): HTMLElement =>
  h(
    'li',
    { class: `credential ${credential.revokedAt === null ? '' : 'is-revoked'}`, data: { credentialId: credential.id } },
    h(
      'div',
      { class: 'credential-main' },
      h(
        'div',
        { class: 'credential-name' },
        h('strong', {}, credential.name),
        h('span', { class: `kind is-${credential.kind}` }, strings.credentialKind[credential.kind]),
        credential.current && h('span', { class: 'kind is-current' }, strings.credentialCurrent),
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
        h('button', { type: 'button', ...opensDialog(strings.renameTitle, () => renameForm(credential, reload)) }, strings.rename),
        h(
          'button',
          { type: 'button', class: 'danger', ...opensDialog(strings.revokeTitle, () => revokeForm(credential, reload)) },
          strings.revoke,
        ),
      ),
  )

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
    h('p', {}, strings.revokeBody(credential.name)),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      button(
        strings.revoke,
        () =>
          launch(revokeCredential(credential.id), () => {
            closeDialog()
            reload()
          }),
        { class: 'danger' },
      ),
    ),
  )
