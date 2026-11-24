import { Task as T } from '@homingbird/kernel'
import { type AsRead, type GroupId, Invalid, type MemberId } from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { reread } from './resources.ts'

export const renameGroup = (id: GroupId, name: string): Action =>
  withApp(({ api }) =>
    T.flatMap(() => afterGroupChange)(api['groups.rename']({ params: { id }, body: { name } })),
  )

/** Makes exactly these people the group's members, in one change. */
export const setGroupMembers = (id: GroupId, memberIds: ReadonlyArray<MemberId>): Action =>
  withApp(({ api }) =>
    T.flatMap(() => afterGroupChange)(
      api['groups.members.set']({ params: { id }, body: { memberIds: [...memberIds] } }),
    ),
  )

export const createGroup = (name: string): Action<AsRead.Group> =>
  T.gen(function* () {
    const { api } = yield* T.ask<App>()
    const created = yield* api['admin.groups.create']({ body: { name } })
    yield* reread('groups')
    return created
  })

export const deleteGroup = (id: GroupId): Action =>
  withApp(({ api }) => T.flatMap(() => afterGroupChange)(api['admin.groups.delete']({ params: { id } })))

/** The members of a group, as the people list filters them. */
export const listPeopleInGroup = (id: GroupId): Action<ReadonlyArray<MemberId>> =>
  withApp(({ api }) =>
    T.map((listed: { entries: ReadonlyArray<AsRead.DirectoryEntry> }) =>
      listed.entries.map((entry) => entry.member.id),
    )(api['directory.list']({ query: { group: id } })),
  )

/** The text of a file the person chose to import, read in the browser and sent nowhere. */
export const readImportFile = (file: Blob): Action<string> =>
  withApp(({ page }) =>
    T.tryPromise(
      () => page.readText(file),
      () => Invalid({ message: 'The file could not be read.' }),
    ),
  )

/** A group's change can change who manages, and so who is in, its channels. */
const afterGroupChange: Action = reread('groups', 'channels')
