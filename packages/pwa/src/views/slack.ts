import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import {
  type AdminSlackModel,
  type SlackPersonModel,
  adminSlackModel,
  slackCodeModel,
  slackPersonModel,
} from '../models/slack.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { button, field, loading } from './parts.ts'

/** "Slack" under Connection: link the person's Slack user, so that drafts waiting for them are announced there. */
export const slackSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const mine = signal<AsRead.MeSlack | undefined>(undefined)
  const requested = signal<boolean | null>(null)
  context.actions.loadMySlack({ done: (read) => mine.set(read) })
  const reload = (): void => context.actions.loadMySlack({ done: (read) => mine.set(read) })
  return h(
    'fieldset',
    { class: 'appearance slack-link' },
    h('legend', {}, strings.slack.legend),
    h('p', { class: 'hint' }, strings.slack.intro),
    region(life, [mine, requested], () =>
      renderPerson(slackPersonModel({ mine: mine.get(), requested: requested.get() }), context, {
        requested: (sent) => requested.set(sent),
        unlinked: () => {
          requested.set(null)
          reload()
        },
      }),
    ),
  )
}

/** The page a link from Slack opens: what confirming links, then back to Connection. */
export const slackLinkView = (context: ViewContext, life: Lifetime, code: string): HTMLElement => {
  const view = signal<AsRead.SlackCodeView | null | undefined>(undefined)
  context.actions.readSlackCode(code, { done: (read) => view.set(read), failed: () => view.set(null) })
  const connection = hrefFor({ name: 'agent', section: 'connection' })
  return h(
    'section',
    { class: 'slack-confirm', 'aria-labelledby': 'slack-confirm' },
    h('h2', { id: 'slack-confirm' }, strings.slack.linkTitle),
    region(life, [view], () => {
      const model = slackCodeModel(view.get())
      if (model.loading) return loading()
      if (model.refusal !== null)
        return [
          h('p', {}, model.refusal),
          h('a', { class: 'button', href: connection }, strings.slack.toConnection),
        ]
      return [
        h('p', {}, model.question),
        h('p', { class: 'hint' }, strings.slack.confirmHint),
        h(
          'div',
          { class: 'dialog-actions' },
          h('a', { class: 'button', href: connection }, strings.slack.cancel),
          button(
            strings.slack.confirm,
            () => context.actions.linkSlack(code, { done: () => context.page.go(connection) }),
            { class: 'primary' },
          ),
        ),
      ]
    }),
  )
}

/** Slack on the administrator's settings page: the workspace's state, the events address and the manifest. */
export const adminSlackSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const admin = signal<AsRead.AdminSlack | undefined>(undefined)
  context.actions.loadAdminSlack({ done: (read) => admin.set(read) })
  return h(
    'fieldset',
    { class: 'appearance admin-slack' },
    h('legend', {}, strings.slack.admin.legend),
    h('p', { class: 'hint' }, strings.slack.admin.intro),
    region(life, [admin], () => renderAdmin(adminSlackModel(admin.get()))),
  )
}

interface PersonActions {
  readonly requested: (sent: boolean) => void
  readonly unlinked: () => void
}

const renderPerson = (model: SlackPersonModel, context: ViewContext, actions: PersonActions): Child => {
  if (model.loading) return loading()
  return [
    h('p', { class: 'slack-status', role: 'status' }, model.status),
    model.canConnect &&
      button(strings.slack.connect, () => context.actions.connectSlack({ done: actions.requested }), {
        class: 'primary',
      }),
    model.requested !== null && h('p', { class: 'hint', role: 'status' }, model.requested),
    model.canUnlink &&
      h(
        'button',
        {
          type: 'button',
          class: 'danger',
          ...opensDialog(context, strings.slack.unlinkTitle, () => unlinkConfirmation(context, actions)),
        },
        strings.slack.unlink,
      ),
  ]
}

const unlinkConfirmation = (context: ViewContext, actions: PersonActions): Child =>
  h(
    'div',
    { class: 'dialog-body' },
    h('p', {}, strings.slack.unlinkBody),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      button(
        strings.slack.unlink,
        () =>
          context.actions.unlinkSlack({
            done: () => {
              closeDialog(context)
              actions.unlinked()
            },
          }),
        { class: 'danger' },
      ),
    ),
  )

const renderAdmin = (model: AdminSlackModel | null): Child => {
  if (model === null) return loading()
  const manifest = h('textarea', { readonly: true, rows: '12', class: 'slack-manifest' })
  manifest.value = model.manifest
  const events = h('input', { readonly: true, value: model.eventsUrl, class: 'slack-events-url' })
  return [
    h('p', { class: `slack-status ${model.status.tone}`, role: 'status' }, model.status.text),
    model.facts.length > 0 &&
      h(
        'dl',
        { class: 'facts' },
        model.facts.map((fact) => [h('dt', {}, fact.term), h('dd', {}, fact.value)]),
      ),
    field(strings.slack.admin.eventsUrl, events),
    field(strings.slack.admin.manifest, manifest),
  ]
}
