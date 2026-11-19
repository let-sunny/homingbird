import { Task as T } from '@homingbird/kernel'
import {
  ANSWERING_FLOW_MAX_CHARACTERS,
  type ApiError,
  type AuditEntry,
  CHANNEL_DESCRIPTION_MAX,
  type Channel,
  FEATURE_NAMES,
  type FlowStep,
  type Me,
  type Member,
  type Settings,
  featureSwitches,
} from '@homingbird/protocol'
import { type Child, type Lifetime, type Signal, h, region, signal } from '@homingbird/ui'
import {
  api,
  archiveChannel,
  launch,
  loadChannels,
  resetMemberCharacter,
  reviseChannel,
  saveSettings,
} from '../actions.ts'
import { flowSize, flowToSave, mayInsertExample, moveStep, stepsFrom } from '../answering-flow.ts'
import { channelLabel, slugFrom } from '../channels.ts'
import { featureOn } from '../features.ts'
import { type AdminSection, hrefFor } from '../routes.ts'
import { channels, channelsLoaded, members as knownMembers, notice } from '../state.ts'
import { strings } from '../strings.ts'
import { privateMark } from './channel-membership.ts'
import { memberAvatar } from './character-avatar.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { insightsSection } from './insights.ts'
import {
  button,
  channelCounts,
  dateTimeLabel,
  empty,
  field,
  loadFailed,
  loading,
  page,
  youMark,
} from './parts.ts'
import { todoList } from './todo-list.ts'

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
          : section === 'insights' && featureOn('insights')
            ? insightsSection(life)
            : auditSection(life),
  )

const sections = (): ReadonlyArray<readonly [AdminSection, string]> => [
  ['settings', strings.adminSettings],
  ['members', strings.adminMembers],
  ['channels', strings.adminChannels],
  ...(featureOn('insights') ? [['insights', strings.adminInsights] as const] : []),
  ['audit', strings.adminAudit],
]

const settingsSection = (life: Lifetime): HTMLElement => {
  const settings = signal<Settings | null>(null)
  launch(T.map((loaded: Settings) => settings.set(loaded))(api['admin.settings.get']({})))
  return region(life, [settings], () => {
    const loaded = settings.get()
    return loaded === null ? loading() : settingsForm(life, loaded)
  })
}

const settingsForm = (life: Lifetime, settings: Settings): HTMLElement => {
  const problem = signal<string | null>(null)
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
  const flow = answeringFlowEditor(life, settings.answeringFlow ?? null, problem)
  const features = featureSwitchesEditor(life, settings.features ?? {})
  return h(
    'form',
    {
      class: 'form',
      on: {
        submit: (event) => {
          event.preventDefault()
          problem.set(null)
          launch(
            T.tapError((error: ApiError) => T.sync(() => problem.set(error.message)))(
              saveSettings({
                allowedDomains: domains.value
                  .split(/[\s,]+/)
                  .map((domain) => domain.trim().toLowerCase())
                  .filter((domain) => domain !== ''),
                contactMode: mode.value === 'contacts' ? 'contacts' : 'open',
                auditRetentionDays: retention.value === '' ? null : Number(retention.value),
                ...(featureOn('answeringFlow') && { answeringFlow: flow.value() }),
                features: features.value(),
              }),
            ),
            () => notice.set({ kind: 'info', text: strings.saved }),
          )
        },
      },
    },
    field(strings.allowedDomains, domains, strings.allowedDomainsHint),
    field(strings.contactMode, mode),
    field(strings.auditRetention, retention, strings.auditRetentionHint),
    featureOn('answeringFlow') && flow.section,
    features.section,
    h('button', { type: 'submit', class: 'primary' }, strings.save),
  )
}

/** Admin → Settings → Features: one row per optional feature, with a switch and what people lose without it. */
const featureSwitchesEditor = (
  life: Lifetime,
  saved: Readonly<Record<string, boolean>>,
): { readonly section: HTMLElement; readonly value: () => Record<string, boolean> } => {
  const switches = signal(featureSwitches(saved))
  const section = h(
    'fieldset',
    { class: 'features' },
    h('legend', {}, strings.features.title),
    h('p', {}, strings.features.intro),
    region(life, [switches], () =>
      h(
        'ol',
        { class: 'todo-list feature-list', 'aria-label': strings.features.title },
        FEATURE_NAMES.map((name) => {
          const on = switches.get()[name]
          return h(
            'li',
            { class: `todo-row feature-row${on ? '' : ' is-off'}`, data: { name } },
            h(
              'button',
              {
                type: 'button',
                class: 'todo-switch',
                role: 'switch',
                'aria-checked': String(on),
                'aria-label': strings.features.names[name],
                on: { click: () => switches.update((all) => ({ ...all, [name]: !on })) },
              },
              h('span', { class: 'todo-check', 'aria-hidden': 'true' }, on ? '✓' : ''),
            ),
            h(
              'div',
              { class: 'todo-main' },
              h('strong', {}, strings.features.names[name]),
              h('small', { class: 'feature-loss' }, strings.features.whenOff[name]),
            ),
          )
        }),
      ),
    ),
    h('p', { class: 'trust-footnote' }, strings.features.core),
  )
  return { section, value: () => ({ ...switches.get() }) }
}

