import type { AsRead, CredentialId, DebateExportFormat } from '@homingbird/protocol'
import {
  type Child,
  type Lifetime,
  type ReadableSignal,
  h,
  linkedText,
  region,
  signal,
  slice,
} from '@homingbird/ui'
import { featureOn } from '../features.ts'
import type { QuotedTurn } from '../models/debate-credit.ts'
import {
  type BriefField,
  type DebateRoomModel,
  debateRoomModel,
  resultDestination,
} from '../models/debate-room.ts'
import type { Turn, TurnGroup } from '../models/debate-turn-list.ts'
import { type SchedulingRoomModel, roomKindOf, schedulingRoomModel } from '../models/scheduling-room.ts'
import { type DebateTab, hrefFor } from '../routes.ts'
import { locale, strings } from '../strings.ts'
import { authorButton } from './author-details.ts'
import { type Block, blocks } from './blocks.ts'
import type { ViewContext } from './context.ts'
import {
  citedText,
  creditBadge,
  renderResultBody,
  renderVoteRecord,
  resultSection,
  section,
} from './debate-result.ts'
import { limitFields, limitsTypedIn } from './debates.ts'
import { hinted } from './hint.ts'
import { citedBody } from './note-body.ts'
import { participantsCount, participantsList } from './participants.ts'
import {
  type Unsaved,
  chosenIn,
  emptyWithPip,
  field,
  forgetTyped,
  keepChoice,
  keepOpen,
  keepTyped,
  loading,
  page,
  privateMarkOf,
  timeLabel,
} from './parts.ts'
import { profileName } from './profile-card.ts'
import { schedulingCards } from './scheduling-cards.ts'
import { renderSchedulingRoom } from './scheduling-room.ts'

/**
 * One flock, one short tab at a time, each its own address: the result the agents settled, how they
 * voted, what each contributed, and the turns as they come. Changing tabs keeps the flock drawn while it is
 * read again, and drawing it again keeps what the person typed, chose or unfolded. An address naming a turn
 * brings that turn into view once the flock is drawn.
 */
export const debateView = (
  context: ViewContext,
  life: Lifetime,
  me: AsRead.Me,
  id: string,
  tab: DebateTab | null,
  turn: number | null = null,
): HTMLElement => {
  const { state, actions } = context
  const held = state.shownDebate.get()
  if (held === null || held === 'missing' || held.id !== id) state.shownDebate.set(null)
  actions.loadDebate(id)
  let focusPending = true
  const pickedHours = signal<ReadonlySet<number> | null>(null)
  const showsAllHours = signal(false)
  if (state.debateUnsaved.get().id !== id) state.debateUnsaved.set({ id, typed: new Map() })
  const unsaved: Unsaved = state.debateUnsaved.get().typed
  const roomNow = (): DebateRoomModel =>
    debateRoomModel({
      debate: state.shownDebate.get(),
      tab,
      turn,
      viewerId: me.member.id,
      members: state.members.get(),
      agents: state.agentCredentials.get(),
      channels: state.channels.get(),
      directory: state.directory.get(),
      serverInfo: state.serverInfo.get(),
      now: context.clock.now(),
    })
  const sources = [
    state.shownDebate,
    state.members,
    state.agentCredentials,
    state.channels,
    state.serverInfo,
    state.directory,
  ]
  const room = slice(sources, roomNow)
  const schedulingNow = (): SchedulingRoomModel =>
    schedulingRoomModel({
      debate: state.shownDebate.get() as AsRead.Debate,
      viewerId: me.member.id,
      enabled: featureOn('schedulingRooms', state.serverInfo.get()),
      members: state.members.get(),
      timeZone: context.page.timeZone(),
    })
  const atEachChange = slice(sources, () => [...sources.map((source) => source.get()), context.clock.now()])
  const frame = slice(sources, () =>
    isScheduling(state.shownDebate.get()) ? schedulingFrameOf(schedulingNow()) : frameOf(room.get()),
  )
  return region(
    life,
    [frame],
    (drawn) => {
      if (isScheduling(state.shownDebate.get()))
        return renderSchedulingRoom(drawn, atEachChange, schedulingNow, () => {
          const debate = state.shownDebate.get()
          if (!isScheduling(debate)) return []
          return schedulingCards(context, {
            debate,
            viewerId: me.member.id,
            agents: state.agentCredentials.get(),
            directory: state.directory.get(),
            members: state.members.get(),
            unsaved,
            picked: pickedHours,
            showsAll: showsAllHours,
          })
        })
      const model = room.get()
      const view = renderDebateRoom(model, context, drawn, room, unsaved)
      if (model.kind === 'room' && model.focusTurn !== null && focusPending) {
        focusPending = false
        const cited = `.debate-turn[data-position="${model.focusTurn}"]`
        context.page.nextFrame(() => {
          const shown = view.ownerDocument.querySelector<HTMLElement>(cited)
          shown?.scrollIntoView({ block: 'start' })
          shown?.focus({ preventScroll: true })
        })
      } else if (model.kind === 'room' && model.focusesTab && focusPending) {
        focusPending = false
        context.page.nextFrame(() =>
          view.ownerDocument.querySelector<HTMLElement>(CURRENT_TAB)?.focus({ preventScroll: true }),
        )
      }
      return view
    },
    { class: 'debate-room-host' },
  )
}

