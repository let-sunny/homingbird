import { Task as T } from '@homingbird/kernel'
import {
  type AuditEntry,
  type Me,
  type Member,
  type Settings,
  TOPIC_DESCRIPTION_MAX,
  type Topic,
} from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { api, launch, loadTopics, mergeTopic, removeTopic, reviseTopic, saveSettings } from '../actions.ts'
import { type AdminSection, hrefFor } from '../routes.ts'
import { members as knownMembers, notice, topics } from '../state.ts'
import { strings } from '../strings.ts'
import { canRename, slugFrom, topicLabel } from '../topics.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, dateTimeLabel, field, page } from './parts.ts'

export const adminView = (life: Lifetime, me: Me, section: AdminSection): HTMLElement =>
  page(
    strings.adminTitle,
    h(
      'nav',
      { class: 'subtabs' },
      SECTIONS.map(([name, label]) =>
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
        : section === 'topics'
          ? topicsSection(life)
          : auditSection(life),
  )

const SECTIONS: ReadonlyArray<readonly [AdminSection, string]> = [
  ['settings', strings.adminSettings],
  ['members', strings.adminMembers],
  ['topics', strings.adminTopics],
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
            }),
            () => notice.set({ kind: 'info', text: strings.saved }),
          )
        },
      },
    },
    field(strings.allowedDomains, domains, strings.allowedDomainsHint),
    field(strings.contactMode, mode),
    field(strings.auditRetention, retention, strings.auditRetentionHint),
    h('button', { type: 'submit', class: 'primary' }, strings.save),
  )
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
          h(
            'div',
            { class: 'member-main' },
            h('strong', {}, member.name),
            h('span', {}, member.email),
            h('span', { class: `kind is-${member.role}` }, strings.memberRole[member.role]),
            h('span', { class: `kind is-${member.status}` }, strings.memberStatus[member.status]),
          ),
          member.id !== me.member.id &&
            h(
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
            ),
        ),
      ),
    )
  })
}

const topicsSection = (life: Lifetime): HTMLElement => {
  launch(loadTopics(''))
  return region(life, [topics], () =>
    h(
      'ul',
      { class: 'members admin-topics' },
      topics.get().map((topic) =>
        h(
          'li',
          { class: 'member', data: { slug: topic.slug } },
          h(
            'div',
            { class: 'member-main' },
            h('strong', {}, topicLabel(topic.slug)),
            h('span', {}, topic.description),
            h('span', { class: 'topic-meta' }, strings.helpers(topic.helperCount)),
            !canRename(topic.slug) && h('small', {}, strings.generalIsFixed),
          ),
          h(
            'div',
            { class: 'member-actions' },
            h(
              'button',
              {
                type: 'button',
                ...opensDialog(strings.editTopicTitle(topicLabel(topic.slug)), () => editTopicForm(topic)),
              },
              strings.editTopic,
            ),
            canRename(topic.slug) &&
              h(
                'button',
                {
                  type: 'button',
                  ...opensDialog(strings.mergeTopicTitle(topicLabel(topic.slug)), () => mergeForm(topic)),
                },
                strings.mergeTopic,
              ),
            canRename(topic.slug) &&
              h(
                'button',
                {
                  type: 'button',
                  class: 'danger',
                  ...opensDialog(strings.removeTopicTitle(topicLabel(topic.slug)), () => removeForm(topic)),
                },
                strings.removeTopic,
              ),
          ),
        ),
      ),
    ),
  )
}

const editTopicForm = (topic: Topic): Child => {
  const slug = h('input', {
    name: 'slug',
    required: true,
    maxlength: '40',
    value: topic.slug,
    disabled: !canRename(topic.slug),
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
    maxlength: String(TOPIC_DESCRIPTION_MAX),
    value: topic.description,
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
            reviseTopic(topic.slug, {
              ...(canRename(topic.slug) && renamed !== topic.slug && { slug: renamed }),
              description: description.value.trim(),
            }),
            closeDialog,
          )
        },
      },
    },
    field(
      strings.topicSlugLabel,
      slug,
      canRename(topic.slug) ? strings.topicSlugHint : strings.generalIsFixed,
    ),
    field(strings.topicDescriptionLabel, description),
    dialogActions(strings.save, 'primary'),
  )
}

const mergeForm = (topic: Topic): Child => {
  const into = h(
    'select',
    { name: 'into', required: true },
    topics
      .get()
      .filter((other) => other.slug !== topic.slug)
      .map((other) => h('option', { value: other.slug }, topicLabel(other.slug))),
  )
  return h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(mergeTopic(topic.slug, into.value), closeDialog)
        },
      },
    },
    h('p', {}, strings.mergeIntro),
    field(strings.mergeInto, into),
    dialogActions(strings.mergeInto, 'primary'),
  )
}

const removeForm = (topic: Topic): Child =>
  h(
    'form',
    {
      class: 'dialog-body',
      on: {
        submit: (event) => {
          event.preventDefault()
          launch(removeTopic(topic.slug), closeDialog)
        },
      },
    },
    h('p', {}, strings.removeTopicBody),
    dialogActions(strings.removeTopic, 'danger'),
  )

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