/** The answering flow as two to-do lists: steps before drafting and checks on the draft, each switchable. */
const answeringFlowEditor = (
  life: Lifetime,
  saved: string | null,
  problem: Signal<string | null>,
): { readonly section: HTMLElement; readonly value: () => string | null } => {
  const steps = signal<ReadonlyArray<FlowStep>>(stepsFrom(saved))
  const keys = new WeakMap<FlowStep, string>()
  let next = 0
  const keyOf = (step: FlowStep): string => {
    if (!keys.has(step)) keys.set(step, `step-${next++}`)
    return keys.get(step)!
  }
  const stepWith = (key: string): FlowStep | undefined => steps.get().find((step) => keyOf(step) === key)
  const replace = (key: string, change: Partial<FlowStep>): void =>
    steps.update((all) => all.map((step) => (keyOf(step) === key ? { ...step, ...change } : step)))
  const list = (part: FlowStep['part']): HTMLElement => {
    const mine = steps.get().filter((step) => step.part === part)
    return todoList({
      label: part === 'before' ? strings.answeringFlow.beforeTitle : strings.answeringFlow.checksTitle,
      rows: mine.map((step) => ({
        key: keyOf(step),
        name: step.text,
        enabled: step.enabled,
        fields: [
          {
            name: 'text',
            label: strings.answeringFlow.stepLabel,
            value: step.text,
            maxLength: ANSWERING_FLOW_MAX_CHARACTERS,
            wide: true,
          },
        ],
      })),
      toggle: (key, enabled) => replace(key, { enabled }),
      edit: (key, _, text) => replace(key, { text }),
      move: (key, to) => {
        const step = stepWith(key)
        if (step !== undefined) steps.set(moveStep(steps.get(), step, to))
      },
      remove: (key) => steps.update((all) => all.filter((step) => keyOf(step) !== key)),
      add: {
        label: strings.answeringFlow.addStep,
        fields: [
          {
            name: 'text',
            label: strings.answeringFlow.stepLabel,
            value: '',
            maxLength: ANSWERING_FLOW_MAX_CHARACTERS,
            placeholder: strings.answeringFlow.stepPlaceholder,
            wide: true,
          },
        ],
        submit: (values, done) => {
          const text = values.text ?? ''
          if (text === '') return
          const added: FlowStep = { part, text, enabled: true }
          steps.set(moveStep([...steps.get(), added], added, Number.POSITIVE_INFINITY))
          done()
        },
      },
    })
  }
  const example = h('button', {
    type: 'button',
    class: 'insert-example',
    'aria-describedby': 'example-reason',
  })
  example.textContent = strings.answeringFlow.insertExample
  example.addEventListener('click', () => {
    if (mayInsertExample(steps.get())) steps.set(stepsFrom(strings.answeringFlow.example))
  })
  const section = h(
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
    region(life, [steps, problem], () => {
      const size = flowSize(steps.get())
      example.disabled = !mayInsertExample(steps.get())
      return [
        h('h3', { class: 'flow-list-title' }, strings.answeringFlow.beforeTitle),
        list('before'),
        h('h3', { class: 'flow-list-title' }, strings.answeringFlow.checksTitle),
        list('checks'),
        problem.get() !== null && h('p', { class: 'flow-problem', role: 'alert' }, problem.get()),
        h(
          'div',
          { class: 'flow-tools' },
          h(
            'small',
            { class: `flow-count${size.over ? ' is-over' : ''}`, 'aria-live': 'polite' },
            strings.answeringFlow.counter({ used: size.used, max: size.max }),
            ' · ',
            strings.answeringFlow.stepsCounter({ steps: size.steps, max: size.maxSteps }),
          ),
          h(
            'span',
            { class: 'disabled-control' },
            example,
            h(
              'small',
              { id: 'example-reason', hidden: !example.disabled },
              strings.answeringFlow.exampleNeedsEmpty,
            ),
          ),
        ),
      ]
    }),
  )
  return { section, value: () => flowToSave(steps.get()) }
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
    if (listed === null) return loading()
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
                  featureOn('characters') &&
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
  const failed = signal(false)
  const load = (): void => {
    failed.set(false)
    launch(T.tapError((_: ApiError) => T.sync(() => failed.set(true)))(loadChannels('')))
  }
  load()
  return region(life, [channels, channelsLoaded, failed], () => {
    if (!channelsLoaded.get()) return failed.get() ? loadFailed(load) : loading()
    if (channels.get().length === 0) return empty(strings.adminNoChannels)
    return h(
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
    )
  })
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
  const log = signal<{
    readonly entries: ReadonlyArray<AuditEntry>
    readonly hasMore: boolean
    readonly status: 'loading' | 'loaded' | 'failed'
  }>({ entries: [], hasMore: true, status: 'loading' })
  const loadMore = (): void => {
    const oldest = log.get().entries.at(-1)?.id
    log.update((current) => ({ ...current, status: 'loading' }))
    launch(
      T.tapError((_: ApiError) => T.sync(() => log.update((current) => ({ ...current, status: 'failed' }))))(
        T.map((page: { entries: ReadonlyArray<AuditEntry>; hasMore: boolean }) =>
          log.update((current) => ({
            entries: [...current.entries, ...page.entries],
            hasMore: page.hasMore,
            status: 'loaded',
          })),
        )(api['admin.audit.list']({ query: oldest === undefined ? {} : { before: String(oldest) } })),
      ),
    )
  }
  loadMore()
  return region(life, [log, knownMembers], () => {
    const { entries, hasMore, status } = log.get()
    if (entries.length === 0 && status !== 'loaded')
      return status === 'failed' ? loadFailed(loadMore) : loading()
    return [
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
          h('tbody', {}, entries.map(auditRow)),
        ),
      ),
      status === 'failed'
        ? loadFailed(loadMore)
        : hasMore && status === 'loaded' && button(strings.loadMore, loadMore, { class: 'load-older' }),
    ]
  })
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