const isScheduling = (shown: AsRead.Debate | 'missing' | null): shown is AsRead.Debate =>
  shown !== null && shown !== 'missing' && roomKindOf(shown) !== 'debate'

const schedulingFrameOf = (model: SchedulingRoomModel) =>
  model.kind === 'room' ? { kind: 'scheduling', title: model.title } : model

/** What the page stands on: while it stays the same, only the blocks inside it are drawn again. */
const frameOf = (model: DebateRoomModel) =>
  model.kind === 'room' ? { question: model.question, tabs: model.tabs, shown: model.shown } : model

const renderDebateRoom = (
  model: DebateRoomModel,
  context: ViewContext,
  drawn: Lifetime,
  room: ReadableSignal<DebateRoomModel>,
  unsaved: Unsaved,
): HTMLElement => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'missing')
    return emptyWithPip(
      'failed',
      model.text,
      h('a', { class: 'button', href: hrefFor({ name: 'debates' }) }, strings.debates.allRooms),
    )
  const within = (list: (now: Room) => ReadonlyArray<Block | null>) => () => {
    const now = room.get()
    return now.kind === 'room' ? list(now) : []
  }
  return page(
    model.question,
    blocks(drawn, h('div', { class: 'debate-head' }), room, within(headBlocks)),
    ...tabsWithHints(model, context),
    blocks(
      drawn,
      h('div', { class: `debate-tab is-${model.shown}` }),
      room,
      within((now) => tabBlocks({ ...now, shown: model.shown }, context, room, unsaved)),
    ),
  )
}

const block = (key: string, from: unknown, draw: (drawing: Lifetime) => HTMLElement): Block => ({
  key,
  from,
  draw,
})

const headBlocks = (model: Room): ReadonlyArray<Block | null> => [
  block('meta', [model.stage, model.stageText, model.isPrivate, model.closesAt, model.people], () =>
    h(
      'p',
      { class: `debate-meta is-${model.stage}` },
      h('span', { class: 'debate-stage' }, model.stageText),
      model.isPrivate && privateMarkOf(strings.debates.private, strings.debates.privateSeenBy),
      model.isPrivate && h('span', { class: 'hint' }, strings.debates.privateSeenBy),
      model.closesAt !== null && h('span', {}, model.closesAt),
      model.people.people.length > 0 && participantsCount(model.people),
    ),
  ),
  block('people', model.people, () => participantsList(model.people)),
]

