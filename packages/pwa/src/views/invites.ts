import type { AsRead } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import { type InviteMaking, type InvitesModel, emailToBind, invitesModel } from '../models/invites.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { button, field, loading } from './parts.ts'

/**
 * "Invite people", in Administration → Members and, where every member may invite, on People: makes a
 * single-use invite link, shows it once to copy, and lists the invites still waiting to revoke them.
 */
export const invitesSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const making = signal<InviteMaking>({ kind: 'idle' })
  const pending = signal<ReadonlyArray<AsRead.Invite> | null>(null)
  const reload = (): void => context.actions.listInvites({ done: (listed) => pending.set(listed) })
  reload()
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'off' })
  const create = (): void => {
    making.set({ kind: 'creating' })
    context.actions.createInvite(emailToBind(email.value), {
      done: (link) => {
        email.value = ''
        making.set({ kind: 'made', link, copied: 'not yet' })
        reload()
      },
      failed: () => making.set({ kind: 'failed' }),
    })
  }
  const copy = (url: string): void => {
    void context.page.copyText(url).then((isCopied) => {
      const current = making.get()
      if (current.kind === 'made') making.set({ ...current, copied: isCopied ? 'copied' : 'refused' })
    })
  }
  const revoke = (id: string): void =>
    context.actions.revokeInvite(id, {
      done: () => {
        context.state.notice.set({ kind: 'info', text: strings.invites.revoked })
        reload()
      },
    })
  const model = (): InvitesModel =>
    invitesModel({ making: making.get(), pending: pending.get(), now: context.clock.now() })
  const titleId = `invites-title-${context.random.id()}`
  const form = h(
    'form',
    {
      class: 'form invite-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          create()
        },
      },
    },
    region(life, [making], () => renderForm(model(), email)),
  )
  const opening = model()
  return h(
    'section',
    { class: 'invites', 'aria-labelledby': titleId },
    h('h3', { id: titleId }, opening.title),
    h('p', { class: 'hint' }, opening.intro),
    form,
    region(life, [making], () => renderMade(model(), copy)),
    region(life, [pending], () => renderPending(model(), revoke)),
  )
}

const renderForm = (model: InvitesModel, email: HTMLInputElement): Child => [
  field(model.email.label, email, model.email.hint),
  h(
    'button',
    { type: 'submit', class: 'primary invite-create', ...(model.busy && { disabled: true }) },
    model.create,
  ),
  model.problem !== null && h('p', { class: 'hint', role: 'alert' }, model.problem),
]

const renderMade = ({ made }: InvitesModel, copy: (url: string) => void): Child =>
  made !== null &&
  h(
    'div',
    { class: 'invite-made', role: 'status' },
    h('p', {}, made.explanation),
    h(
      'div',
      { class: 'join-command' },
      h('pre', {}, h('code', {}, made.url)),
      button(made.copy, () => copy(made.url), { class: 'invite-copy' }),
    ),
    made.copyProblem !== null && h('p', { class: 'hint' }, made.copyProblem),
  )

const renderPending = (model: InvitesModel, revoke: (id: string) => void): Child => [
  h('h4', {}, model.pendingTitle),
  model.pending === null
    ? loading()
    : model.pending.length === 0
      ? h('p', { class: 'hint' }, model.none)
      : h(
          'ul',
          { class: 'members invite-list' },
          model.pending.map((invite) =>
            h(
              'li',
              { class: 'member invite-row', data: { inviteId: invite.id } },
              h('div', { class: 'member-main' }, h('strong', {}, invite.who), h('span', {}, invite.expires)),
              button(invite.revoke, () => revoke(invite.id), { class: 'danger' }),
            ),
          ),
        ),
]
