import { type AsRead, GROUP_NAME_MAX } from '@homingbird/protocol'
import { type Child, type Lifetime, h, region, signal } from '@homingbird/ui'
import {
  type AdminGroupRow,
  type AdminGroupsModel,
  type ImportChange,
  type ImportModel,
  adminGroupsModel,
  importModel,
} from '../models/admin-groups.ts'
import { groupNameFrom } from '../models/group-page.ts'
import { hrefFor } from '../routes.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { closeDialog, closesDialog, opensDialog } from './dialog.ts'
import { dialogActions, empty, field, loadFailed, loading } from './parts.ts'

/** Administration → Groups: create a group, import its members from a file, or delete it. */
export const adminGroupsSection = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { state, actions } = context
  const failed = signal(false)
  const load = (): void => {
    failed.set(false)
    actions.loadGroups({ failed: () => failed.set(true) })
  }
  load()
  return region(life, [state.groups, state.groupsLoaded, failed], () =>
    renderAdminGroups(
      adminGroupsModel(state.groups.get(), state.groupsLoaded.get(), failed.get()),
      context,
      load,
    ),
  )
}

const renderAdminGroups = (model: AdminGroupsModel, context: ViewContext, retry: () => void): Child => {
  if (model.kind === 'loading') return loading()
  if (model.kind === 'failed') return loadFailed(retry)
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
    h(
      'ul',
      { class: 'members admin-groups' },
      model.rows.map((row) => groupRow(row, context)),
    ),
  ]
}

const groupRow = (row: AdminGroupRow, context: ViewContext): HTMLElement =>
  h(
    'li',
    { class: 'member', data: { groupId: row.group.id } },
    h(
      'div',
      { class: 'member-main' },
      h('strong', {}, h('a', { href: row.href }, row.label)),
      h('span', {}, row.members),
    ),
    h(
      'div',
      { class: 'member-actions' },
      row.importCsv !== null &&
        h(
          'button',
          {
            type: 'button',
            class: 'import-group',
            ...opensDialog(context, row.importCsv, (life) => importForm(context, life, row.group)),
          },
          row.importCsv,
        ),
      h(
        'button',
        {
          type: 'button',
          class: 'danger delete-group',
          ...opensDialog(context, row.deleteTitle, () => deleteForm(context, row)),
        },
        strings.groups.delete,
      ),
    ),
  )

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
              context.page.go(hrefFor({ name: 'group', id: created.id }))
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

const deleteForm = (context: ViewContext, row: AdminGroupRow): HTMLElement =>
  h(
    'form',
    {
      class: 'dialog-body delete-group-form',
      on: {
        submit: (event) => {
          event.preventDefault()
          context.actions.deleteGroup(row.group.id, { done: () => closeDialog(context) })
        },
      },
    },
    dialogActions(strings.groups.delete, 'danger'),
  )

const importForm = (context: ViewContext, life: Lifetime, group: AsRead.Group): HTMLElement => {
  const { actions } = context
  const members = signal<ReadonlyArray<AsRead.Member> | null>(null)
  const typed = signal('')
  actions.listMembers({ done: (listed) => members.set(listed) })
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