const tabBlocks = (
  model: Room,
  context: ViewContext,
  room: ReadableSignal<DebateRoomModel>,
  unsaved: Unsaved,
): ReadonlyArray<Block | null> => {
  switch (model.shown) {
    case 'result':
      return resultBlocks(model, context, unsaved)
    case 'votes':
      return [block('votes', model.votes, () => votesTab(model))]
    case 'credit':
      return [block('credit', model.credit, () => creditTab(model))]
    case 'turns':
      return turnsBlocks(model, context, room, unsaved)
  }
}

const resultBlocks = (
  { debate, ended, agreedEarly, result, moved, closed, drafts }: Room,
  context: ViewContext,
  unsaved: Unsaved,
): ReadonlyArray<Block | null> => [
  ended === null
    ? null
    : block('ended', ended, () => section(strings.debates.resultTitle, 'debate-result', h('p', {}, ended))),
  agreedEarlyBlock(agreedEarly),
  result === null ? null : block('result', result, () => resultSection(result)),
  moved.length === 0
    ? null
    : block('moved', moved, () =>
        section(
          strings.debates.movedTitle,
          'debate-moved',
          h(
            'ul',
            { class: 'debate-moves' },
            moved.map((move) =>
              h(
                'li',
                { data: { member: move.memberId } },
                h('p', {}, citedText(move.text)),
                movedBetween(move),
              ),
            ),
          ),
        ),
      ),
  closed === null
    ? null
    : block('closed', null, () => h('p', { class: 'hint debate-closed-hint' }, strings.debates.closedHint)),
  closed?.answeredBy == null
    ? null
    : block('answered-by', closed.answeredBy, () =>
        h('p', { class: 'hint debate-answered-by' }, closed.answeredBy),
      ),
  closed?.mayPost === true
    ? block('post', [debate.id, closed.channels, closed.people], () =>
        section(strings.debates.sendTitle, 'debate-send', postForm(context, debate, closed, unsaved)),
      )
    : null,
  closed === null
    ? null
    : block('export', debate.id, () =>
        section(
          strings.debates.exportTitle,
          'debate-export',
          h(
            'div',
            { class: 'debate-exports' },
            exportButton(context, debate, 'markdown', strings.debates.exportMarkdown),
            exportButton(context, debate, 'json', strings.debates.exportJson),
            h('small', {}, strings.debates.exportAudited),
          ),
        ),
      ),
  drafts === null ? null : block('drafts', drafts, (drawing) => draftsSection(drafts, context, drawing)),
]

const agreedEarlyBlock = (text: string | null): Block | null =>
  text === null ? null : block('agreed-early', text, () => h('p', { class: 'debate-agreed-early' }, text))

const draftsSection = (
  drafts: NonNullable<Room['drafts']>,
  context: ViewContext,
  drawn: Lifetime,
): HTMLElement =>
  section(
    strings.debates.draftsTitle,
    'debate-drafts',
    h(
      'ol',
      { class: 'debate-draft-list' },
      drafts.map((draft) =>
        h(
          'li',
          { class: `debate-draft ${draft.chosen ? 'is-chosen' : ''}`, data: { member: draft.memberId } },
          h(
            'details',
            {},
            h(
              'summary',
              { class: 'debate-draft-head' },
              h('strong', {}, draft.title),
              draft.votes !== null && h('span', { class: 'debate-draft-votes' }, draft.votes),
              draft.chosen && h('span', { class: 'debate-draft-chosen' }, strings.debates.chosen),
              timeLabel(draft.time),
            ),
            h('div', { class: 'debate-draft-author' }, authorButton(context, drawn, draft.details)),
            draft.chosen && h('p', { class: 'hint' }, strings.debates.chosenHint),
            ...renderResultBody(draft.body, { contributions: true }),
          ),
        ),
      ),
    ),
  )

