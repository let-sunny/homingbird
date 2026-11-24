import type { Task as T } from '@homingbird/kernel'
import type { Action, Launch, Then } from './app.ts'
import { pushIsOn, testPush, turnPushOff, turnPushOn } from './push.ts'
import * as account from './tasks/account.ts'
import * as activity from './tasks/activity.ts'
import * as admin from './tasks/admin.ts'
import { startAgain } from './tasks/boot.ts'
import * as channelAgents from './tasks/channel-agents.ts'
import * as channelTeaching from './tasks/channel-teaching.ts'
import * as channels from './tasks/channels.ts'
import * as cloudDesk from './tasks/cloud-desk.ts'
import * as conversationActions from './tasks/conversation-actions.ts'
import * as debateSuggestions from './tasks/debate-suggestions.ts'
import * as debates from './tasks/debates.ts'
import * as drafts from './tasks/drafts.ts'
import * as earlierAnswers from './tasks/earlier-answers.ts'
import * as groups from './tasks/groups.ts'
import * as held from './tasks/held.ts'
import * as mutes from './tasks/mutes.ts'
import * as notes from './tasks/notes.ts'
import * as people from './tasks/people.ts'
import * as previews from './tasks/previews.ts'
import * as resources from './tasks/resources.ts'
import * as scheduling from './tasks/scheduling.ts'
import * as slack from './tasks/slack.ts'
import * as interview from './tasks/teaching-interview.ts'
import * as teaching from './tasks/teaching.ts'

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
  startAgain: () => startAgain,
  loadAgents: () => resources.open('agentCredentials', 'draftRequests'),
  reloadAgents: () => resources.invalidate('agentCredentials', 'draftRequests'),
  loadActivity: () => activity.loadActivity,
  loadAwaitedThreads: () => activity.loadAwaitedThreads,
  loadDraftThreads: () => activity.loadDraftThreads,
  askActivityAgain: () => resources.againWhatIsStuck,
  acceptSuggestion: debateSuggestions.acceptSuggestion,
  dismissSuggestion: debateSuggestions.dismissSuggestion,
  loadPeople: () => resources.open('directory'),
  loadKnownChannels: () => resources.open('channels'),
  reloadKnownChannels: () => resources.invalidate('channels'),
  openThread: notes.openThread,
  loadOlderNotes: notes.loadOlderNotes,
  sendNote: notes.sendNote,
  recallNote: notes.recallNote,
  markRead: notes.markRead,
  chooseReplyTarget: notes.chooseReplyTarget,
  replyTo: notes.replyTo,
  keepComposerText: notes.keepComposerText,
  keepComposerTags: notes.keepComposerTags,
  findEarlierAnswers: earlierAnswers.findEarlierAnswers,
  markAnsweredFromHistory: earlierAnswers.markAnsweredFromHistory,
  setMuted: mutes.setMuted,
  chooseNotificationLevel: mutes.chooseNotificationLevel,
  setHidden: conversationActions.setHidden,
  leaveGroup: conversationActions.leaveGroup,
  approveDraft: drafts.approveDraft,
  saveDraft: drafts.saveDraft,
  confirmDraftRead: drafts.confirmDraftRead,
  discardDraft: drafts.discardDraft,
  holdSend: drafts.holdSend,
  holdDiscard: drafts.holdDiscard,
  commitHeld: () => held.commitHeld,
  undoHeld: () => held.undoHeld,
  forgetSettled: () => held.forgetSettled,
  keepDraftEdit: held.keepDraftEdit,
  readdressDraft: drafts.readdressDraft,
  reportDraftSeen: drafts.reportDraftSeen,
  askAgent: drafts.askAgent,
  withdrawRequest: drafts.withdrawRequest,
  refreshAgentReport: () => teaching.refreshAgentReport,
  refreshPrinciples: () => teaching.refreshPrinciples,
  savePrinciple: teaching.savePrinciple,
  changePrinciple: teaching.changePrinciple,
  setAutoSend: teaching.setAutoSend,
  reorderPrinciples: teaching.reorderPrinciples,
  deletePrinciple: teaching.deletePrinciple,
  markPrincipleWrong: teaching.markPrincipleWrong,
  dismissOffer: teaching.dismissOffer,
  refreshInterview: () => interview.refreshInterview,
  saveTeachingDocument: interview.saveTeachingDocument,
  acceptProposal: interview.acceptProposal,
  acceptProposals: interview.acceptProposals,
  discardProposal: interview.discardProposal,
  openChannelPage: () => channels.openChannelPage,
  loadChannelPage: channels.loadChannelPage,
  reloadChannelPage: () => channels.reloadChannelPage,
  createChannel: channels.createChannel,
  joinChannel: channels.joinChannel,
  leaveChannel: channels.leaveChannel,
  setAnswering: channels.setAnswering,
  loadChannelMembers: channels.loadChannelMembers,
  setChannelMember: channels.setChannelMember,
  addTeam: channels.addTeam,
  askChannel: channels.askChannel,
  enterRoom: channels.enterRoom,
  createChannelThenReaddress: (
    channel: { readonly slug: string; readonly description: string },
    draft: Parameters<typeof drafts.readdressDraft>[0],
  ) => channels.createChannelThen(channel, (slug) => drafts.readdressDraft(draft, slug)),
  reviseChannel: channels.reviseChannel,
  archiveChannel: channels.archiveChannel,
  refreshReviews: () => channelAgents.refreshReviews,
  loadDecidedAnswer: channelAgents.loadDecidedAnswer,
  sendReview: channelAgents.sendReview,
  discardReview: channelAgents.discardReview,
  holdReviewSend: channelAgents.holdReviewSend,
  holdReviewDiscard: channelAgents.holdReviewDiscard,
  confirmReviewRead: channelAgents.confirmReviewRead,
  loadChannelAgent: channelAgents.loadChannelAgent,
  loadChannelAgentFigures: channelAgents.loadChannelAgentFigures,
  loadChannelDecisions: channelAgents.loadChannelDecisions,
  createChannelAgent: channelAgents.createChannelAgent,
  renameChannelAgent: channelAgents.renameChannelAgent,
  retireChannelAgent: channelAgents.retireChannelAgent,
  disconnectAgentDesk: channelAgents.disconnectAgentDesk,
  askPrivately: channelAgents.askPrivately,
  loadChannelTeaching: channelTeaching.loadChannelTeaching,
  saveChannelInstruction: channelTeaching.saveChannelInstruction,
  saveChannelPrinciple: channelTeaching.saveChannelPrinciple,
  changeChannelPrinciple: channelTeaching.changeChannelPrinciple,
  reorderChannelPrinciples: channelTeaching.reorderChannelPrinciples,
  deleteChannelPrinciple: channelTeaching.deleteChannelPrinciple,
  loadGroups: () => resources.open('groups'),
  loadGroupsAgain: () => resources.again('groups'),
  renameGroup: groups.renameGroup,
  setGroupMembers: groups.setGroupMembers,
  createGroup: groups.createGroup,
  deleteGroup: groups.deleteGroup,
  listPeopleInGroup: groups.listPeopleInGroup,
  readImportFile: groups.readImportFile,
  openConversationWith: people.openConversationWith,
  openConversationAmong: people.openConversationAmong,
  sendNoteAmong: people.sendNoteAmong,
  askAgentAmong: people.askAgentAmong,
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
  createJoinCode: account.createJoinCode,
  joinCodeStatus: account.joinCodeStatus,
  listInvites: () => account.listInvites,
  createInvite: account.createInvite,
  revokeInvite: account.revokeInvite,
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
  loadPreviews: previews.loadPreviews,
  loadPreviewAllowance: () => previews.loadPreviewAllowance,
  savePreviewAllowance: previews.savePreviewAllowance,
  loadDeskWake: () => cloudDesk.loadDeskWake,
  saveDeskWake: cloudDesk.saveDeskWake,
  removeDeskWake: () => cloudDesk.removeDeskWake,
  testDeskWake: () => cloudDesk.testDeskWake,
  loadMySlack: () => slack.loadMySlack,
  connectSlack: () => slack.connectSlack,
  readSlackCode: slack.readSlackCode,
  linkSlack: slack.linkSlack,
  unlinkSlack: () => slack.unlinkSlack,
  loadAdminSlack: () => slack.loadAdminSlack,
  saveSlackCredentials: slack.saveSlackCredentials,
  removeSlackCredentials: () => slack.removeSlackCredentials,
  retrySlackPost: slack.retrySlackPost,
  linkSlackChannel: slack.linkSlackChannel,
  unlinkSlackChannel: slack.unlinkSlackChannel,
  loadSettings: () => admin.loadSettings,
  saveSettings: admin.saveSettings,
  listMembers: () => admin.listMembers,
  updateMember: admin.updateMember,
  resetMemberCharacter: admin.resetMemberCharacter,
  loadInsights: () => admin.loadInsights,
  openDebateList: () => debates.openDebateList,
  askDebateListAgain: () => debates.askDebateListAgain,
  loadDebate: debates.loadDebate,
  createDebate: debates.createDebate,
  createSchedulingRoom: debates.createSchedulingRoom,
  setMyFreeTimes: debates.setMyFreeTimes,
  addMeeting: debates.addMeeting,
  removeMeeting: debates.removeMeeting,
  retrySchedulingRoom: scheduling.retrySchedulingRoom,
  loadSchedulingDelegation: () => scheduling.loadSchedulingDelegation,
  saveSchedulingDelegation: scheduling.saveSchedulingDelegation,
  optInAgent: debates.optInAgent,
  setBrief: debates.setBrief,
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
