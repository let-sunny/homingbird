import type { AsRead, CredentialId, DebateExportFormat } from '@homingbird/protocol'
import { type Child, type Lifetime, h, lifetime, linkedText, region } from '@homingbird/ui'
import type { QuotedTurn } from '../models/debate-credit.ts'
import { type DebateRoomModel, debateRoomModel, resultDestination } from '../models/debate-room.ts'
import type { Turn, TurnGroup } from '../models/debate-turn-list.ts'
import { type DebateTab, hrefFor } from '../routes.ts'
import { locale, strings } from '../strings.ts'
import { authorButton } from './author-details.ts'
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
import { citedBody } from './note-body.ts'
import { participantsCount, participantsList } from './participants.ts'
import { emptyWithPip, field, loading, page, privateMarkOf, timeLabel } from './parts.ts'

/**
 * One debate room, one short tab at a time, each its own address: the result the agents settled, how they
 * voted, what each contributed, and the turns as they come. Changing tabs keeps the room drawn while it is
 * read again. An address naming a turn brings that turn into view once the room is drawn.
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
  const drawn = lifetime()
  life.add(drawn.end)
  let focusPending = true
  return region(
    life,
    [state.shownDebate, state.members, state.agentCredentials, state.serverInfo],
    () => {
      drawn.end()
      const model = debateRoomModel({
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
      const view = renderDebateRoom(model, context, drawn)
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

const renderDebateRoom = (model: DebateRoomModel, context: ViewContext, drawn: Lifetime): HTMLElement => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'missing')
    return emptyWithPip(
      'failed',
      model.text,
      h('a', { class: 'button', href: hrefFor({ name: 'debates' }) }, strings.debates.allRooms),
    )
  return page(
    model.question,
    h(
      'p',
      { class: `debate-meta is-${model.stage}` },
      h('span', { class: 'debate-stage' }, model.stageText),
      model.isPrivate && privateMarkOf(strings.debates.private, strings.debates.privateSeenBy),
      model.isPrivate && h('span', { class: 'hint' }, strings.debates.privateSeenBy),
      model.closesAt !== null && h('span', {}, model.closesAt),
      model.people.people.length > 0 && participantsCount(model.people),
    ),
    participantsList(model.people),
    model.tabs.length > 1 &&
      h(
        'nav',
        { class: 'subtabs debate-tabs', 'aria-label': strings.debates.tabsLabel },
        model.tabs.map((tab) =>
          h(
            'a',
            { href: tab.href, 'aria-current': tab.current && 'page', data: { tab: tab.tab } },
            tab.label,
          ),
        ),
      ),
    h('div', { class: `debate-tab is-${model.shown}` }, ...tabContent(model, context, drawn)),
  )
}

const tabContent = (model: Room, context: ViewContext, drawn: Lifetime): ReadonlyArray<Child> => {
  switch (model.shown) {
    case 'result':
      return resultTab(model, context, drawn)
    case 'votes':
      return votesTab(model)
    case 'credit':
      return creditTab(model)
    case 'turns':
      return turnsTab(model, context, drawn)
  }
}

const resultTab = (model: Room, context: ViewContext, drawn: Lifetime): ReadonlyArray<Child> => [
  model.ended !== null && section(strings.debates.resultTitle, 'debate-result', h('p', {}, model.ended)),
  model.result !== null && resultSection(model.result),
  model.moved.length > 0 &&
    section(
      strings.debates.movedTitle,
      'debate-moved',
      h(
        'ul',
        { class: 'debate-moves' },
        model.moved.map((move) =>
          h('li', { data: { member: move.memberId } }, h('p', {}, citedText(move.text)), movedBetween(move)),
        ),
      ),
    ),
  model.closed !== null && h('p', { class: 'hint debate-closed-hint' }, strings.debates.closedHint),
  model.closed?.mayPost === true &&
    section(strings.debates.sendTitle, 'debate-send', postForm(context, model.debate, model.closed)),
  model.closed !== null &&
    section(
      strings.debates.exportTitle,
      'debate-export',
      h(
        'div',
        { class: 'debate-exports' },
        exportButton(context, model.debate, 'markdown', strings.debates.exportMarkdown),
        exportButton(context, model.debate, 'json', strings.debates.exportJson),
        h('small', {}, strings.debates.exportAudited),
      ),
    ),
  model.drafts !== null &&
    section(
      strings.debates.draftsTitle,
      'debate-drafts',
      h(
        'ol',
        { class: 'debate-draft-list' },
        model.drafts.map((draft) =>
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
    ),
]

const votesTab = ({ votes }: Room): ReadonlyArray<Child> => [
  section(
    strings.debates.voteRecordTitle,
    'debate-votes',
    votes.voting !== null && h('p', { class: 'debate-voting' }, votes.voting),
    votes.record !== null && renderVoteRecord(votes.record),
  ),
]

const creditTab = ({ credit }: Room): ReadonlyArray<Child> => [
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
          h('strong', {}, row.name),
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
  ),
]

/** The start of the turn an agent moved from and of the turn it moved in. */
const movedBetween = (move: { readonly from: QuotedTurn; readonly to: QuotedTurn }): HTMLElement =>
  h(
    'dl',
    { class: 'debate-moved-between' },
    [move.from, move.to].map((turn) => [h('dt', {}, turn.label), h('dd', {}, turn.excerpt)]),
  )