const votesTab = ({ votes }: Room): HTMLElement =>
  section(
    strings.debates.voteRecordTitle,
    'debate-votes',
    votes.voting !== null && h('p', { class: 'debate-voting' }, votes.voting),
    votes.record !== null && renderVoteRecord(votes.record),
  )

const creditTab = ({ credit }: Room): HTMLElement =>
  section(
    strings.debates.contributions,
    'debate-credit-list',
    credit?.shared != null && h('p', { class: 'hint debate-shared-credits' }, credit.shared),
    h(
      'ul',
      { class: 'debate-contributions' },
      (credit?.rows ?? []).map((row) =>
        h(
          'li',
          { class: 'debate-credit-row', data: { member: row.memberId } },
          h('strong', {}, profileName(row.memberId, row.name)),
          row.summary !== null && h('span', {}, citedText(row.summary)),
          ...row.credits.map(creditBadge),
          h(
            'p',
            { class: 'debate-credit-turns' },
            ...citedText(row.turns),
            row.filler !== null && ` ${row.filler}`,
          ),
          row.positionChange !== null &&
            h(
              'div',
              { class: 'debate-position-change' },
              h('p', {}, citedText(row.positionChange.text)),
              movedBetween(row.positionChange),
            ),
          row.keptSteps.length > 0 &&
            h(
              'div',
              { class: 'debate-kept-steps' },
              h('small', {}, strings.debates.keptSteps),
              h(
                'ul',
                {},
                row.keptSteps.map((step) => h('li', {}, h('span', {}, citedText(step)))),
              ),
            ),
        ),
      ),
    ),
  )

/** The start of the turn an agent moved from and of the turn it moved in. */
const movedBetween = (move: { readonly from: QuotedTurn; readonly to: QuotedTurn }): HTMLElement =>
  h(
    'dl',
    { class: 'debate-moved-between' },
    [move.from, move.to].map((turn) => [h('dt', {}, turn.label), h('dd', {}, turn.excerpt)]),
  )

/**
 * Opting in first when the person may, then who is in the room and whose turn it is, then the turns; the
 * room's rules and the person's note for their agent come last, folded away.
 */
const turnsBlocks = (
  model: Room,
  context: ViewContext,
  room: ReadableSignal<DebateRoomModel>,
  unsaved: Unsaved,
): ReadonlyArray<Block | null> => {
  const { optIn, waitingFor, agreedEarly, participants } = model
  return [
    optIn === null
      ? null
      : block('opt-in', [model.debate.id, { ...optIn, notAwake: null }], (drawing) =>
          optInSection(context, drawing, model.debate, optIn, room, unsaved),
        ),
    block('participants', [waitingFor, agreedEarly, participants], () =>
      section(
        strings.debates.participantsTitle,
        'debate-participants',
        waitingFor !== null && h('p', { class: 'debate-waiting-for' }, waitingFor),
        agreedEarly !== null && h('p', { class: 'debate-agreed-early' }, agreedEarly),
        participants.length === 0
          ? h('p', {}, strings.debates.noParticipants)
          : h(
              'ul',
              {},
              participants.map((participant) =>
                h(
                  'li',
                  { data: { member: participant.memberId } },
                  h('span', {}, profileName(participant.memberId, participant.name)),
                  participant.turnsLeft !== null && h('small', {}, participant.turnsLeft),
                  participant.droppedOut !== null &&
                    h('small', { class: 'debate-dropped-out' }, participant.droppedOut),
                  participant.ready !== null && h('small', { class: 'debate-ready' }, participant.ready),
                ),
              ),
            ),
      ),
    ),
    block('turns', model.turns, (drawn) =>
      section(
        strings.debates.turnsTitle,
        'debate-turns',
        ...(model.turns.kind === 'none'
          ? [h('p', {}, model.turns.text)]
          : [
              h(
                'p',
                { class: 'debate-turn-times' },
                h('span', { class: 'debate-turns-taken' }, model.turns.taken),
                h('span', {}, model.turns.timing),
              ),
              h(
                'ol',
                { class: 'debate-turn-list', 'aria-live': 'polite' },
                model.turns.groups.map((group) => turnGroup(group, context, drawn)),
              ),
            ]),
      ),
    ),
    block('settings', null, (drawing) =>
      keepOpen(
        unsaved,
        'settings',
        blocks(drawing, h('details', { class: 'debate-settings' }), room, () => {
          const now = room.get()
          return now.kind === 'room' ? settingsBlocks(now, context, room, unsaved) : []
        }),
      ),
    ),
  ]
}

