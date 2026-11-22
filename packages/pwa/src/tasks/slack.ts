import { Task as T } from '@homingbird/kernel'
import type { AsRead, NoteId } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'
import { rememberNote } from './notes.ts'

export const loadMySlack: Action<AsRead.MeSlack> = withApp(({ api }) => api['me.slack.get']({}))

export const connectSlack: Action<boolean> = withApp(({ api }) =>
  T.map((answer: { readonly sent: boolean }) => answer.sent)(api['me.slack.connect']({ body: {} })),
)

export const readSlackCode = (code: string): Action<AsRead.SlackCodeView> =>
  withApp(({ api }) => api['slack.codes.get']({ params: { id: code } }))

export const linkSlack = (code: string): Action<AsRead.MeSlack> =>
  withApp(({ api }) => api['me.slack.link']({ body: { code } }))

export const unlinkSlack: Action = withApp(({ api }) => T.asUnit(api['me.slack.unlink']({})))

export const loadAdminSlack: Action<AsRead.AdminSlack> = withApp(({ api }) => api['admin.slack.get']({}))

export const retrySlackPost = (noteId: NoteId): Action =>
  withApp(({ api, state }) =>
    T.map((note: AsRead.Note) => rememberNote(state)(note))(
      api['notes.posting.retry']({ params: { id: noteId }, body: {} }),
    ),
  )

export const linkSlackChannel = (slug: string, code: string): Action<AsRead.Channel> =>
  withApp(({ api }) => api['channels.slack.link']({ params: { slug }, body: { code } }))

export const unlinkSlackChannel = (slug: string): Action =>
  withApp(({ api }) => T.asUnit(api['channels.slack.unlink']({ params: { slug } })))
