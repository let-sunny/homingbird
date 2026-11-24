import { type AsRead, GROUP_NAME_MAX } from '@homingbird/protocol'
import type { MemberId } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal, slice } from '@homingbird/ui'
import {
  type AdminGroupModel,
  type AdminGroupRow,
  type AdminGroupsModel,
  type ImportChange,
  type ImportModel,
  adminGroupModel,
  adminGroupsModel,
  importModel,
} from '../models/admin-groups.ts'
import { groupNameFrom } from '../models/group-page.ts'
import { firstAnswersStep } from '../models/start.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { groupEditor, loadedGroup } from './group-page.ts'
import { dialogActions, empty, field, listWait, loading } from './parts.ts'

/** Administration → Groups: every team, each opening its editor, and creating one. */
export const adminGroupsSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { state, actions } = context
  actions.loadGroups()
  const awaited = slice([state.groups.load], () => firstAnswersStep([state.groups.load.get()]))
  return region(life, [state.groups, awaited, state.workspace], () =>
    renderAdminGroups(
      adminGroupsModel(state.groups.get(), awaited.get(), state.workspace.get()),
      context,
      actions.loadGroupsAgain,
    ),
  )
}

/** Administration → one team: rename it, change and import its members, or delete it. */
export const adminGroupEditor = (
  context: ViewContext,
  life: Lifetime,
  viewerId: MemberId,
  id: string,
): HTMLElement => {
  const shown = loadedGroup(context, viewerId, id)
  return region(
    life,
    shown.sources,
    () => renderAdminGroup(adminGroupModel(shown.model()), context, shown.retry),
    { class: 'admin-group' },
  )
}

const renderAdminGroups = (model: AdminGroupsModel, context: ViewContext, retry: () => void): Child => {
  if (model.kind === 'waiting') return listWait(model.wait, retry)
  return [
    h(
      'div',
      { class: 'admin-groups-head' },
      h(
        'button',
        {
          type: 'button',
          class: 'primary create-group',
          ...opensDialog(context, model.create, () => createForm(context)),
        },
        model.create,
      ),
    ),
    model.empty !== null && empty(model.empty),
    h('ul', { class: 'members admin-groups' }, model.rows.map(groupRow)),
  ]
}

const groupRow = (row: AdminGroupRow): HTMLElement =>
  h(
    'li',
    { class: 'member admin-group-row', data: { groupId: row.group.id } },
    h(
      'div',
      { class: 'member-main' },
      h('strong', {}, h('a', { href: row.href }, row.label)),
      h('span', {}, row.members),
    ),
  )

const renderAdminGroup = (model: AdminGroupModel, context: ViewContext, retry: () => void): Child => {
  const back = h('a', { class: 'admin-group-back', href: model.back.href }, `← ${model.back.label}`)
  if (model.kind !== 'group')
    return [back, model.kind === 'waiting' ? listWait(model.wait, retry) : empty(strings.notFound)]
  const group = model.page.group
  return [
    back,
    h('h2', { class: 'admin-group-title' }, model.page.title),
    groupEditor(
      model.page,
      context,
      model.importCsv !== null &&
        h(
          'button',
          {
            type: 'button',
            class: 'import-group',
            ...opensDialog(context, model.importCsv, (dialogLife) => importForm(context, dialogLife, group)),
          },
          model.importCsv,
        ),
    ),
    h(
      'div',
      { class: 'admin-group-delete' },
      h(
        'button',
        {
          type: 'button',
          class: 'danger delete-group',
          ...opensDialog(context, model.remove.title, () =>
            deleteForm(context, group.id, model.remove, model.back.href),
          ),
        },
        model.remove.label,
      ),
    ),
  ]
}

const createForm = (context: ViewContext): HTMLElement => {
  const name = h('input', {
    name: 'name',
    maxlength: String(GROUP_NAME_MAX),
    required: '',
    autocomplete: 'off',
  })
  return h(
    'form',
    {
      class: 'dialog-body create-group-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.createGroup(groupNameFrom(name.value), {
            done: (created) => {
              closeDialog(context)
              context.page.go(hrefFor({ name: 'admin-group', id: created.id }))
            },
            attempt: 'channel-name',
          })
        },
      },
    },
    field(strings.groups.nameLabel, name, strings.groups.nameHint),
    dialogActions(strings.groups.create, 'primary'),
  )
}

const deleteForm = (
  context: ViewContext,
  id: AsRead.Group['id'],
  remove: Extract<AdminGroupModel, { kind: 'group' }>['remove'],
  back: string,
): HTMLElement =>
  h(
    'form',
    {
      class: 'dialog-body delete-group-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.deleteGroup(id, {
            done: () => {
              closeDialog(context)
              context.page.go(back)
            },
          })
        },
      },
    },
    h('p', { class: 'hint' }, remove.hint),
    dialogActions(remove.label, 'danger'),
  )

const importForm = (context: ViewContext, life: Lifetime, group: AsRead.Group): HTMLElement => {
  const { actions } = context
  const members = signal<ReadonlyArray<AsRead.Member> | null>(null)
  const typed = signal('')
  actions.listMembers({ done: (listed) => members.set(listed.members) })
  const text = h('textarea', {
    name: 'emails',
    rows: '6',
    spellcheck: 'false',
    on: { input: () => typed.set(text.value) },
  })
  const file = h('input', {
    type: 'file',
    name: 'file',
    accept: '.csv,.txt,text/csv,text/plain',
    on: {
      change: () => {
        const chosen = file.files?.[0]
        if (chosen === undefined) return
        actions.readImportFile(chosen, {
          done: (read) => {
            text.value = read
            typed.set(read)
          },
        })
      },
    },
  })
  const submit = h('button', { type: 'submit', class: 'primary' }, strings.save)
  const model = (): ImportModel => importModel({ typed: typed.get(), members: members.get(), group })
  return h(
    'form',
    {
      class: 'dialog-body import-group-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const shown = model()
          if (shown.kind !== 'preview' || !shown.mayImport) return
          actions.setGroupMembers(group.id, shown.memberIds, {
            done: () => closeDialog(context),
            attempt: 'managers',
          })
        },
      },
    },
    h('p', { class: 'hint' }, strings.groups.importHint),
    field(strings.groups.importFile, file),
    field(strings.groups.importText, text),
    region(
      life,
      [typed, members],
      () => {
        const shown = model()
        submit.disabled = shown.kind !== 'preview' || !shown.mayImport
        return renderPreview(shown)
      },
      { class: 'import-preview' },
    ),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { type: 'button', ...closesDialog }, strings.cancel),
      submit,
    ),
  )
}

const renderPreview = (model: ImportModel): Child => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'waiting') return null
  return [
    model.adds !== null && change(model.adds, 'import-adds'),
    model.removes !== null && change(model.removes, 'import-removes'),
    model.unknown !== null && h('p', { class: 'import-unknown' }, model.unknown),
    model.nothing !== null && h('p', { class: 'hint' }, model.nothing),
  ]
}

const change = (shown: ImportChange, className: string): HTMLElement =>
  h(
    'section',
    { class: className },
    h('h3', {}, shown.text),
    h(
      'ul',
      {},
      shown.names.map((name) => h('li', {}, name)),
    ),
  )
