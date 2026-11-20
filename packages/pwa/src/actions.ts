import type { Task as T } from '@homingbird/kernel'
import type { Action, Launch, Then } from './app.ts'
import { pushIsOn, testPush, turnPushOff, turnPushOn } from './push.ts'
import * as account from './tasks/account.ts'
import * as admin from './tasks/admin.ts'
import * as channels from './tasks/channels.ts'
import * as debates from './tasks/debates.ts'
import * as drafts from './tasks/drafts.ts'
import * as groups from './tasks/groups.ts'
import * as notes from './tasks/notes.ts'
import * as people from './tasks/people.ts'
import * as teaching from './tasks/teaching.ts'
import * as workspace from './tasks/workspace.ts'

/**
 * What a view may ask for, by name: each starts its task and reports a failure as a notice. A view
 * passes what it needs to know afterwards as a last `Then` argument.
 */
export const createActions = (launch: Launch): Actions =>
  Object.fromEntries(
    Object.entries(TASKS).map(([name, task]) => [
      name,
      (...args: unknown[]) => {
        const then = args.length > task.length ? (args.pop() as Then<unknown>) : undefined
        launch((task as (...given: unknown[]) => Action<unknown>)(...args), then)
      },
    ]),
  ) as unknown as Actions

/** Every task a view may start; a task takes no optional argument, so a trailing `Then` is never mistaken for one. */
export const TASKS = {
  loadWorkspace: () => workspace.loadWorkspace,
  loadAgents: () => workspace.loadAgents,
  loadConversations: () => workspace.loadConversations,
  loadPeople: () => workspace.loadPeople,
  loadKnownChannels: () => workspace.loadKnownChannels,
  openThread: notes.openThread,
  loadOlderNotes: notes.loadOlderNotes,
  sendNote: notes.sendNote,
  markRead: notes.markRead,
  chooseReplyTarget: notes.chooseReplyTarget,
  approveDraft: drafts.approveDraft,
  saveDraft: drafts.saveDraft,
  confirmDraftRead: drafts.confirmDraftRead,
  discardDraft: drafts.discardDraft,
  readdressDraft: drafts.readdressDraft,
  reportDraftSeen: drafts.reportDraftSeen,
  askAgent: drafts.askAgent,
  withdrawRequest: drafts.withdrawRequest,
  refreshAgentReport: () => teaching.refreshAgentReport,
  refreshPrinciples: () => teaching.refreshPrinciples,
  savePrinciple: teaching.savePrinciple,
  changePrinciple: teaching.changePrinciple,
  reorderPrinciples: teaching.reorderPrinciples,
  deletePrinciple: teaching.deletePrinciple,
  markPrincipleWrong: teaching.markPrincipleWrong,
  dismissOffer: teaching.dismissOffer,
  loadChannelPage: channels.loadChannelPage,
  createChannel: channels.createChannel,
  joinChannel: channels.joinChannel,
  leaveChannel: channels.leaveChannel,
  setAnswering: channels.setAnswering,
  loadChannelMembers: channels.loadChannelMembers,
  setChannelMember: channels.setChannelMember,
  addTeam: channels.addTeam,
  setChannelVisibility: channels.setChannelVisibility,
  askChannel: channels.askChannel,
  enterRoom: channels.enterRoom,
  moveQuestion: channels.moveQuestion,
  createChannelThenMove: (
    channel: { readonly slug: string; readonly description: string },
    note: Parameters<typeof channels.moveQuestion>[0],
  ) => channels.createChannelThen(channel, (slug) => channels.moveQuestion(note, slug)),
  createChannelThenReaddress: (
    channel: { readonly slug: string; readonly description: string },
    draft: Parameters<typeof drafts.readdressDraft>[0],
  ) => channels.createChannelThen(channel, (slug) => drafts.readdressDraft(draft, slug)),
  reviseChannel: channels.reviseChannel,
  archiveChannel: channels.archiveChannel,
  loadGroups: () => groups.loadGroups,
  renameGroup: groups.renameGroup,
  setGroupMembers: groups.setGroupMembers,
  createGroup: groups.createGroup,
  deleteGroup: groups.deleteGroup,
  listPeopleInGroup: groups.listPeopleInGroup,
  readImportFile: groups.readImportFile,
  openConversationWith: people.openConversationWith,
  openConversationAmong: people.openConversationAmong,
  requestContact: people.requestContact,
  acceptContact: people.acceptContact,
  removeContact: people.removeContact,
  blockMember: people.blockMember,
  unblockMember: people.unblockMember,
  searchNotes: people.searchNotes,
  updateProfile: account.updateProfile,
  useCharacter: account.useCharacter,
  chooseLanguage: account.chooseLanguage,
  listCredentials: () => account.listCredentials,
  renameCredential: account.renameCredential,
  revokeCredential: account.revokeCredential,
  lookUpDevice: account.lookUpDevice,
  decideDevice: account.decideDevice,
  lookUpConsent: account.lookUpConsent,
  decideConsent: account.decideConsent,
  returnAfterAMoment: account.returnAfterAMoment,
  signOut: () => account.signOut,
  pushIsOn: () => pushIsOn,
  turnPushOn: () => turnPushOn,
  turnPushOff: () => turnPushOff,
  testPush: () => testPush,
  loadSettings: () => admin.loadSettings,
  saveSettings: admin.saveSettings,
  listMembers: () => admin.listMembers,
  updateMember: admin.updateMember,
  resetMemberCharacter: admin.resetMemberCharacter,
  loadInsights: () => admin.loadInsights,
  loadDebates: () => debates.loadDebates,
  loadDebate: debates.loadDebate,
  createDebate: debates.createDebate,
  optInAgent: debates.optInAgent,
  changeLimits: debates.changeLimits,
  postResult: debates.postResult,
  exportDebate: debates.exportDebate,
} satisfies Readonly<Record<string, (...args: never[]) => Action<unknown>>>

export type Tasks = typeof TASKS

/** The tasks as a view calls them: the same arguments, and what to do afterwards. */
export type Actions = {
  readonly [Name in keyof Tasks]: (
    ...args: [...Parameters<Tasks[Name]>, then?: Then<T.ValueOf<ReturnType<Tasks[Name]>>>]
  ) => void
}