const settingsBlocks = (
  { debate, brief }: Room,
  context: ViewContext,
  room: ReadableSignal<DebateRoomModel>,
  unsaved: Unsaved,
): ReadonlyArray<Block | null> => [
  block('title', null, () => h('summary', {}, strings.debates.settingsTitle)),
  brief === null
    ? null
    : block('brief', [debate.id, brief], () => briefSection(context, debate, brief, unsaved)),
  block('rules', null, (drawing) =>
    blocks(drawing, h('div', { class: 'debate-rules' }), room, () => {
      const now = room.get()
      return now.kind === 'room' ? ruleBlocks(now, context, unsaved) : []
    }),
  ),
]

const ruleBlocks = (
  { debate, readyHint, limits, grace, mayChangeLimits, limitsFixed }: Room,
  context: ViewContext,
  unsaved: Unsaved,
): ReadonlyArray<Block | null> => [
  readyHint === null
    ? null
    : block('ready', readyHint, () => h('p', { class: 'debate-ready-hint' }, readyHint)),
  block('limits', limits, () => h('p', { class: 'debate-limits-summary' }, limits)),
  block('grace', grace, () => h('p', { class: 'debate-grace-summary' }, grace)),
  mayChangeLimits
    ? block('change-limits', [debate.id, debate.limits], () => limitsForm(context, debate, unsaved))
    : null,
  limitsFixed
    ? block('fixed', null, () => h('p', { class: 'debate-limits-fixed' }, strings.debates.limitsFixed))
    : null,
]

const turnGroup = (group: TurnGroup, context: ViewContext, drawn: Lifetime): HTMLElement =>
  group.kind === 'turn'
    ? turnItem(group.turn, context, drawn)
    : h(
        'li',
        { class: 'debate-quiet-turns' },
        h(
          'details',
          { ...(group.open && { open: true }) },
          h('summary', {}, group.label),
          h(
            'ol',
            { class: 'debate-turn-list' },
            group.turns.map((turn) => turnItem(turn, context, drawn)),
          ),
        ),
      )

const turnItem = (turn: Turn, context: ViewContext, drawn: Lifetime): HTMLElement =>
  h(
    'li',
    {
      class: [
        'debate-turn',
        turn.mine && 'is-mine',
        turn.filler !== null && 'is-filler',
        turn.focused && 'is-cited',
      ]
        .filter(Boolean)
        .join(' '),
      id: `turn-${turn.position}`,
      data: { position: String(turn.position) },
      ...(turn.focused && { tabindex: '-1' }),
    },
    h(
      'header',
      { class: 'debate-turn-head' },
      h('span', { class: 'debate-turn-number' }, turn.label),
      h(
        'span',
        { class: 'debate-turn-author' },
        authorButton(context, drawn, turn.details),
        h('strong', {}, turn.author),
      ),
      turn.changedPosition !== null &&
        h('span', { class: 'debate-turn-mark is-moved' }, turn.changedPosition),
      turn.filler !== null && h('span', { class: 'debate-turn-mark' }, turn.filler),
      timeLabel(turn.time),
    ),
    citedBody(context, turn.body, 'debate-turn-body'),
  )

