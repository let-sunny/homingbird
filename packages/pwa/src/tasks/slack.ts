import { Task as T } from '@homingbird/kernel'
import type { AsRead } from '@homingbird/protocol'
import { type Action, withApp } from '../app.ts'

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
