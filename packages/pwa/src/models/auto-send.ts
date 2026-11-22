import {
  AUTO_SEND_PLACES_MAX,
  type AsRead,
  type AutoSend,
  type ConversationId,
  type MemberId,
} from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { conversationTitle, isArchived } from '../thread.ts'

/**
 * The choice of whether a saved answer sends itself and where, as its dialog shows it; null for an item
 * that cannot send itself, or while the organization does not allow it.
 */
export const autoSendFormModel = (
  principle: AsRead.Principle,
  places: ReadonlyArray<AutoSendPlace>,
): AutoSendFormModel | null => {
  const setting = principle.autoSend
  if (setting === undefined || !canSendItself(principle)) return null
  return {
    title: strings.autoSend.dialogTitle({ name: principle.topic }),
    switchLabel: strings.autoSend.switchLabel,
    hint: strings.autoSend.hint,
    placesLabel: strings.autoSend.placesLabel,
    placesHint: strings.autoSend.placesHint,
    enabled: setting.enabled,
    places: places.map((place) => ({ ...place, chosen: setting.places.includes(place.id) })),
    noPlaces: places.length === 0 ? strings.autoSend.noPlaces : null,
    save: strings.autoSend.save,
  }
}

/** Whether an item may send itself: a saved answer with its own text, while the organization allows it. */
export const canSendItself = (principle: AsRead.Principle): boolean =>
  principle.autoSend !== undefined && principle.kind === 'answer' && principle.rule.trim() !== ''

/**
 * Where a saved answer may send itself, by the names the person knows: the direct conversations and the
 * open channels they are in, alphabetically. Private channels, group messages and private questions are
 * never offered; the server refuses them too.
 */
export const autoSendPlaces = (input: {
  readonly conversations: ReadonlyArray<AsRead.Conversation>
  readonly channels: ReadonlyArray<AsRead.Channel>
  readonly members: ReadonlyMap<MemberId, AsRead.Member>
  readonly viewerId: MemberId
}): AutoSendPlace[] => {
  const openRooms = new Set(
    input.channels
      .filter((channel) => channel.joined && channel.visibility === 'open')
      .map((channel) => channel.conversationId),
  )
  return input.conversations
    .filter(
      (room) =>
        !isArchived(room) &&
        (room.privateQuestionOf ?? null) === null &&
        (room.kind === 'direct' || (room.kind === 'channel' && openRooms.has(room.id))),
    )
    .map((room) => ({
      id: room.id,
      label: conversationTitle(room, input.members, input.viewerId, strings.formerMember),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** What saving the dialog sends, or why it cannot be saved yet. */
export const autoSendToSave = (
  enabled: boolean,
  chosen: ReadonlyArray<ConversationId>,
): { readonly problem: string } | { readonly save: AutoSend } =>
  enabled && chosen.length === 0
    ? { problem: strings.autoSend.needsPlace }
    : { save: { enabled, places: [...new Set(chosen)].slice(0, AUTO_SEND_PLACES_MAX) } }

/** The quiet lines of a saved answer that sends itself: in how many places, and how often it did. */
export const autoSendDetails = (principle: AsRead.Principle): string[] => {
  const setting = principle.autoSend
  if (setting === undefined) return []
  const sent = principle.counts?.autoSent ?? 0
  return [
    ...(setting.enabled ? [strings.autoSend.sendsIn({ count: setting.places.length })] : []),
    ...(sent > 0 ? [strings.autoSend.sentCount({ count: sent })] : []),
  ]
}

export interface AutoSendPlace {
  readonly id: ConversationId
  readonly label: string
}

export interface AutoSendFormModel {
  readonly title: string
  readonly switchLabel: string
  readonly hint: string
  readonly placesLabel: string
  readonly placesHint: string
  readonly enabled: boolean
  readonly places: ReadonlyArray<AutoSendPlace & { readonly chosen: boolean }>
  readonly noPlaces: string | null
  readonly save: string
}
