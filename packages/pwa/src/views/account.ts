import { Task as T } from '@homingbird/kernel'
import type { Credential, Me } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import {
  api,
  chooseLanguage,
  launch,
  loadTopics,
  renameCredential,
  revokeCredential,
  updateProfile,
} from '../actions.ts'
import { APPEARANCES, type Appearance, applyAppearance, currentAppearance } from '../appearance.ts'
import { languageChoices } from '../languages.ts'
import { pushIsAvailable, pushIsOn, turnPushOff, turnPushOn } from '../push.ts'
import { hrefFor } from '../routes.ts'
import { directory, notice, topics } from '../state.ts'
import { strings } from '../strings.ts'
import { myCharacterSection } from './character.ts'
import { deskRecommendation } from './connect.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, dateTimeLabel, field, page, topicChips } from './parts.ts'
import { startTour } from './tour.ts'

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
      field(strings.profileAbout, profile, strings.profileAgentHint),
      h('button', { type: 'submit', class: 'primary' }, strings.save),
    ),
    myCharacterSection(life, me),
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
          appearanceLabels()[appearance],
        ),
      ),
    ),
    languagePicker(me),
    h(
      'fieldset',
      { class: 'appearance tour-again' },
      h('legend', {}, strings.tour.legend),
      button(strings.tour.showAgain, () => startTour(), { class: 'show-tour' }),
    ),
    helpedTopics(life, me),
    notificationsToggle(life),
  )
}

export const languagePicker = (me: Me): HTMLElement =>
  h(
    'fieldset',
    { class: 'appearance language' },
    h('legend', {}, strings.language),
    languageChoices(strings.languageAuto).map((choice) =>
      h(
        'label',
        { class: 'choice', lang: choice.lang ?? undefined },
        h('input', {
          type: 'radio',
          name: 'language',
          value: choice.value ?? '',
          checked: (me.locale ?? null) === choice.value,
          on: { change: () => launch(chooseLanguage(choice.value)) },
        }),
        choice.label,
      ),
    ),
    h('small', {}, strings.languageHint),
  )

const helpedTopics = (life: Lifetime, me: Me): HTMLElement => {
  launch(loadTopics(''))
  return h(
    'fieldset',
    { class: 'appearance my-topics' },
    h('legend', {}, strings.profileAgent),
    region(life, [topics, directory], () => {
      const helped = topics.get().filter((topic) => topic.answering)
      const fromDirectory = directory.get().find((entry) => entry.member.id === me.member.id)?.topics ?? []
      const slugs = helped.length > 0 ? helped.map((topic) => topic.slug) : fromDirectory
      return slugs.length === 0 ? h('p', {}, strings.noTopicsHelped) : topicChips(slugs)
    }),
    h('a', { class: 'button', href: hrefFor({ name: 'topics' }) }, strings.browseTopics),
  )
}

const notificationsToggle = (life: Lifetime): HTMLElement => {
  const isOn = signal(false)
  if (!pushIsAvailable())
    return h(
      'fieldset',
      { class: 'appearance' },
      h('legend', {}, strings.notifications),
      h('p', {}, strings.notificationsUnavailable),
    )
  launch(T.map((on: boolean) => isOn.set(on))(pushIsOn))
  const toggle = (wanted: boolean): void =>
    launch(
      T.map((on: boolean) => {
        isOn.set(on)
        if (wanted && !on) notice.set({ kind: 'error', text: strings.notificationsRefused })
      })(wanted ? turnPushOn : turnPushOff),
    )
  return h(
    'fieldset',
    { class: 'appearance' },
    h('legend', {}, strings.notifications),
    region(life, [isOn], () => {
      const box = h('input', { type: 'checkbox', name: 'notifications', checked: isOn.get() })
      box.addEventListener('change', () => {
        const wanted = box.checked
        box.checked = isOn.get()
        toggle(wanted)
      })
      return h(
        'label',
        { class: 'choice' },
        box,
        h('span', {}, strings.notificationsToggle, h('small', {}, strings.notificationsHint)),
      )
    }),
  )
}

export const credentialsView = (life: Lifetime): HTMLElement => {
  const credentials = signal<ReadonlyArray<Credential> | null>(null)
  const reload = (): void =>
    launch(
      T.map((listed: { credentials: ReadonlyArray<Credential> }) => credentials.set(listed.credentials))(
        api['credentials.list']({}),
      ),
    )
  reload()
  return page(
    strings.credentialsTitle,
    h('p', {}, strings.credentialsIntro),
    h('a', { class: 'button primary', href: hrefFor({ name: 'connect' }) }, strings.connectAgent),
    region(life, [credentials], () => {
      const listed = credentials.get()
      if (listed === null) return h('p', { class: 'loading' }, strings.loading)
      return [
        !listed.some((credential) => credential.kind === 'agent' && credential.revokedAt === null) &&
          deskRecommendation(),
        h(
          'ul',
          { class: 'credentials' },
          listed.map((credential) => credentialRow(credential, reload)),
        ),
      ]
    }),
  )
}

const appearanceLabels = (): Readonly<Record<Appearance, string>> => ({
  auto: strings.appearanceAuto,
  light: strings.appearanceLight,
  dark: strings.appearanceDark,
})

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
