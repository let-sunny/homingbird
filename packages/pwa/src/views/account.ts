import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { applyAppearance, currentAppearance } from '../appearance.ts'
import { featureOn } from '../features.ts'
import { restartedHints, writeHints } from '../hints.ts'
import {
  type LanguageOption,
  type NotificationLevelModel,
  type ProfileModel,
  myGroupsModel,
  notificationLevelModel,
  notificationsModel,
  profileModel,
} from '../models/account.ts'
import { signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import { myCharacterSection } from './character.ts'
import type { ViewContext } from './context.ts'
import { button, channelChips, field, page } from './parts.ts'

/** Profile: name and about text, character, appearance, language, the tour again and notifications. */
export const profileView = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, page: browser } = context
  const info = state.serverInfo.get()
  const model = profileModel({
    me,
    appearance: currentAppearance(browser.storage),
    charactersOn: featureOn('characters', info),
    groupsOn: featureOn('groups', info),
    webPushOn: featureOn('webPush', info),
    pushAvailable: browser.supportsPush(),
  })
  return renderProfile(model, context, life, me)
}

/** The person's teams, and the channels they manage. */
const myGroups = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state } = context
  context.actions.loadGroups()
  return region(
    life,
    [state.groups, state.groupsLoaded],
    (): Child => {
      const model = myGroupsModel(
        me,
        state.groups.get(),
        state.groupsLoaded.get(),
        featureOn('groups', state.serverInfo.get()),
      )
      return (
        model !== null &&
        h(
          'section',
          { class: 'appearance my-groups' },
          h('h2', {}, model.title),
          model.empty !== null && h('p', {}, model.empty),
          h(
            'ul',
            { class: 'my-group-list' },
            model.groups.map((group) =>
              h('li', { class: 'my-group' }, h('a', { href: group.href }, group.label)),
            ),
          ),
          h('p', { class: 'group-manages' }, model.manages),
          model.channels.length > 0 && channelChips(model.channels),
        )
      )
    },
    { class: 'my-groups-host' },
  )
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
    model.showsGroups && myGroups(context, life, me),
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
    hintsAgain(context, me),
    model.notifications === 'unavailable' &&
      h(
        'fieldset',
        { class: 'appearance' },
        h('legend', {}, strings.notifications),
        h('p', {}, strings.notificationsUnavailable),
      ),
    model.notifications === 'available' && notificationsToggle(context, life),
    notificationLevelPicker(context, life, me),
  )
}

/** Which conversations notify the person; choosing one saves it at once. */
const notificationLevelPicker = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement =>
  region(
    life,
    [context.state.session, context.state.serverInfo],
    (): Child => {
      const info = context.state.serverInfo.get()
      const model = notificationLevelModel({
        me: signedIn(context.state) ?? me,
        muteOn: featureOn('mute', info),
        webPushOn: featureOn('webPush', info),
      })
      return model !== null && renderNotificationLevel(context, model)
    },
    { class: 'notification-level-host' },
  )

const renderNotificationLevel = (context: ViewContext, model: NotificationLevelModel): HTMLElement =>
  h(
    'fieldset',
    { class: 'appearance notification-level' },
    h('legend', {}, model.legend),
    model.options.map((option) =>
      h(
        'label',
        { class: 'choice' },
        h('input', {
          type: 'radio',
          name: 'notification-level',
          value: option.value,
          checked: option.checked,
          on: {
            change: () =>
              context.actions.chooseNotificationLevel(option.value, {
                done: () => context.state.notice.set({ kind: 'info', text: strings.saved }),
              }),
          },
        }),
        h('span', {}, option.label, option.hint !== null && h('small', {}, option.hint)),
      ),
    ),
    h('small', {}, model.hint),
  )

/** Profile's way back to the hints of what each Homingbird control does, after they retired. */
const hintsAgain = (context: ViewContext, me: AsRead.Me): HTMLElement => {
  const done = h('p', { class: 'hint', 'aria-live': 'polite' })
  return h(
    'fieldset',
    { class: 'appearance hints-again' },
    h('legend', {}, strings.hints.legend),
    h('p', { class: 'hint' }, strings.hints.intro),
    button(
      strings.hints.showAgain,
      () => {
        writeHints(context.page.storage, me.member.id, restartedHints(context.clock.now()))
        done.textContent = strings.hints.shownAgain
      },
      { class: 'show-hints' },
    ),
    done,
  )
}
