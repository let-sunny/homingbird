import type {
  Debate,
  DebateExport,
  DebateExportFormat,
  DebateResult,
  Me,
  MemberId,
} from '@homingbird/protocol'
import { type Child, type Lifetime, h, linkedText, region } from '@homingbird/ui'
import { launch } from '../actions.ts'
import { channelLabel } from '../channels.ts'
import {
  approveResult,
  changeLimits,
  declineResult,
  exportDebate,
  loadDebate,
  optInAgent,
  postResult,
} from '../debate-actions.ts'
import { debateStage, mayChangeLimits, mayDecide, mayOptIn, takesPart, turnsLeftFor } from '../debates.ts'
import { hrefFor } from '../routes.ts'
import { agentCredentials, channels, directory, members, notice, shownDebate } from '../state.ts'
import { formats, strings } from '../strings.ts'
import { limitFields, typedLimits } from './debates.ts'
import { emptyWithPip, field, loading, page, timeLabel } from './parts.ts'

/** One debate room: its question, its agents and turns as they come, and its result with each approval. */
export const debateView = (life: Lifetime, me: Me, id: string): HTMLElement => {
  shownDebate.set(null)
  launch(loadDebate(id))
  return region(
    life,
    [shownDebate, members, agentCredentials],
    () => {
      const debate = shownDebate.get()
      if (debate === null) return loading()
      if (debate === 'missing')
        return emptyWithPip(
          'failed',
          strings.debates.notFound,
          h('a', { class: 'button', href: hrefFor({ name: 'debates' }) }, strings.debates.allRooms),
        )
      return roomPage(debate, me)
    },
    { class: 'debate-room-host' },
  )
}

const roomPage = (debate: Debate, me: Me): HTMLElement => {
  const stage = debateStage(debate)
  return page(
    debate.question,
    h(
      'p',
      { class: `debate-meta is-${stage}` },
      h('span', { class: 'debate-stage' }, strings.debates.stage[stage]),
      debate.visibility === 'private' &&
        h(
          'span',
          { class: 'private-mark' },
          h('span', { class: 'lock-mark', 'aria-hidden': 'true' }),
          strings.debates.private,
        ),
      debate.status === 'open' &&
        h('span', {}, strings.debates.closesAt({ time: formats.full.format(new Date(debate.deadlineAt)) })),
    ),
    h(
      'p',
      { class: 'debate-limits-summary' },
      strings.debates.limitsSummary({
        perAgent: debate.limits.turnsPerAgent,
        total: debate.limits.totalTurns,
        minutes: debate.limits.minutes,
        characters: debate.limits.turnCharacters,
      }),
    ),
    mayChangeLimits(debate, me.member.id) && limitsForm(debate),
    participantsSection(debate),
    mayOptIn(debate, me.member.id) && optInSection(debate),
    turnsSection(debate, me),
    stage === 'ended' &&
      section(
        strings.debates.resultTitle,
        'debate-result',
        h('p', {}, strings.debates.ended[debate.endedBecause ?? 'no_turns']),
      ),
    (stage === 'awaiting-result' || stage === 'awaiting-approval' || stage === 'closed') &&
      resultSection(debate, me),
    stage === 'closed' && closedSection(debate, me),
  )
}

const nameOf = (id: MemberId): string => members.get().get(id)?.name ?? strings.formerMember

const section = (title: string, className: string, ...children: ReadonlyArray<Child>): HTMLElement =>
  h('section', { class: `debate-section ${className}` }, h('h2', {}, title), ...children)

const limitsForm = (debate: Debate): HTMLElement => {
  const form: HTMLFormElement = h(
    'form',
    {
      class: 'debate-limits-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const typed = typedLimits(form)
          if ('problem' in typed) return notice.set({ kind: 'error', text: typed.problem })
          launch(changeLimits(debate.id, typed.limits))
        },
      },
    },
    limitFields(debate.limits),
    h('button', { type: 'submit' }, strings.debates.saveLimits),
  )
  return h('details', { class: 'debate-change-limits' }, h('summary', {}, strings.debates.changeLimits), form)
}

