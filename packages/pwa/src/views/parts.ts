import type { AsRead } from '@homingbird/protocol'
import { type Child, type Properties, h } from '@homingbird/ui'
import { channelLabel } from '../channels.ts'
import type { SourceShown } from '../draft-basis.ts'
import type { SlackReplyLines } from '../models/slack-reply.ts'
import { type ListWait, checkingWords } from '../models/start.ts'
import type { TimeShown } from '../models/time.ts'
import { type PresenceMarks, presenceShown } from '../presence.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closesDialog } from './dialog.ts'
import { type HintContext, hinted } from './hint.ts'
import { type PipState, pip } from './pip.ts'

/** A page with a back link, its title and its body. */
export const page = (title: string, ...children: ReadonlyArray<Child>): HTMLElement =>
  h(
    'section',
    { class: 'page' },
    h('header', { class: 'page-head' }, backLink(), h('h1', {}, title)),
    h('div', { class: 'page-body' }, ...children),
  )

export const backLink = (): HTMLElement =>
  h('a', { class: 'back', href: '#/', 'aria-label': strings.back }, '◀')

export const button = (
  label: string,
  onClick: (event: MouseEvent) => void,
  properties: Properties = {},
): HTMLButtonElement => h('button', { type: 'button', ...properties, on: { click: onClick } }, label)

/** What a draft rests on beside its basis lines: links, jumps to earlier notes, and the passages used. */
export const sourceList = (sources: ReadonlyArray<SourceShown>): HTMLElement | null =>
  sources.length === 0
    ? null
    : h(
        'ul',
        { class: 'draft-sources' },
        sources.map((source) =>
          h(
            'li',
            { class: `draft-source is-${source.kind}` },
            source.href === null
              ? h('span', {}, source.label)
              : h(
                  'a',
                  {
                    href: source.href,
                    ...(source.kind === 'link' && { rel: 'noopener noreferrer', target: '_blank' }),
                  },
                  source.label,
                ),
            source.quote !== null && h('blockquote', { class: 'source-quote' }, source.quote),
          ),
        ),
      )

export const field = (label: string, control: HTMLElement, hint?: string): HTMLElement =>
  h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint && h('small', {}, hint),
  )

/** Whether the person and their agent are there, in words; with a context, the agent's state has a hint. */
export const presenceBadges = (
  presence: AsRead.Presence,
  context: HintContext | null = null,
  whose: 'theirs' | 'mine' = 'theirs',
): HTMLElement => {
  const shown = presenceShown(presence, true, whose)
  const agentLight = h(
    'span',
    {
      class: `agent-light ${shown.agent.isOn ? 'is-on' : 'is-off'}`,
      ...(context === null && { title: shown.agent.title }),
    },
    shown.agent.words,
  )
  return h(
    'span',
    { class: 'presence is-in-words' },
    h(
      'span',
      { class: `human-state ${shown.person.isOn ? 'is-on' : 'is-off'}`, title: shown.person.title },
      h('span', { class: `human-dot ${shown.person.isOn ? 'is-on' : 'is-off'}`, 'aria-hidden': 'true' }),
      shown.person.words,
    ),
    context === null ? agentLight : hinted(context, 'agentAwake', shown.agent.title, agentLight),
  )
}

/** A row's presence, small enough to sit on its avatar: a dot while the agent is awake or cannot answer. */
export const agentDot = (presence: AsRead.Presence): HTMLElement | null => {
  const { agent } = presenceShown(presence, false)
  return agent.words === null
    ? null
    : h('span', {
        class: `agent-dot ${agent.isOn ? 'is-on' : 'is-off'}`,
        role: 'img',
        'aria-label': agent.words,
        title: agent.title,
      })
}

/** Whether the person is online, as a dot beside their name. */
export const humanDot = (presence: AsRead.Presence): HTMLElement => {
  const { person } = presenceShown(presence, false)
  return h('span', {
    class: `human-dot ${person.isOn ? 'is-on' : 'is-off'}`,
    role: 'img',
    'aria-label': person.label,
    title: person.label,
  })
}

/** The colleague and their agent as two dots, each named for assistive technology and on hover. */
export const presenceDots = (marks: PresenceMarks): HTMLElement =>
  h(
    'span',
    { class: 'presence-dots' },
    h('span', {
      class: `human-dot ${marks.person.isOn ? 'is-on' : 'is-off'}`,
      role: 'img',
      'aria-label': marks.person.label,
      title: marks.person.label,
    }),
    h('span', {
      class: `agent-mark-dot is-${marks.agent.state}`,
      role: 'img',
      'aria-label': marks.agent.label,
      title: marks.agent.label,
    }),
    h('span', { class: 'presence-words', 'aria-hidden': 'true' }, marks.words),
  )

export const timeLabel = (shown: TimeShown): HTMLElement =>
  h('time', { datetime: shown.datetime, title: shown.title }, shown.text)

/** Shown while a page or a part of one waits for its data. */
export const loading = (): HTMLElement => h('p', { class: 'loading' }, strings.loading)

/**
 * Shown while the workspace has not loaded yet, in place of a list's "nothing here": that the list is being
 * checked. Nothing once loading took too long or failed, when the line above the lists speaks instead.
 */
