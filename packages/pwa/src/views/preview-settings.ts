import type { AsRead } from '@homingbird/protocol'
import { type Lifetime, h, region, signal } from '@homingbird/ui'
import { type Choice, allowanceFrom, previewSettingsModel } from '../models/preview-settings.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { loading } from './parts.ts'

/** "Early previews" under My agent: whom the person lets see their agent's drafts before they check them. */
export const previewSettingsSection = (context: ViewContext, life: Lifetime, me: AsRead.Me): HTMLElement => {
  const { state, actions } = context
  const allowance = signal<AsRead.DraftPreviewAllowance | 'failed' | null>(null)
  const saved = signal(false)
  actions.loadPeople()
  actions.loadKnownChannels()
  actions.loadPreviewAllowance({
    done: (read) => allowance.set(read),
    failed: () => allowance.set('failed'),
  })
  return region(life, [allowance, saved, state.directory, state.channels], () => {
    const model = previewSettingsModel({
      me,
      allowance: allowance.get(),
      directory: state.directory.get(),
      channels: state.channels.get(),
    })
    if (model.kind === 'loading') return loading()
    if (model.kind === 'failed') return h('p', { class: 'hint' }, model.text)
    return h(
      'form',
      {
        class: 'form preview-settings',
        on: {
          submit: (event) => {
            event.preventDefault()
            const form = event.currentTarget as HTMLFormElement
            const ticked = (name: string) =>
              [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(
                (box) => box.value,
              )
            actions.savePreviewAllowance(allowanceFrom(ticked('person'), ticked('channel')), {
              done: (stored) => {
                saved.set(true)
                allowance.set(stored)
              },
            })
          },
        },
      },
      h('p', { class: 'hint' }, model.intro),
      choices(
        strings.draftPreviews.people,
        strings.draftPreviews.peopleHint,
        'person',
        model.people,
        model.noPeople,
      ),
      choices(
        strings.draftPreviews.channels,
        strings.draftPreviews.channelsHint,
        'channel',
        model.channels,
        model.noChannels,
      ),
      h('p', { class: 'hint', role: 'status' }, saved.get() ? strings.draftPreviews.saved : model.summary),
      h('button', { type: 'submit', class: 'primary' }, strings.draftPreviews.save),
    )
  })
}

const choices = (
  legend: string,
  hint: string,
  name: string,
  options: ReadonlyArray<Choice>,
  none: string | null,
): HTMLElement =>
  h(
    'fieldset',
    { class: 'preview-choices' },
    h('legend', {}, legend),
    h('p', { class: 'hint' }, hint),
    none !== null
      ? h('p', { class: 'hint' }, none)
      : options.map((option) =>
          h(
            'label',
            { class: 'choice' },
            h('input', { type: 'checkbox', name, value: option.value, checked: option.checked }),
            h('span', {}, option.label),
          ),
        ),
  )
