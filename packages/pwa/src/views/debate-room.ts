import type { AsRead, CredentialId, DebateExportFormat } from '@homingbird/protocol'
import { type Child, type Lifetime, h, linkedText, region } from '@homingbird/ui'
import { type DebateRoomModel, debateRoomModel, resultDestination } from '../models/debate-room.ts'
import { hrefFor } from '../routes.ts'
import { locale, strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { renderResultBody, resultSection, section } from './debate-result.ts'
import { limitFields, limitsTypedIn } from './debates.ts'
import { emptyWithPip, field, loading, page, privateMarkOf, timeLabel } from './parts.ts'

/** One debate room: its question, its agents and turns as they come, and the result the agents settled. */
export const debateView = (context: ViewContext, life: Lifetime, me: AsRead.Me, id: string): HTMLElement => {
  const { state, actions } = context
  state.shownDebate.set(null)
  actions.loadDebate(id)
  return region(
    life,
    [state.shownDebate, state.members, state.agentCredentials],
    () =>
      renderDebateRoom(
        debateRoomModel({
          debate: state.shownDebate.get(),
          viewerId: me.member.id,
          members: state.members.get(),
          agents: state.agentCredentials.get(),
          channels: state.channels.get(),
          directory: state.directory.get(),
          now: context.clock.now(),
        }),
        context,
      ),
    { class: 'debate-room-host' },
  )
}

const renderDebateRoom = (model: DebateRoomModel, context: ViewContext): HTMLElement => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'missing')
    return emptyWithPip(
      'failed',
      model.text,
      h('a', { class: 'button', href: hrefFor({ name: 'debates' }) }, strings.debates.allRooms),
    )
  const { debate } = model
  return page(
    model.question,
    h(
      'p',
      { class: `debate-meta is-${model.stage}` },
      h('span', { class: 'debate-stage' }, model.stageText),
      model.isPrivate && privateMarkOf(strings.debates.private, strings.debates.privateSeenBy),
      model.isPrivate && h('span', { class: 'hint' }, strings.debates.privateSeenBy),
      model.closesAt !== null && h('span', {}, model.closesAt),
    ),
    h('p', { class: 'debate-limits-summary' }, model.limits),
    h('p', { class: 'debate-grace-summary' }, model.grace),
    model.mayChangeLimits && limitsForm(context, debate),
    model.limitsFixed && h('p', { class: 'hint debate-limits-fixed' }, strings.debates.limitsFixed),
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
    ),
    model.optIn !== null && optInSection(context, debate, model.optIn),
    section(
      strings.debates.turnsTitle,
      'debate-turns',
      model.turns.kind === 'none'
        ? h('p', {}, model.turns.text)
        : h(
            'ol',
            { class: 'debate-turn-list', 'aria-live': 'polite' },
            model.turns.turns.map((turn) =>
              h(
                'li',
                {
                  class: `debate-turn ${turn.mine ? 'is-mine' : ''}`,
                  data: { position: String(turn.position) },
                },
                h(
                  'header',
                  { class: 'debate-turn-head' },
                  h('strong', {}, turn.author),
                  timeLabel(turn.time),
                ),
                h('p', { class: 'debate-turn-body' }, ...linkedText(turn.body)),
              ),
            ),
          ),
    ),
    model.ended !== null && section(strings.debates.resultTitle, 'debate-result', h('p', {}, model.ended)),
    model.result !== null && resultSection(model.result),
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
                { open: draft.chosen },
                h(
                  'summary',
                  { class: 'debate-draft-head' },
                  h('strong', {}, draft.title),
                  draft.votes !== null && h('span', { class: 'debate-draft-votes' }, draft.votes),
                  draft.chosen && h('span', { class: 'debate-draft-chosen' }, strings.debates.chosen),
                  timeLabel(draft.time),
                ),
                draft.chosen && h('p', { class: 'hint' }, strings.debates.chosenHint),
                ...renderResultBody(draft.body),
              ),
            ),
          ),
        ),
      ),
    model.closed !== null &&
      section(
        strings.debates.postTitle,
        'debate-closed',
        h('p', { class: 'hint' }, strings.debates.closedHint),
        h(
          'div',
          { class: 'debate-exports' },
          exportButton(context, debate, 'markdown', strings.debates.exportMarkdown),
          exportButton(context, debate, 'json', strings.debates.exportJson),
          h('small', {}, strings.debates.exportAudited),
        ),
        model.closed.mayPost && postForm(context, debate, model.closed),
      ),
  )
}

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
  optIn: NonNullable<Extract<DebateRoomModel, { kind: 'room' }>['optIn']>,
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
  closed: NonNullable<Extract<DebateRoomModel, { kind: 'room' }>['closed']>,
): HTMLElement => {
  const choices = (options: ReadonlyArray<{ readonly value: string; readonly label: string }>) => [
    h('option', { value: '' }, strings.debates.choose),
    options.map((option) => h('option', { value: option.value }, option.label)),
  ]
  const channel = h('select', { name: 'channel' }, choices(closed.channels))
  const person = h('select', { name: 'person' }, choices(closed.people))
  return h(
    'form',
    {
      class: 'debate-post-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const destination = resultDestination(channel.value, person.value)
          if (destination === null) return
          context.actions.postResult(debate.id, destination, {
            done: (draft) => context.page.go(hrefFor({ name: 'conversation', id: draft.conversationId })),
          })
        },
      },
    },
    h('p', { class: 'hint' }, strings.debates.postHint),
    field(strings.debates.postToChannel, channel),
    field(strings.debates.postToPerson, person),
    h('button', { type: 'submit', class: 'primary' }, strings.debates.post),
  )
}