export const checking = (context: Pick<ViewContext, 'state'>, words: string): HTMLElement | null => {
  const shown = checkingWords(context.state.workspace.get(), words)
  return shown === null ? null : h('p', { class: 'loading' }, shown)
}

/** Stands in place of a list that has not come: that it is checking, or that it took too long or failed, with a way to try again. */
export const listWait = (wait: ListWait | null, retry: () => void): HTMLElement | null => {
  if (wait === null || wait.kind === 'told-above') return null
  return wait.kind === 'checking'
    ? h('p', { class: 'loading' }, wait.text)
    : empty(wait.text, button(wait.retry, retry))
}

/** What the person typed and has not saved, by field, so that drawing its part of the page again keeps it. */
export type Unsaved = Map<string, string>

export const keepTyped = (
  unsaved: Unsaved,
  key: string,
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void => {
  input.value = unsaved.get(key) ?? value
  input.addEventListener('input', () => {
    if (input.value === value) unsaved.delete(key)
    else unsaved.set(key, input.value)
  })
}

/** The field was saved as it was then; what the person typed since stays. */
export const forgetTyped = (unsaved: Unsaved, key: string, saved: string): void => {
  if (unsaved.get(key) === saved) unsaved.delete(key)
}

export const empty = (text: string, ...actions: ReadonlyArray<Child>): HTMLElement =>
  h('div', { class: 'empty' }, h('p', {}, text), ...actions)

/** A page with nothing in it yet: the one place on a page where Pip appears, always at the same size. */
export const emptyWithPip = (state: PipState, text: string, ...actions: ReadonlyArray<Child>): HTMLElement =>
  h('div', { class: 'empty' }, pip(state, EMPTY_PIP_SCALE), h('p', {}, text), ...actions)

export const channelChips = (slugs: ReadonlyArray<string>): HTMLElement =>
  h(
    'ul',
    { class: 'channel-chips' },
    slugs.map((slug) =>
      h(
        'li',
        {},
        h('a', { class: 'channel-chip', href: hrefFor({ name: 'channel', slug }) }, channelLabel(slug)),
      ),
    ),
  )

export const channelCounts = (channel: {
  readonly memberCount: number
  readonly helperCount: number
}): HTMLElement =>
  h(
    'span',
    { class: 'channel-counts' },
    h('span', {}, strings.memberCount({ count: channel.memberCount })),
    h('span', {}, strings.answerCount({ count: channel.helperCount })),
  )

export const archivedMark = (): HTMLElement => h('span', { class: 'archived-mark' }, strings.archived)

export const youMark = (): HTMLElement => h('small', { class: 'is-you' }, strings.youMark)

/** Where a reply to Slack is posted, and what changed there since, each on its own line. */
export const slackReplyLines = (lines: SlackReplyLines | null): HTMLElement | null =>
  lines === null
    ? null
    : h(
        'div',
        { class: 'slack-destination hint', role: 'note' },
        h('p', {}, lines.postsTo),
        lines.newer !== null &&
          h('p', { class: 'slack-newer', role: 'status' }, h('strong', {}, lines.newer)),
        lines.edited !== null &&
          h('p', { class: 'slack-newer', role: 'status' }, h('strong', {}, lines.edited)),
      )

export const privateMarkOf = (text: string, title?: string): HTMLElement =>
  h(
    'span',
    { class: 'private-mark', ...(title !== undefined && { title }) },
    h('span', { class: 'lock-mark', 'aria-hidden': 'true' }),
    text,
  )

/** A button that cannot be used yet, with the reason beside it, read out with the button. */
export const disabledWithReason = (label: string, reason: string, kind: string): HTMLElement =>
  h(
    'span',
    { class: 'disabled-control' },
    h('button', { type: 'button', class: kind, disabled: true, 'aria-describedby': `${kind}-reason` }, label),
    h('small', { id: `${kind}-reason` }, reason),
  )

/** Copies text for pasting elsewhere and says whether it worked. */
export const copyWithNotice = (
  context: Pick<ViewContext, 'page' | 'state'>,
  text: string,
  copied: string,
): void => {
  void context.page
    .copyText(text)
    .then((isCopied) =>
      context.state.notice.set(
        isCopied ? { kind: 'info', text: copied } : { kind: 'error', text: strings.noteNotCopied },
      ),
    )
}

/** Lines to paste one after the other, numbered, each with its own Copy button. */
export const commandLines = (
  context: Pick<ViewContext, 'page' | 'state'>,
  lines: ReadonlyArray<string>,
): HTMLElement =>
  h(
    'ol',
    { class: 'command-lines' },
    lines.map((line, index) =>
      h(
        'li',
        {},
        h(
          'div',
          { class: 'command-line' },
          h('pre', {}, h('code', {}, line)),
          button(strings.copyCode, () => copyWithNotice(context, line, strings.lineCopied), {
            class: 'command-copy',
            'aria-label': strings.copyLine({ number: index + 1 }),
          }),
        ),
      ),
    ),
  )

/** Cancel, which closes the dialog, beside the dialog's own submit button. */
export const dialogActions = (label: string, kind: 'primary' | 'danger'): HTMLElement =>
  h(
    'div',
    { class: 'dialog-actions' },
    h('button', { type: 'button', ...closesDialog }, strings.cancel),
    h('button', { type: 'submit', class: kind }, label),
  )

const EMPTY_PIP_SCALE = 3