const limitsForm = (context: ViewContext, debate: AsRead.Debate, unsaved: Unsaved): HTMLElement => {
  const form: HTMLFormElement = h(
    'form',
    {
      class: 'debate-limits-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const typed = limitsTypedIn(form)
          if ('problem' in typed) return context.state.notice.set({ kind: 'error', text: typed.problem })
          const saved = controls.map((control) => [control.name, control.value] as const)
          context.actions.changeLimits(debate.id, typed.limits, {
            done: () => {
              for (const [name, value] of saved) forgetTyped(unsaved, `limits ${name}`, value)
            },
          })
        },
      },
    },
    limitFields(debate.limits),
    h('button', { type: 'submit' }, strings.debates.saveLimits),
  )
  const controls = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')]
  for (const control of controls) keepTyped(unsaved, `limits ${control.name}`, control, control.value)
  return keepOpen(
    unsaved,
    'change limits',
    h('details', { class: 'debate-change-limits' }, h('summary', {}, strings.debates.changeLimits), form),
  )
}

const optInSection = (
  context: ViewContext,
  drawn: Lifetime,
  debate: AsRead.Debate,
  optIn: NonNullable<Room['optIn']>,
  room: ReadableSignal<DebateRoomModel>,
  unsaved: Unsaved,
): HTMLElement => {
  if (optIn.kind === 'no-agent')
    return section(strings.debates.optInTitle, 'debate-opt-in', h('p', {}, optIn.text))
  const choice = h(
    'select',
    { name: 'agent' },
    optIn.agents.map((agent) => h('option', { value: agent.value }, agent.label)),
  )
  keepChoice(unsaved, 'opt-in agent', choice)
  const notAwake = slice([room], () => {
    const now = room.get()
    return now.kind === 'room' && now.optIn?.kind === 'choose' ? now.optIn.notAwake : null
  })
  const brief = briefBox(optIn.brief)
  keepTyped(unsaved, 'opt-in brief', brief, optIn.brief.value)
  return section(
    strings.debates.optInTitle,
    'debate-opt-in',
    region(
      drawn,
      [notAwake],
      () => notAwake.get() !== null && h('p', { class: 'advice debate-not-awake' }, notAwake.get()),
      { class: 'debate-not-awake-host' },
    ),
    h('p', { class: 'hint' }, strings.debates.optInHint),
    keepOpen(
      unsaved,
      'opt-in advice',
      h(
        'details',
        { class: 'debate-opt-in-advice' },
        h('summary', {}, strings.debates.optInAdviceTitle),
        h('p', { class: 'hint' }, strings.debates.optInAdvice),
      ),
    ),
    h(
      'form',
      {
        class: 'debate-opt-in-form',
        on: {
          submit: (event) => {
            event.preventDefault()
            const chosen = chosenIn(context, choice)
            const agent = optIn.agents.find((one) => one.value === chosen)
            if (agent === undefined) return
            const saved = brief.value
            context.actions.optInAgent(debate.id, agent.value as CredentialId, saved, {
              done: () => {
                forgetTyped(unsaved, 'opt-in agent', agent.value)
                forgetTyped(unsaved, 'opt-in brief', saved)
              },
            })
          },
        },
      },
      field(strings.debates.chooseAgent, choice),
      field(optIn.brief.label, brief, optIn.brief.hint),
      h('button', { type: 'submit', class: 'primary' }, strings.debates.optIn),
    ),
  )
}

/** The participant's own note on what their agent may use here: a form while turns go on, then text. */
const briefSection = (
  context: ViewContext,
  debate: AsRead.Debate,
  brief: NonNullable<Room['brief']>,
  unsaved: Unsaved,
) => {
  if (brief.kind === 'fixed')
    return section(
      brief.title,
      'debate-brief',
      h('p', { class: 'debate-brief-text' }, brief.text),
      h('p', { class: 'hint' }, brief.fixed),
    )
  const box = briefBox(brief.field)
  keepTyped(unsaved, 'brief', box, brief.field.value)
  return section(
    brief.title,
    'debate-brief',
    h(
      'form',
      {
        class: 'debate-brief-form',
        on: {
          submit: (event) => {
            event.preventDefault()
            const saved = box.value
            context.actions.setBrief(debate.id, saved, {
              done: () => {
                forgetTyped(unsaved, 'brief', saved)
                context.state.notice.set({ kind: 'info', text: strings.debates.briefSaved })
              },
            })
          },
        },
      },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label visually-hidden' }, brief.field.label),
        box,
        h('small', {}, brief.field.hint),
      ),
      h('button', { type: 'submit' }, brief.save),
    ),
  )
}

