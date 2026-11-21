import { type AsRead, CHANNEL_DESCRIPTION_MAX } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { slugFrom } from '../channels.ts'
import { type AdminChannelsModel, adminChannelsModel, archiveModel } from '../models/admin.ts'
import { strings } from '../strings.ts'
import { privateMark } from './channel-membership.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, opensDialog } from './dialog.ts'
import { channelCounts, dialogActions, empty, field, loadFailed, loading } from './parts.ts'

/** Administration → Channels: every channel, to rename, describe again or archive. */
export const adminChannelsSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { state, actions } = context
  const failed = signal(false)
  const load = (): void => {
    failed.set(false)
    actions.loadKnownChannels({ failed: () => failed.set(true) })
  }
  load()
  return region(life, [state.channels, state.channelsLoaded, failed], () =>
    renderAdminChannels(
      adminChannelsModel(state.channels.get(), state.channelsLoaded.get(), failed.get()),
      context,
      load,
    ),
  )
}

const renderAdminChannels = (
  model: AdminChannelsModel,
  context: ViewContext,
  retry: () => void,
): HTMLElement => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'failed') return loadFailed(retry)
  if (model.kind === 'empty') return empty(model.text)
  return h(
    'ul',
    { class: 'members admin-channels' },
    model.rows.map((row) =>
      h(
        'li',
        { class: 'member', data: { slug: row.channel.slug } },
        h(
          'div',
          { class: 'member-main' },
          h('strong', {}, row.label, privateMark(row.channel)),
          h('span', {}, row.channel.description),
          h('span', { class: 'channel-meta' }, channelCounts(row.channel)),
        ),
        h(
          'div',
          { class: 'member-actions' },
          h(
            'button',
            {
              type: 'button',
              ...opensDialog(context, row.editTitle, () => editChannelForm(context, row.channel)),
            },
            strings.editChannel,
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'danger',
              ...opensDialog(context, row.archiveTitle, () => archiveForm(context, row.channel)),
            },
            strings.archiveChannel,
          ),
        ),
      ),
    ),
  )
}

const editChannelForm = (context: ViewContext, channel: AsRead.Channel): Child => {
  const slug = h('input', {
    name: 'slug',
    required: true,
    maxlength: '40',
    value: channel.slug,
    on: {
      input: () => {
        const normalized = slugFrom(slug.value)
        if (normalized !== slug.value) slug.value = normalized
      },
    },
  })
  const description = h('input', {
    name: 'description',
    maxlength: String(CHANNEL_DESCRIPTION_MAX),
    value: channel.description,
  })
  return h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          const renamed = slugFrom(slug.value).replace(/-+$/, '')
          context.actions.reviseChannel(
            channel.slug,
            { ...(renamed !== channel.slug && { slug: renamed }), description: description.value.trim() },
            { done: () => closeDialog(context) },
          )
        },
      },
    },
    field(strings.channelSlugLabel, slug, strings.channelSlugHint),
    field(strings.channelDescriptionLabel, description),
    dialogActions(strings.save, 'primary'),
  )
}

const archiveForm = (context: ViewContext, channel: AsRead.Channel): Child => {
  const model = archiveModel(context.state.channels.get(), channel.slug)
  const moving = h('input', { type: 'checkbox', name: 'moveMembers' })
  const into = h(
    'select',
    { name: 'moveMembersTo', disabled: true },
    (model.moveTo ?? []).map((other) => h('option', { value: other.value }, other.label)),
  )
  moving.addEventListener('change', () => {
    into.disabled = !moving.checked
  })
  return h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.archiveChannel(channel.slug, moving.checked ? into.value : null, {
            done: () => closeDialog(context),
          })
        },
      },
    },
    h(
      'ul',
      { class: 'archive-effects' },
      model.effects.map((effect) => h('li', {}, effect)),
    ),
    model.moveTo !== null &&
      h(
        'fieldset',
        { class: 'archive-move' },
        h('label', { class: 'choice' }, moving, h('span', {}, strings.moveMembersTo)),
        field(strings.moveMembersInto, into),
      ),
    dialogActions(strings.archiveChannel, 'danger'),
  )
}
