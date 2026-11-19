import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import { applyAppearance, currentAppearance } from '../appearance.ts'
import { featureOn } from '../features.ts'
import {
  type LanguageOption,
  type ProfileModel,
  notificationsModel,
  profileModel,
} from '../models/account.ts'
import { strings } from '../strings.ts'
import { myCharacterSection } from './character.ts'
import type { ViewContext } from './context.ts'
import { button, field, page } from './parts.ts'

/** Profile: name and about text, character, appearance, language, the tour again and notifications. */
export const profileView = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, page: browser } = context
  const info = state.serverInfo.get()
  const model = profileModel({
    me,
    appearance: currentAppearance(browser.storage),
    charactersOn: featureOn('characters', info),
    webPushOn: featureOn('webPush', info),
    pushAvailable: browser.supportsPush(),
  })
  return renderProfile(model, context, life, me)
}

/** The language choices; choosing one saves it for the person. */
const languagePicker = (
  choices: ReadonlyArray<LanguageOption>,
  choose: (value: LanguageOption['value']) => void,
): HTMLElement =>
  h(
    'fieldset',
    { class: 'appearance language' },
    h('legend', {}, strings.language),
    choices.map((choice) =>
      h(
        'label',
        { class: 'choice', lang: choice.lang ?? undefined },
        h('input', {
          type: 'radio',
          name: 'language',
          value: choice.value ?? '',
          checked: choice.checked,
          on: { change: () => choose(choice.value) },
        }),
        choice.label,
      ),
    ),
    h('small', {}, strings.languageHint),
  )

const notificationsToggle = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { actions, state } = context
  const isOn = signal(false)
  const isBusy = signal(false)
  const tested = signal<ReadonlyArray<string>>([])
  actions.pushIsOn({ done: (on) => isOn.set(on) })
  const toggle = (wanted: boolean): void => {
    if (isBusy.get()) return
    isBusy.set(true)
    const settle = {
      done: (on: boolean) => {
        isOn.set(on)
        if (wanted && !on) state.notice.set({ kind: 'error', text: strings.notificationsRefused })
        isBusy.set(false)
      },
      failed: () => isBusy.set(false),
    }
    if (wanted) actions.turnPushOn(settle)
    else actions.turnPushOff(settle)
  }
  const model = () => notificationsModel({ isOn: isOn.get(), isBusy: isBusy.get(), tested: tested.get() })
  return h(
    'fieldset',
    { class: 'appearance' },
    h('legend', {}, strings.notifications),
    region(life, [isOn, isBusy], () => {
      const shown = model()
      const box = h('input', { type: 'checkbox', name: 'notifications', checked: shown.checked })
      box.addEventListener('change', () => {
        const wanted = box.checked
        box.checked = isOn.get()
        toggle(wanted)
      })
      box.disabled = shown.disabled
      return h(
        'label',
        { class: 'choice' },
        box,
        h('span', {}, strings.notificationsToggle, h('small', {}, strings.notificationsHint)),
      )
    }),
    region(life, [isOn, tested], () => {
      const shown = model()
      return [
        shown.mayTest &&
          button(strings.sendTestPush, () => actions.testPush({ done: (lines) => tested.set(lines) }), {
            class: 'send-test-push',
          }),
        shown.results.length > 0 &&
          h(
            'ul',
            { class: 'push-test-results', role: 'status' },
            shown.results.map((line) => h('li', {}, line)),
          ),
      ]
    }),
  )
}

const renderProfile = (
  model: ProfileModel,
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
): HTMLElement => {
  const { actions, state } = context
  const name = h('input', { name: 'name', required: true, maxlength: '200', value: model.name })
  const profile = h('textarea', { name: 'profile', rows: '3', maxlength: '500' })
  profile.value = model.profile
  return page(
    strings.profileTitle,
    h(
      'form',
      {
        class: 'form',
        on: {
          submit: (event) => {
            event.preventDefault()
            actions.updateProfile(name.value.trim(), profile.value.trim(), {
              done: () => state.notice.set({ kind: 'info', text: strings.saved }),
            })
          },
        },
      },
      h('p', { class: 'form-who' }, model.email),
      field(strings.profileName, name),
      field(strings.profileAbout, profile, strings.profileAgentHint),
      h('button', { type: 'submit', class: 'primary' }, strings.save),
    ),
    model.showsCharacter && myCharacterSection(context, life, me),
    h(
      'fieldset',
      { class: 'appearance' },
      h('legend', {}, strings.appearance),
      model.appearances.map((appearance) =>
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'radio',
            name: 'appearance',
            value: appearance.value,
            checked: appearance.checked,
            on: {
              change: () => applyAppearance(context.document.root(), context.page.storage, appearance.value),
            },
          }),
          appearance.label,
        ),
      ),
    ),
    languagePicker(model.languages, (choice) => actions.chooseLanguage(choice)),
    h(
      'fieldset',
      { class: 'appearance tour-again' },
      h('legend', {}, strings.tour.legend),
      button(strings.tour.showAgain, () => context.tour.start(), { class: 'show-tour' }),
    ),
    model.notifications === 'unavailable' &&
      h(
        'fieldset',
        { class: 'appearance' },
        h('legend', {}, strings.notifications),
        h('p', {}, strings.notificationsUnavailable),
      ),
    model.notifications === 'available' && notificationsToggle(context, life),
  )
}