const briefBox = (brief: BriefField): HTMLTextAreaElement =>
  h('textarea', {
    name: 'brief',
    rows: '4',
    maxlength: String(brief.maxLength),
    placeholder: brief.placeholder,
  })

const exportButton = (
  context: ViewContext,
  debate: AsRead.Debate,
  format: DebateExportFormat,
  label: string,
): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: `export-${format}`,
      on: {
        click: () => context.actions.exportDebate(debate.id, format, locale, { done: context.page.download }),
      },
    },
    label,
  )

const postForm = (
  context: ViewContext,
  debate: AsRead.Debate,
  closed: NonNullable<Room['closed']>,
  unsaved: Unsaved,
): HTMLElement => {
  const choices = (options: ReadonlyArray<{ readonly value: string; readonly label: string }>) => [
    h('option', { value: '' }, strings.debates.choose),
    options.map((option) => h('option', { value: option.value }, option.label)),
  ]
  const channel = h('select', { name: 'channel' }, choices(closed.channels))
  const person = h('select', { name: 'person' }, choices(closed.people))
  keepChoice(unsaved, 'post channel', channel)
  keepChoice(unsaved, 'post person', person)
  const problem = h('p', { class: 'debate-post-problem', role: 'alert' })
  return h(
    'form',
    {
      class: 'debate-post-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const toChannel = chosenIn(context, channel)
          if (toChannel === null) return
          const toPerson = chosenIn(context, person)
          if (toPerson === null) return
          const destination = resultDestination(toChannel, toPerson)
          if (destination === null) {
            problem.textContent = closed.chooseFirst
            return channel.focus()
          }
          context.actions.postResult(debate.id, destination, {
            done: (draft) => {
              forgetTyped(unsaved, 'post channel', channel.value)
              forgetTyped(unsaved, 'post person', person.value)
              context.page.go(hrefFor({ name: 'conversation', id: draft.conversationId, draft: null }))
            },
          })
        },
      },
    },
    h('p', { class: 'hint' }, strings.debates.postHint),
    field(strings.debates.postToChannel, channel),
    field(strings.debates.postToPerson, person),
    h('button', { type: 'submit', class: 'primary' }, strings.debates.post),
    problem,
  )
}

const CURRENT_TAB = '.debate-tabs [aria-current="page"]'

type Room = Extract<DebateRoomModel, { kind: 'room' }>

/** The tabs in one row, and the first-visit hints under the row, never between its tabs. */
const tabsWithHints = (model: Room, context: ViewContext): ReadonlyArray<Child> => {
  if (model.tabs.length <= 1) return []
  const hints: HTMLElement[] = []
  const links = model.tabs.map((tab) => {
    const link = h(
      'a',
      { href: tab.href, 'aria-current': tab.current && 'page', data: { tab: tab.tab } },
      tab.label,
    )
    const hint =
      tab.tab === 'turns'
        ? hinted(context, 'debateTurns', strings.hints.debateTurns, link)
        : tab.tab === 'result'
          ? hinted(context, 'debateResult', strings.hints.debateResult, link)
          : null
    if (hint === null) return link
    hints.push(hint[1])
    return hint[0]
  })
  return [
    h('nav', { class: 'subtabs debate-tabs', 'aria-label': strings.debates.tabsLabel }, links),
    ...hints,
  ]
}
