import { Task as T } from '@homingbird/kernel'
import {
  type AuditEntry,
  CHANNEL_DESCRIPTION_MAX,
  type Channel,
  type Me,
  type Member,
  type Settings,
} from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import {
  api,
  archiveChannel,
  launch,
  loadChannels,
  resetMemberCharacter,
  reviseChannel,
  saveSettings,
} from '../actions.ts'
import { flowLength, flowToSave, mayInsertExample } from '../answering-flow.ts'
import { channelLabel, slugFrom } from '../channels.ts'
import { type AdminSection, hrefFor } from '../routes.ts'
import { channels, members as knownMembers, notice } from '../state.ts'
import { strings } from '../strings.ts'
import { privateMark } from './channel-membership.ts'
import { memberAvatar } from './character-avatar.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, channelCounts, dateTimeLabel, field, page, youMark } from './parts.ts'

export const adminView = (life: Lifetime, me: Me, section: AdminSection): HTMLElement =>
  page(
    strings.adminTitle,
    h(
      'nav',
      { class: 'subtabs' },
      sections().map(([name, label]) =>
        h(
          'a',
          { href: hrefFor({ name: 'admin', section: name }), 'aria-current': name === section && 'page' },
          label,
        ),
      ),
    ),
    section === 'settings'
      ? settingsSection(life)
      : section === 'members'
        ? membersSection(life, me)
        : section === 'channels'
          ? channelsSection(life)
          : auditSection(life),
  )

const sections = (): ReadonlyArray<readonly [AdminSection, string]> => [
  ['settings', strings.adminSettings],
  ['members', strings.adminMembers],
  ['channels', strings.adminChannels],
  ['audit', strings.adminAudit],
]

const settingsSection = (life: Lifetime): HTMLElement => {
  const settings = signal<Settings | null>(null)
  launch(T.map((loaded: Settings) => settings.set(loaded))(api['admin.settings.get']({})))
  return region(life, [settings], () => {
    const loaded = settings.get()
    return loaded === null ? h('p', { class: 'loading' }, strings.loading) : settingsForm(loaded)
  })
}

const settingsForm = (settings: Settings): HTMLElement => {
  const domains = h('textarea', { name: 'domains', rows: '4' })
  domains.value = settings.allowedDomains.join('\n')
  const mode = h(
    'select',
    { name: 'contactMode' },
    h('option', { value: 'open', selected: settings.contactMode === 'open' }, strings.contactModeOpen),
    h(
      'option',
      { value: 'contacts', selected: settings.contactMode === 'contacts' },
      strings.contactModeContacts,
    ),
  )
  const retention = h('input', {
    name: 'retention',
    type: 'number',
    min: '1',
    max: '36500',
    value: settings.auditRetentionDays ?? '',
  })
  const flow = answeringFlowEditor(settings.answeringFlow ?? null)
  return h(
    'form',
    {
      class: 'form',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(
            saveSettings({
              allowedDomains: domains.value
                .split(/[\s,]+/)
                .map((domain) => domain.trim().toLowerCase())
                .filter((domain) => domain !== ''),
              contactMode: mode.value === 'contacts' ? 'contacts' : 'open',
              auditRetentionDays: retention.value === '' ? null : Number(retention.value),
              answeringFlow: flowToSave(flow.text.value),
            }),
            () => notice.set({ kind: 'info', text: strings.saved }),
          )
        },
      },
    },
    field(strings.allowedDomains, domains, strings.allowedDomainsHint),
    field(strings.contactMode, mode),
    field(strings.auditRetention, retention, strings.auditRetentionHint),
    flow.section,
    h('button', { type: 'submit', class: 'primary' }, strings.save),
  )
}