const participantsSection = (debate: Debate): HTMLElement =>
  section(
    strings.debates.participantsTitle,
    'debate-participants',
    debate.participants.length === 0
      ? h('p', {}, strings.debates.noParticipants)
      : h(
          'ul',
          {},
          debate.participants.map((participant) =>
            h(
              'li',
              { data: { member: participant.memberId } },
              h(
                'span',
                {},
                strings.debates.agentOf({
                  agent: participant.agentName,
                  person: nameOf(participant.memberId),
                }),
              ),
              debate.status === 'open' &&
                h(
                  'small',
                  {},
                  strings.debates.turnsLeft({ count: turnsLeftFor(debate, participant.memberId) }),
                ),
            ),
          ),
        ),
  )

const optInSection = (debate: Debate): HTMLElement => {
  const agents = agentCredentials.get()
  if (agents.length === 0)
    return section(strings.debates.optInTitle, 'debate-opt-in', h('p', {}, strings.debates.noAgent))
  const choice = h(
    'select',
    { name: 'agent' },
    agents.map((agent) => h('option', { value: agent.id }, agent.name)),
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
            const agent = agents.find((one) => one.id === choice.value)
            if (agent !== undefined) launch(optInAgent(debate.id, agent.id))
          },
        },
      },
      field(strings.debates.chooseAgent, choice),
      h('button', { type: 'submit', class: 'primary' }, strings.debates.optIn),
    ),
  )
}

const turnsSection = (debate: Debate, me: Me): HTMLElement =>
  section(
    strings.debates.turnsTitle,
    'debate-turns',
    debate.turns.length === 0
      ? h(
          'p',
          {},
          debateStage(debate) === 'gathering' ? strings.debates.waitingForSecond : strings.debates.noTurns,
        )
      : h(
          'ol',
          { class: 'debate-turn-list', 'aria-live': 'polite' },
          debate.turns.map((turn) =>
            h(
              'li',
              {
                class: `debate-turn ${turn.memberId === me.member.id ? 'is-mine' : ''}`,
                data: { position: String(turn.position) },
              },
              h(
                'header',
                { class: 'debate-turn-head' },
                h(
                  'strong',
                  {},
                  strings.debates.agentOf({ agent: turn.agentName, person: nameOf(turn.memberId) }),
                ),
                timeLabel(turn.at),
              ),
              h('p', { class: 'debate-turn-body' }, ...linkedText(turn.body)),
            ),
          ),
        ),
  )

const resultSection = (debate: Debate, me: Me): HTMLElement => {
  if (debate.result === null)
    return section(strings.debates.resultTitle, 'debate-result', h('p', {}, strings.debates.waitingForResult))
  return section(
    strings.debates.resultTitle,
    'debate-result',
    h('p', { class: 'hint' }, strings.debates.draftedBy({ person: nameOf(debate.result.draftedBy) })),
    ...resultBody(debate.result.result),
    approvals(debate),
    mayDecide(debate, me.member.id) &&
      h(
        'div',
        { class: 'debate-decide' },
        h('p', { class: 'hint' }, strings.debates.approvalHint),
        h(
          'button',
          {
            type: 'button',
            class: 'primary approve-result',
            on: { click: () => launch(approveResult(debate.id, debate.result!.draftedAt)) },
          },
          strings.debates.approve,
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'decline-result',
            on: { click: () => launch(declineResult(debate.id, debate.result!.draftedAt)) },
          },
          strings.debates.decline,
        ),
      ),
  )
}

