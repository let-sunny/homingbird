import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { channelLabel } from '../channels.ts'
import {
  type AdminSlackCredentialsModel,
  type AdminSlackModel,
  type SlackCodeModel,
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
      if (model.channel !== null) return channelChoice(context, code, model)
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

const channelChoice = (context: ViewContext, code: string, model: SlackCodeModel): Child => {
  const choices = model.channel?.choices ?? []
  const choice = h(
    'select',
    { name: 'channel' },
    choices.map((slug) => h('option', { value: slug }, channelLabel(slug))),
  )
  return [
    h('p', {}, model.question),
    h('p', { class: 'hint' }, strings.slack.confirmChannelHint),
    model.refusal !== null && h('p', { role: 'status' }, model.refusal),
    choices.length > 0 && field(strings.slack.chooseChannel, choice),
    h(
      'div',
      { class: 'dialog-actions' },
      h('a', { class: 'button', href: hrefFor({ name: 'channels' }) }, strings.slack.cancel),
      choices.length > 0 &&
        button(
          strings.slack.confirm,
          () =>
            context.actions.linkSlackChannel(choice.value, code, {
              done: (channel) => context.page.go(hrefFor({ name: 'channel', slug: channel.slug })),
            }),
          { class: 'primary' },
        ),
    ),
  ]
}

/**
 * Slack on the administrator's settings page: the workspace's state, the app's bot token and signing
 * secret, the events address and the manifest.
 */
export const adminSlackSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const admin = signal<AsRead.AdminSlack | undefined>(undefined)
  context.actions.loadAdminSlack({ done: (read) => admin.set(read) })
  return h(
    'fieldset',
    { class: 'appearance admin-slack' },
    h('legend', {}, strings.slack.admin.legend),
    h('p', { class: 'hint' }, strings.slack.admin.intro),
    region(life, [admin], () =>
      renderAdmin(adminSlackModel(admin.get()), context, (read) => admin.set(read)),
    ),
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
    model.stopped !== null && h('p', { class: 'slack-status is-stopped', role: 'note' }, model.stopped),
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

const renderAdmin = (
  model: AdminSlackModel | null,
  context: ViewContext,
  changed: (read: AsRead.AdminSlack) => void,
): Child => {
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
    credentialsPart(model.credentials, context, changed),
    field(strings.slack.admin.eventsUrl, events),
    field(strings.slack.admin.manifest, manifest),
  ]
}

/** The values are write-only: the fields start empty every time and nothing fills them from the server. */
const credentialsPart = (
  model: AdminSlackCredentialsModel,
  context: ViewContext,
  changed: (read: AsRead.AdminSlack) => void,
): HTMLElement => {
  const texts = strings.slack.admin.credentials
  const note = h('p', { class: 'hint slack-credentials-note' }, model.note)
  if (model.form === null) return h('div', { class: 'slack-credentials' }, h('h3', {}, texts.legend), note)
  const secretInput = (name: string, pattern: string) =>
    h('input', { name, type: 'password', required: true, autocomplete: 'off', spellcheck: 'false', pattern })
  const botToken = secretInput('slack-bot-token', '^xoxb-[A-Za-z0-9\\-]{10,250}$')
  const signingSecret = secretInput('slack-signing-secret', '^[0-9a-fA-F]{16,128}$')
  return h(
    'form',
    {
      class: 'form slack-credentials',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.saveSlackCredentials(
            { botToken: botToken.value.trim(), signingSecret: signingSecret.value.trim() },
            { done: changed },
          )
        },
      },
    },
    h('h3', {}, texts.legend),
    note,
    field(texts.botToken, botToken, texts.botTokenHint),
    field(texts.signingSecret, signingSecret, texts.signingSecretHint),
    h(
      'div',
      { class: 'dialog-actions' },
      model.form.canRemove &&
        h(
          'button',
          {
            type: 'button',
            class: 'danger',
            ...opensDialog(context, texts.removeTitle, () => removeConfirmation(context, changed)),
          },
          texts.remove,
        ),
      h('button', { type: 'submit', class: 'primary' }, model.form.submit),
    ),
  )
}

const removeConfirmation = (context: ViewContext, changed: (read: AsRead.AdminSlack) => void): Child =>
  h(
    'div',
    { class: 'dialog-body' },
    h('p', {}, strings.slack.admin.credentials.removeBody),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      button(
        strings.slack.admin.credentials.remove,
        () =>
          context.actions.removeSlackCredentials({
            done: (read) => {
              closeDialog(context)
              changed(read)
            },
          }),
        { class: 'danger' },
      ),
    ),
  )