const answeringFlowEditor = (
  saved: string | null,
): { readonly section: HTMLElement; readonly text: HTMLTextAreaElement } => {
  const text = h('textarea', {
    name: 'answeringFlow',
    class: 'answering-flow-text',
    rows: '10',
    spellcheck: 'false',
    'aria-describedby': 'answering-flow-format answering-flow-count',
  })
  text.value = saved ?? ''
  const count = h('small', { id: 'answering-flow-count', class: 'flow-count', 'aria-live': 'polite' })
  const example = h('button', {
    type: 'button',
    class: 'insert-example',
    'aria-describedby': 'example-reason',
  })
  example.textContent = strings.answeringFlow.insertExample
  const exampleReason = h('small', { id: 'example-reason' }, strings.answeringFlow.exampleNeedsEmpty)
  const reflect = (): void => {
    const length = flowLength(text.value)
    count.textContent = strings.answeringFlow.counter({ used: length.used, max: length.max })
    count.classList.toggle('is-over', length.over)
    example.disabled = !mayInsertExample(text.value)
    exampleReason.hidden = !example.disabled
  }
  text.addEventListener('input', reflect)
  example.addEventListener('click', () => {
    if (!mayInsertExample(text.value)) return
    text.value = strings.answeringFlow.example
    reflect()
    text.focus()
  })
  reflect()
  return {
    text,
    section: h(
      'fieldset',
      { class: 'answering-flow' },
      h('legend', {}, strings.answeringFlow.title),
      h('p', {}, strings.answeringFlow.intro),
      h(
        'div',
        { class: 'flow-warning', role: 'note' },
        h('p', {}, strings.answeringFlow.warning),
        h('p', {}, strings.answeringFlow.caution),
      ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, strings.answeringFlow.label),
        text,
        h('small', { id: 'answering-flow-format' }, strings.answeringFlow.format),
      ),
      h(
        'div',
        { class: 'flow-tools' },
        count,
        h('span', { class: 'disabled-control' }, example, exampleReason),
      ),
    ),
  }
}

const membersSection = (life: Lifetime, me: Me): HTMLElement => {
  const members = signal<ReadonlyArray<Member> | null>(null)
  const reload = (): void =>
    launch(
      T.map((listed: { members: ReadonlyArray<Member> }) => members.set(listed.members))(
        api['admin.members.list']({}),
      ),
    )
  const change = (member: Member, body: { status?: Member['status']; role?: Member['role'] }): void =>
    launch(api['admin.members.update']({ params: { id: member.id }, body }), reload)
  reload()
  return region(life, [members], () => {
    const listed = members.get()
    if (listed === null) return h('p', { class: 'loading' }, strings.loading)
    return h(
      'ul',
      { class: 'members' },
      listed.map((member) =>
        h(
          'li',
          { class: `member is-${member.status}`, data: { memberId: member.id } },
          memberAvatar(member),
          h(
            'div',
            { class: 'member-main' },
            h('strong', {}, member.name, member.id === me.member.id && youMark()),
            h('span', {}, member.email),
            h('span', { class: `kind is-${member.role}` }, strings.memberRole[member.role]),
            h('span', { class: `kind is-${member.status}` }, strings.memberStatus[member.status]),
          ),
          member.id === me.member.id
            ? h('p', { class: 'hint own-row-reason' }, strings.cannotChangeOwnRole)
            : h(
                'div',
                { class: 'member-actions' },
                member.role === 'admin'
                  ? button(strings.makeMember, () => change(member, { role: 'member' }))
                  : button(strings.makeAdmin, () => change(member, { role: 'admin' })),
                member.status === 'active'
                  ? button(strings.deactivate, () => change(member, { status: 'deactivated' }), {
                      class: 'danger',
                    })
                  : button(strings.reactivate, () => change(member, { status: 'active' })),
                member.character != null &&
                  button(strings.character.resetMember, () =>
                    launch(resetMemberCharacter(member.id), () => {
                      notice.set({
                        kind: 'info',
                        text: strings.character.resetMemberDone({ name: member.name }),
                      })
                      reload()
                    }),
                  ),
              ),
        ),
      ),
    )
  })
}

const channelsSection = (life: Lifetime): HTMLElement => {
  launch(loadChannels(''))
  return region(life, [channels], () =>
    h(
      'ul',
      { class: 'members admin-channels' },
      channels.get().map((channel) =>
        h(
          'li',
          { class: 'member', data: { slug: channel.slug } },
          h(
            'div',
            { class: 'member-main' },
            h('strong', {}, channelLabel(channel.slug), privateMark(channel)),
            h('span', {}, channel.description),
            h('span', { class: 'channel-meta' }, channelCounts(channel)),
          ),
          h(
            'div',
            { class: 'member-actions' },
            h(
              'button',
              {
                type: 'button',
                ...opensDialog(strings.editChannelTitle({ channel: channelLabel(channel.slug) }), () =>
                  editChannelForm(channel),
                ),
              },
              strings.editChannel,
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'danger',
                ...opensDialog(strings.archiveChannelTitle({ channel: channelLabel(channel.slug) }), () =>
                  archiveForm(channel),
                ),
              },
              strings.archiveChannel,
            ),
          ),
        ),
      ),
    ),
  )
}

