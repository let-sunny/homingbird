import { Task as T } from '@homingbird/kernel'
import type { AsRead, ConversationId } from '@homingbird/protocol'
import { batch, later } from '@homingbird/ui'
import type { App } from '../app.ts'
import { channelLabel, channelOfRoom, withChannel, withoutRoom } from '../channels.ts'
import { upsertRequest } from '../draft-requests.ts'
import { hrefFor } from '../routes.ts'
import { signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import { isMuted, withAgentPresence, withPresence, withReceipts } from '../thread.ts'
import { loadReviews } from './channel-agents.ts'
import { applyLeft } from './conversation-actions.ts'
import { loadDebate, loadDebates } from './debates.ts'
import { loadGroups } from './groups.ts'
import { forgetNote, forgetRelease, loadThread, rememberNote } from './notes.ts'
import { closeDraftNotice } from './notifications.ts'
import { loadPreviews, reloadPreviews } from './previews.ts'
import { refreshInterview } from './teaching-interview.ts'
import { loadAgents, loadConversations, loadKnownChannels, loadPeople, loadWorkspace } from './workspace.ts'

/** What each live event changes in the page, as one change: the state it updates and what it loads again. */
export const liveEvents = (app: App): ((event: AsRead.StreamEvent) => void) => {
  const { state, launch } = app
  let cancelDirectoryReload = (): void => {}
  const reloadDirectorySoon = (): void => {
    cancelDirectoryReload()
    cancelDirectoryReload = later(app.clock, DIRECTORY_SETTLE_MS, () =>
      launch(T.all([loadPeople, loadKnownChannels, loadConversations])),
    )
  }
  let cancelGroupsReload = (): void => {}
  const reloadGroupsSoon = (): void => {
    if (!state.groupsLoaded.get()) return
    cancelGroupsReload()
    cancelGroupsReload = later(app.clock, DIRECTORY_SETTLE_MS, () => launch(loadGroups))
  }
  let cancelReviewsReload = (): void => {}
  const reloadReviewsSoon = (): void => {
    cancelReviewsReload()
    cancelReviewsReload = later(app.clock, DIRECTORY_SETTLE_MS, () => launch(loadReviews))
  }
  let cancelInterviewReload = (): void => {}
  const reloadInterviewSoon = (): void => {
    cancelInterviewReload()
    cancelInterviewReload = later(app.clock, DIRECTORY_SETTLE_MS, () => launch(refreshInterview))
  }
  let cancelDebatesReload = (): void => {}
  const reloadDebatesSoon = (): void => {
    cancelDebatesReload()
    cancelDebatesReload = later(app.clock, DIRECTORY_SETTLE_MS, () => launch(loadDebates))
  }
  const refreshAgentsIfNoneKnown = (): void => {
    if (state.agentCredentials.get().length === 0) launch(loadAgents)
  }
  const apply = (event: AsRead.StreamEvent): void => {
    const body = event.body
    switch (body.type) {
      case 'note.sent':
        rememberNote(state)(body.note)
        if (body.note.authorId === signedIn(state)?.member.id) launch(closeDraftNotice(body.note.id))
        announceIfFresh(app, body.note)
        launch(loadConversations)
        break
      case 'note.changed':
        rememberNote(state)(body.note)
        tellIfNotPosted(app, body.note)
        break
      case 'note.status':
        state.changes.count(body.conversationId)
        state.threads.update((all) => {
          const thread = all.get(body.conversationId)
          return thread === undefined
            ? all
            : new Map(all).set(body.conversationId, {
                ...thread,
                notes: withReceipts(thread.notes, body.noteId, body.receipts),
              })
        })
        break
      case 'draft.saved':
        rememberNote(state)(body.note)
        if (body.note.inReplyTo !== null) forgetRelease(state, body.note.inReplyTo)
        if (body.note.origin !== 'human') refreshAgentsIfNoneKnown()
        launch(loadConversations)
        break
      case 'draft.discarded':
        forgetNote(state, body.conversationId, body.noteId)
        launch(closeDraftNotice(body.noteId))
        if (body.because === 'slack_deleted')
          state.notice.set({ kind: 'info', text: strings.slack.draftDiscardedDeleted })
        if (body.because === 'channel_archived' && body.channel !== undefined) {
          const channel = body.channel
          state.archiveDiscards.update((all) =>
            new Map(all).set(body.conversationId, [
              ...(all.get(body.conversationId) ?? []).filter((one) => one.noteId !== body.noteId),
              { noteId: body.noteId, channel },
            ]),
          )
          state.notice.set({
            kind: 'info',
            text: strings.draftDiscardedByArchive({ channel: channelLabel(channel) }),
          })
        }
        launch(loadConversations)
        break
      case 'note.withdrawn':
        forgetNote(state, body.conversationId, body.noteId)
        if (state.threads.get().has(body.conversationId)) launch(loadThread(body.conversationId))
        launch(loadConversations)
        break
      case 'note.released':
        state.releases.update((all) =>
          new Map(all).set(body.noteId, { reason: body.reason, agentName: body.agentName }),
        )
        launch(loadThread(body.conversationId))
        break
      case 'draft.requested':
      case 'draft.request.changed':
        state.draftRequests.update((all) => upsertRequest(all, body.request))
        break
      case 'contact.changed':
        launch(loadPeople)
        break
      case 'directory.changed':
        reloadDirectorySoon()
        break
      case 'channel.changed':
        state.channels.update((all) => withChannel(all, body.channel))
        if (body.channel.joined) launch(loadConversations)
        break
      case 'channel.left':
        state.channels.update((all) =>
          withoutRoom(all, body.conversationId, signedIn(state)?.member.role === 'admin'),
        )
        state.conversations.update((all) => all.filter((room) => room.id !== body.conversationId))
        state.changes.count(body.conversationId)
        state.threads.update((all) => {
          const remaining = new Map(all)
          remaining.delete(body.conversationId)
          return remaining
        })
        leaveRoomIfShown(app, body.conversationId)
        break
      case 'conversation.left':
        applyLeft(app, body.conversationId, body.memberId)
        break
      case 'group.changed':
        reloadGroupsSoon()
        break
      case 'review.changed':
        reloadReviewsSoon()
        break
      case 'proposals.changed':
        if (state.interview.get() !== null) reloadInterviewSoon()
        break
      case 'preview.changed':
        if (body.conversationId === null) launch(reloadPreviews)
        else if (state.previews.get().has(body.conversationId)) launch(loadPreviews(body.conversationId))
        break
      case 'debate.changed':
        reloadShownDebate(app, body.debateId)
        if (state.route.get().name !== 'debates' && state.debatesLoaded.get()) reloadDebatesSoon()
        break
      case 'presence': {
        state.directory.update((entries) => withPresence(entries, body.members))
        state.channels.update((channels) => withAgentPresence(channels, body.members))
        const mine = body.members.find((change) => change.memberId === signedIn(state)?.member.id)
        if (mine?.agentOnline === true) refreshAgentsIfNoneKnown()
        if (mine?.agentUnavailable !== undefined) reloadDirectorySoon()
        break
      }
      case 'resync':
        reloadEverything(app)
        break
    }
  }
  return (event) => batch(() => apply(event))
}

/** Several directory, group, review or debate room changes in a row are loaded once, after they settle. */
export const DIRECTORY_SETTLE_MS = 400

const leaveRoomIfShown = (app: App, conversationId: string): void => {
  const current = app.state.route.get()
  if (current.name === 'conversation' && current.id === conversationId)
    app.page.replace(hrefFor({ name: 'channels' }))
}

const announceIfFresh = (app: App, note: AsRead.Note): void => {
  const isMine = note.authorId === signedIn(app.state)?.member.id
  const isFresh = app.clock.now() - (note.sentAt ?? 0) < FRESH_MS
  const room = app.state.conversations.get().find((conversation) => conversation.id === note.conversationId)
  if (isMine || !isFresh || (room !== undefined && isMuted(room))) return
  app.state.announcement.set(
    strings.incomingNote({ name: app.state.members.get().get(note.authorId)?.name ?? strings.formerMember }),
  )
}

/** A reply given up on is told to its sender and the channel's managers, who can try it again. */
const tellIfNotPosted = (app: App, note: AsRead.Note): void => {
  if (note.posting !== 'failed') return
  const channel = channelOfRoom(app.state.channels.get(), note.conversationId)
  const isSender = (note.approvedBy ?? note.authorId) === signedIn(app.state)?.member.id
  if (!isSender && channel?.managing !== true) return
  app.state.notice.set({
    kind: 'error',
    text: strings.slack.notPostedNotice({ channel: channel?.link?.name ?? '' }),
  })
}

const reloadShownDebate = (app: App, id: string): void => {
  const current = app.state.route.get()
  if (current.name === 'debates') app.launch(loadDebates)
  if (current.name === 'debate' && current.id === id) app.launch(loadDebate(id))
}

const reloadEverything = (app: App): void => {
  app.launch(loadWorkspace)
  if (app.state.groupsLoaded.get()) app.launch(loadGroups)
  const current = app.state.route.get()
  if (current.name === 'conversation') app.launch(loadThread(current.id as ConversationId))
  app.launch(reloadPreviews)
}

/** A note counts as just arrived, and is announced, while it is this fresh. */
const FRESH_MS = 30_000