const turnsTab = (model: Room, context: ViewContext, drawn: Lifetime): ReadonlyArray<Child> => [
  model.optIn !== null && optInSection(context, model.debate, model.optIn),
  section(
    strings.debates.participantsTitle,
    'debate-participants',
    model.participants.length === 0
      ? h('p', {}, strings.debates.noParticipants)
      : h(
          'ul',
          {},
          model.participants.map((participant) =>
            h(
              'li',
              { data: { member: participant.memberId } },
              h('span', {}, participant.name),
              participant.turnsLeft !== null && h('small', {}, participant.turnsLeft),
              participant.droppedOut !== null &&
                h('small', { class: 'debate-dropped-out' }, participant.droppedOut),
            ),
          ),
        ),
    h('p', { class: 'debate-limits-summary' }, model.limits),
    h('p', { class: 'debate-grace-summary' }, model.grace),
    model.mayChangeLimits && limitsForm(context, model.debate),
    model.limitsFixed && h('p', { class: 'hint debate-limits-fixed' }, strings.debates.limitsFixed),
  ),
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

const limitsForm = (context: ViewContext, debate: AsRead.Debate): HTMLElement => {
  const form: HTMLFormElement = h(
    'form',
    {
      class: 'debate-limits-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const typed = limitsTypedIn(form)
          if ('problem' in typed) return context.state.notice.set({ kind: 'error', text: typed.problem })
          context.actions.changeLimits(debate.id, typed.limits)
        },
      },
    },
    limitFields(debate.limits),
    h('button', { type: 'submit' }, strings.debates.saveLimits),
  )
  return h('details', { class: 'debate-change-limits' }, h('summary', {}, strings.debates.changeLimits), form)
}

const optInSection = (
  context: ViewContext,
  debate: AsRead.Debate,
  optIn: NonNullable<Room['optIn']>,
): HTMLElement => {
  if (optIn.kind === 'no-agent')
    return section(strings.debates.optInTitle, 'debate-opt-in', h('p', {}, optIn.text))
  const choice = h(
    'select',
    { name: 'agent' },
    optIn.agents.map((agent) => h('option', { value: agent.value }, agent.label)),
  )
  return section(
    strings.debates.optInTitle,
    'debate-opt-in',
    h('p', { class: 'hint' }, strings.debates.optInHint),
    h(
      'form',
      {
        class: 'debate-opt-in-form',
        on: {
          submit: (event) => {
            event.preventDefault()
            const agent = optIn.agents.find((one) => one.value === choice.value)
            if (agent !== undefined) context.actions.optInAgent(debate.id, agent.value as CredentialId)
          },
        },
      },
      field(strings.debates.chooseAgent, choice),
      h('button', { type: 'submit', class: 'primary' }, strings.debates.optIn),
    ),
  )
}

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
): HTMLElement => {
  const choices = (options: ReadonlyArray<{ readonly value: string; readonly label: string }>) => [
    h('option', { value: '' }, strings.debates.choose),
    options.map((option) => h('option', { value: option.value }, option.label)),
  ]
  const channel = h('select', { name: 'channel' }, choices(closed.channels))
  const person = h('select', { name: 'person' }, choices(closed.people))
  const problem = h('p', { class: 'debate-post-problem', role: 'alert' })
  return h(
    'form',
    {
      class: 'debate-post-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const destination = resultDestination(channel.value, person.value)
          if (destination === null) {
            problem.textContent = closed.chooseFirst
            return channel.focus()
          }
          context.actions.postResult(debate.id, destination, {
            done: (draft) =>
              context.page.go(hrefFor({ name: 'conversation', id: draft.conversationId, draft: null })),
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
