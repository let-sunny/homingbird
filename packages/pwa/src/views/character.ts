import type { AsRead, CharacterSpec } from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import { characterOf } from '../characters.ts'
import { featureOn } from '../features.ts'
import { avatarOf, memberAvatarOf } from '../models/avatar.ts'
import { type MyCharacterModel, myCharacterModel, previewModel } from '../models/character.ts'
import { strings } from '../strings.ts'
import { renderAvatar } from './character-avatar.ts'
import type { ViewContext } from './context.ts'
import { button } from './parts.ts'

/** "My character" on the profile: the character in use, the 24 built-ins to pick from, and the editor. */
export const myCharacterSection = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const current = characterOf(me.member, featureOn('characters', context.state.serverInfo.get()))
  const picked = signal<CharacterSpec | null>(null)
  const model = (): MyCharacterModel => myCharacterModel(current, picked.get())
  const start = model()
  const choices = start.choices.map((choice) =>
    h(
      'button',
      {
        type: 'button',
        class: 'character-choice',
        'aria-pressed': 'false',
        data: { character: choice.preset.id },
        on: { click: () => picked.set(choice.preset) },
      },
      renderAvatar(context, avatarOf(choice.preset, { scale: 2 })),
      h('span', {}, choice.name),
    ),
  )
  life.add(
    picked.subscribe(() => {
      for (const [index, choice] of model().choices.entries())
        choices[index]!.setAttribute('aria-pressed', String(choice.pressed))
    }),
  )
  const saved = {
    done: () => context.state.notice.set({ kind: 'info' as const, text: strings.character.saved }),
  }
  return h(
    'fieldset',
    { class: 'appearance my-character' },
    h('legend', {}, strings.character.title),
    h('p', {}, strings.character.intro),
    h(
      'div',
      { class: 'character-current' },
      renderAvatar(
        context,
        memberAvatarOf(me.member, featureOn('characters', context.state.serverInfo.get()), { scale: 4 }),
      ),
      h(
        'div',
        { class: 'character-current-text' },
        h('p', {}, start.current),
        h(
          'div',
          { class: 'character-actions' },
          h('a', { class: 'button', href: start.editorHref }, strings.character.makeOwn),
          start.mayGoBackToPigeon &&
            button(strings.character.backToPigeon, () => context.actions.useCharacter(null, saved)),
        ),
      ),
    ),
    h('p', { class: 'field-label' }, strings.character.builtIn),
    h(
      'ul',
      { class: 'character-grid' },
      choices.map((choice) => h('li', {}, choice)),
    ),
    region(life, [picked], () => {
      const shown = model().picked
      if (shown === null) return null
      return h(
        'div',
        { class: 'character-picked' },
        h('p', { role: 'status' }, shown.selected),
        characterPreview(context, shown.spec),
        h(
          'div',
          { class: 'character-actions' },
          button(strings.character.use, () => context.actions.useCharacter(shown.saves, saved), {
            class: 'primary',
            disabled: !shown.mayUse,
          }),
          shown.editHref !== null &&
            h('a', { class: 'button', href: shown.editHref }, strings.character.editThis),
        ),
      )
    }),
    askMyAgent(),
  )
}

/** The character on a light and a dark ground, idle and in the states colleagues see most, each named. */
export const characterPreview = (
  context: Pick<ViewContext, 'clock' | 'page'>,
  spec: CharacterSpec,
): HTMLElement =>
  h(
    'div',
    { class: 'character-preview' },
    previewModel(spec).map((ground) =>
      h(
        'figure',
        { class: `character-ground is-${ground.ground}` },
        h('figcaption', {}, ground.caption),
        h(
          'ul',
          { class: 'character-states' },
          ground.states.map((state) =>
            h(
              'li',
              {},
              renderAvatar(
                context,
                avatarOf(spec, { scale: 3, state: state.state, motion: 'loop', label: state.label }),
              ),
              h('span', { 'aria-hidden': 'true' }, state.word),
            ),
          ),
        ),
      ),
    ),
  )

/** How to have one's agent design a character instead. */
export const askMyAgent = (): HTMLElement =>
  h(
    'details',
    { class: 'ask-my-agent' },
    h('summary', {}, strings.character.askAgent),
    h('p', {}, strings.character.askAgentHint),
  )