const editChannelForm = (channel: Channel): Child => {
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
    required: true,
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
          launch(
            reviseChannel(channel.slug, {
              ...(renamed !== channel.slug && { slug: renamed }),
              description: description.value.trim(),
            }),
            closeDialog,
          )
        },
      },
    },
    field(strings.channelSlugLabel, slug, strings.channelSlugHint),
    field(strings.channelDescriptionLabel, description),
    dialogActions(strings.save, 'primary'),
  )
}

const archiveForm = (channel: Channel): Child => {
  const others = channels.get().filter((other) => other.slug !== channel.slug)
  const moving = h('input', { type: 'checkbox', name: 'moveMembers' })
  const into = h(
    'select',
    { name: 'moveMembersTo', disabled: true },
    others.map((other) => h('option', { value: other.slug }, channelLabel(other.slug))),
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
          launch(archiveChannel(channel.slug, moving.checked ? into.value : null), closeDialog)
        },
      },
    },
    h(
      'ul',
      { class: 'archive-effects' },
      h('li', {}, strings.archiveLeavesList),
      h('li', {}, strings.archiveRoomReadOnly),
      h('li', {}, strings.archiveNotesStay),
      h('li', {}, strings.archiveDraftsDiscarded),
      others.length > 0 && h('li', {}, strings.archiveMembersMove),
    ),
    others.length > 0 &&
      h(
        'fieldset',
        { class: 'archive-move' },
        h('label', { class: 'choice' }, moving, h('span', {}, strings.moveMembersTo)),
        field(strings.moveMembersInto, into),
      ),
    dialogActions(strings.archiveChannel, 'danger'),
  )
}

const dialogActions = (label: string, kind: 'primary' | 'danger'): HTMLElement =>
  h(
    'div',
    { class: 'dialog-actions' },
    h('button', { type: 'button', ...closesDialog }, strings.cancel),
    h('button', { type: 'submit', class: kind }, label),
  )

const auditSection = (life: Lifetime): HTMLElement => {
  const log = signal<{ readonly entries: ReadonlyArray<AuditEntry>; readonly hasMore: boolean }>({
    entries: [],
    hasMore: true,
  })
  const loadMore = (): void => {
    const oldest = log.get().entries.at(-1)?.id
    launch(
      T.map((page: { entries: ReadonlyArray<AuditEntry>; hasMore: boolean }) =>
        log.update((current) => ({ entries: [...current.entries, ...page.entries], hasMore: page.hasMore })),
      )(api['admin.audit.list']({ query: oldest === undefined ? {} : { before: String(oldest) } })),
    )
  }
  loadMore()
  return region(life, [log, knownMembers], () => [
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'audit' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            [
              strings.auditWhen,
              strings.auditWho,
              strings.auditAction,
              strings.auditTarget,
              strings.auditDetail,
            ].map((heading) => h('th', { scope: 'col' }, heading)),
          ),
        ),
        h('tbody', {}, log.get().entries.map(auditRow)),
      ),
    ),
    log.get().hasMore && button(strings.loadMore, loadMore, { class: 'load-older' }),
  ])
}

const auditRow = (entry: AuditEntry): Child =>
  h(
    'tr',
    {},
    h('td', {}, dateTimeLabel(entry.at, '')),
    h(
      'td',
      {},
      entry.actorId === null
        ? strings.auditSystem
        : (knownMembers.get().get(entry.actorId)?.name ?? entry.actorId),
      entry.credentialKind !== null &&
        h('span', { class: `kind is-${entry.credentialKind}` }, strings.credentialKind[entry.credentialKind]),
    ),
    h('td', {}, h('code', {}, entry.action)),
    h('td', {}, entry.target ?? ''),
    h(
      'td',
      {},
      h(
        'details',
        {},
        h('summary', {}, strings.auditDetail),
        h('pre', {}, JSON.stringify(entry.detail, null, 2)),
      ),
    ),
  )
