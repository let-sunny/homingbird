import { Task as T } from '@homingbird/kernel'
import type { Credential, Me } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import {
  api,
  chooseLanguage,
  launch,
  loadChannels,
  renameCredential,
  revokeCredential,
  updateProfile,
} from '../actions.ts'
import { APPEARANCES, type Appearance, applyAppearance, currentAppearance } from '../appearance.ts'
import { featureOn } from '../features.ts'
import { languageChoices } from '../languages.ts'
import { type PushResult, pushResultLines } from '../push-results.ts'
import { pushIsAvailable, pushIsOn, turnPushOff, turnPushOn } from '../push.ts'
import { hrefFor } from '../routes.ts'
import { channels, directory, notice } from '../state.ts'
import { strings } from '../strings.ts'
import { myCharacterSection } from './character.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, channelChips, dateTimeLabel, field, page } from './parts.ts'
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
    featureOn('characters') && myCharacterSection(life, me),
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
    featureOn('webPush') && notificationsToggle(life),
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

const notificationsToggle = (life: Lifetime): HTMLElement => {
  const isOn = signal(false)
  if (!pushIsAvailable())
    return h(
      'fieldset',
      { class: 'appearance' },
      h('legend', {}, strings.notifications),
      h('p', {}, strings.notificationsUnavailable),
    )
  const isBusy = signal(false)
  const tested = signal<ReadonlyArray<string>>([])
  launch(T.map((on: boolean) => isOn.set(on))(pushIsOn))
  const toggle = (wanted: boolean): void => {
    if (isBusy.get()) return
    isBusy.set(true)
    launch(
      T.ensuring(T.sync(() => isBusy.set(false)))(
        T.map((on: boolean) => {
          isOn.set(on)
          if (wanted && !on) notice.set({ kind: 'error', text: strings.notificationsRefused })
        })(wanted ? turnPushOn : turnPushOff),
      ),
    )
  }
  const sendTest = (): void =>
    launch(
      T.map((answer: { results: ReadonlyArray<PushResult> }) => tested.set(pushResultLines(answer.results)))(
        api['push.test']({ body: {} }),
      ),
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
      box.disabled = isBusy.get()
      return h(
        'label',
        { class: 'choice' },
        box,
        h('span', {}, strings.notificationsToggle, h('small', {}, strings.notificationsHint)),
      )
    }),
    region(life, [isOn, tested], () => [
      isOn.get() && button(strings.sendTestPush, sendTest, { class: 'send-test-push' }),
      tested.get().length > 0 &&
        h(
          'ul',
          { class: 'push-test-results', role: 'status' },
          tested.get().map((line) => h('li', {}, line)),
        ),
    ]),
  )
}

const appearanceLabels = (): Readonly<Record<Appearance, string>> => ({
  auto: strings.appearanceAuto,
  light: strings.appearanceLight,
  dark: strings.appearanceDark,
})
