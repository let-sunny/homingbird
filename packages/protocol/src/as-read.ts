import type { Schema as S } from '@homingbird/kernel'
import type { ChannelAgent as ChannelAgentSchema, Review as ReviewSchema } from './channel-agents.ts'
import type { ChannelTeaching as ChannelTeachingSchema } from './channel-teaching.ts'
import type {
  InboxItem as InboxItemSchema,
  JoinCode as JoinCodeSchema,
  Me as MeSchema,
  ServerInfo as ServerInfoSchema,
} from './contract-schemas.ts'
import type { DebateResult as DebateResultSchema } from './debate-result.ts'
import type {
  DebateAsk as DebateAskSchema,
  DebateExport as DebateExportSchema,
  Debate as DebateSchema,
  DebateStatus as DebateStatusSchema,
  DebateSummary as DebateSummarySchema,
} from './debates.ts'
import type { DeskWake as DeskWakeSchema, DeskWakeTest as DeskWakeTestSchema } from './desk-wake.ts'
import type {
  DraftPreviewAllowance as DraftPreviewAllowanceSchema,
  DraftPreview as DraftPreviewSchema,
} from './draft-previews.ts'
import type { EarlierAnswer as EarlierAnswerSchema } from './earlier-answers.ts'
import type { StreamEvent as StreamEventSchema } from './events.ts'
import type { Group as GroupSchema } from './groups.ts'
import type {
  AgentFigures as AgentFiguresSchema,
  AgentMiss as AgentMissSchema,
  AgentPeriod as AgentPeriodSchema,
  AgentReport as AgentReportSchema,
  ChannelAgentFigures as ChannelAgentFiguresSchema,
  ChannelAgentReport as ChannelAgentReportSchema,
} from './insights.ts'
import type { InviteLink as InviteLinkSchema, Invite as InviteSchema } from './invites.ts'
import type {
  AgentCredentialsHeld as AgentCredentialsHeldSchema,
  Channel as ChannelSchema,
  Contact as ContactSchema,
  Conversation as ConversationSchema,
  Credential as CredentialSchema,
  DirectoryEntry as DirectoryEntrySchema,
  Member as MemberSchema,
  Note as NoteSchema,
  NoteStatus as NoteStatusSchema,
  Notice as NoticeSchema,
  Presence as PresenceSchema,
  Receipt as ReceiptSchema,
  Settings as SettingsSchema,
} from './model.ts'
import type {
  Achievement as AchievementSchema,
  DraftingPrinciples as DraftingPrinciplesSchema,
  MyPrinciples as MyPrinciplesSchema,
  PrincipleOffer as PrincipleOfferSchema,
  Principle as PrincipleSchema,
} from './principles.ts'
import type {
  AdminSlack as AdminSlackSchema,
  MeSlack as MeSlackSchema,
  SlackCodeView as SlackCodeViewSchema,
} from './slack.ts'

/** Responses as a client reads them: an enum value or an event a newer server added reads as "unknown". */
export type Note = S.Read<typeof NoteSchema>
export type EarlierAnswer = S.Read<typeof EarlierAnswerSchema>
export type NoteStatus = S.Read<typeof NoteStatusSchema>
export type Receipt = S.Read<typeof ReceiptSchema>
export type Conversation = S.Read<typeof ConversationSchema>
export type InboxItem = S.Read<typeof InboxItemSchema>
export type Notice = S.Read<typeof NoticeSchema>
export type Member = S.Read<typeof MemberSchema>
export type AgentCredentialsHeld = S.Read<typeof AgentCredentialsHeldSchema>
export type Me = S.Read<typeof MeSchema>
export type DirectoryEntry = S.Read<typeof DirectoryEntrySchema>
export type Presence = S.Read<typeof PresenceSchema>
export type Contact = S.Read<typeof ContactSchema>
export type Credential = S.Read<typeof CredentialSchema>
export type Channel = S.Read<typeof ChannelSchema>
export type Group = S.Read<typeof GroupSchema>
export type Settings = S.Read<typeof SettingsSchema>
export type StreamEvent = S.Read<typeof StreamEventSchema>
export type EventBody = StreamEvent['body']
/** An event of a kind this client knows: the only ones an event stream passes on. */
export type KnownEvent = StreamEvent & { readonly body: Exclude<EventBody, { readonly type: 'unknown' }> }
export type Debate = S.Read<typeof DebateSchema>
export type DebateStatus = S.Read<typeof DebateStatusSchema>
export type DebateSummary = S.Read<typeof DebateSummarySchema>
export type DebateAsk = S.Read<typeof DebateAskSchema>
export type DebateResult = S.Read<typeof DebateResultSchema>
export type DebateExport = S.Read<typeof DebateExportSchema>
export type MyPrinciples = S.Read<typeof MyPrinciplesSchema>
export type Principle = S.Read<typeof PrincipleSchema>
export type PrincipleOffer = S.Read<typeof PrincipleOfferSchema>
export type DraftingPrinciples = S.Read<typeof DraftingPrinciplesSchema>
export type ChannelTeaching = S.Read<typeof ChannelTeachingSchema>
export type Achievement = S.Read<typeof AchievementSchema>
export type AgentReport = S.Read<typeof AgentReportSchema>
export type ChannelAgentReport = S.Read<typeof ChannelAgentReportSchema>
export type ChannelAgentFigures = S.Read<typeof ChannelAgentFiguresSchema>
export type AgentPeriod = S.Read<typeof AgentPeriodSchema>
export type AgentMiss = S.Read<typeof AgentMissSchema>
export type AgentFigures = S.Read<typeof AgentFiguresSchema>
export type ServerInfo = S.Read<typeof ServerInfoSchema>
export type ChannelAgent = S.Read<typeof ChannelAgentSchema>
export type Review = S.Read<typeof ReviewSchema>
export type DeskWake = S.Read<typeof DeskWakeSchema>
export type DeskWakeTest = S.Read<typeof DeskWakeTestSchema>
export type AdminSlack = S.Read<typeof AdminSlackSchema>
export type MeSlack = S.Read<typeof MeSlackSchema>
export type SlackCodeView = S.Read<typeof SlackCodeViewSchema>
export type DraftPreview = S.Read<typeof DraftPreviewSchema>
export type DraftPreviewAllowance = S.Read<typeof DraftPreviewAllowanceSchema>
export type JoinCode = S.Read<typeof JoinCodeSchema>
export type Invite = S.Read<typeof InviteSchema>
export type InviteLink = S.Read<typeof InviteLinkSchema>