const resultBody = (result: DebateResult): Child[] => [
  ...(result.kind === 'conclusion'
    ? [
        h('h3', {}, strings.debates.conclusion),
        h('p', { class: 'debate-conclusion' }, result.conclusion),
        h('h4', {}, strings.debates.reasons),
        h(
          'ul',
          {},
          result.reasons.map((reason) => h('li', {}, reason)),
        ),
      ]
    : [
        h('h3', {}, strings.debates.noConclusion),
        h('p', { class: 'debate-conclusion' }, result.summary),
        h('h4', {}, strings.debates.disagreements),
        h(
          'ul',
          { class: 'debate-points' },
          result.points.map((point) =>
            h(
              'li',
              { class: 'debate-point', data: { category: point.category } },
              h('strong', {}, point.point),
              h('span', { class: 'debate-category' }, strings.debates.category[point.category]),
              h('p', {}, point.explanation),
            ),
          ),
        ),
      ]),
  h('h4', {}, strings.debates.nextSteps),
  result.nextSteps.length === 0
    ? h('p', {}, strings.debates.noNextSteps)
    : h(
        'ul',
        { class: 'debate-next-steps' },
        result.nextSteps.map((step) =>
          h(
            'li',
            {},
            h('span', {}, step.step),
            step.owner !== null && h('small', {}, strings.debates.owner({ person: nameOf(step.owner) })),
            h('small', {}, strings.debates.proposedBy({ person: nameOf(step.proposedBy) })),
          ),
        ),
      ),
  h('h4', {}, strings.debates.contributions),
  h(
    'ul',
    { class: 'debate-contributions' },
    result.contributions.map((contribution) =>
      h(
        'li',
        {},
        h('strong', {}, nameOf(contribution.memberId)),
        h('span', {}, contribution.summary),
        ...contribution.credits.map((credit) =>
          h('span', { class: 'debate-credit' }, strings.debates.credit[credit]),
        ),
      ),
    ),
  ),
]

const approvals = (debate: Debate): HTMLElement =>
  h(
    'div',
    { class: 'debate-approvals' },
    h('h4', {}, strings.debates.approvalsTitle),
    h(
      'ul',
      {},
      debate.approvals.map((approval) =>
        h(
          'li',
          {
            class: approval.approvedAt === null ? 'is-waiting' : 'is-approved',
            data: { member: approval.memberId },
          },
          h('span', { class: 'approval-mark', 'aria-hidden': 'true' }),
          h('span', {}, nameOf(approval.memberId)),
          h(
            'small',
            {},
            approval.approvedAt === null
              ? strings.debates.notApproved
              : strings.debates.approvedAt({ time: formats.full.format(new Date(approval.approvedAt)) }),
          ),
        ),
      ),
    ),
  )

const closedSection = (debate: Debate, me: Me): HTMLElement =>
  section(
    strings.debates.postTitle,
    'debate-closed',
    h('p', { class: 'hint' }, strings.debates.closedHint),
    h(
      'div',
      { class: 'debate-exports' },
      exportButton(debate, 'markdown', strings.debates.exportMarkdown),
      exportButton(debate, 'json', strings.debates.exportJson),
      h('small', {}, strings.debates.exportAudited),
    ),
    takesPart(debate, me.member.id) && postForm(debate, me),
  )

const exportButton = (debate: Debate, format: DebateExportFormat, label: string): HTMLElement =>
  h(
    'button',
    {
      type: 'button',
      class: `export-${format}`,
      on: { click: () => launch(exportDebate(debate.id, format), download) },
    },
    label,
  )

const download = (file: DebateExport): void => {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mediaType }))
  const link = h('a', { href: url, download: file.filename, hidden: true })
  document.body.append(link)
  link.click()
  link.remove()
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

const postForm = (debate: Debate, me: Me): HTMLElement => {
  const channel = h(
    'select',
    { name: 'channel' },
    h('option', { value: '' }, strings.debates.choose),
    channels
      .get()
      .filter((one) => one.joined)
      .map((one) => h('option', { value: one.slug }, channelLabel(one.slug))),
  )
  const person = h(
    'select',
    { name: 'person' },
    h('option', { value: '' }, strings.debates.choose),
    directory
      .get()
      .filter((entry) => entry.member.id !== me.member.id && entry.canMessage)
      .map((entry) => h('option', { value: entry.member.id }, entry.member.name)),
  )
  return h(
    'form',
    {
      class: 'debate-post-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const destination =
            channel.value !== ''
              ? { channel: channel.value }
              : person.value !== ''
                ? { to: person.value as MemberId }
                : null
          if (destination === null) return
          launch(postResult(debate.id, destination), (draft) => {
            location.hash = hrefFor({ name: 'conversation', id: draft.conversationId })
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
