import type { Conversation, ConversationId, MemberId, Topic, TopicMember } from '@homingbird/protocol'

export const topicLabel = (slug: string): string => `#${slug}`

export const slugFrom = (typed: string): string =>
  typed
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)

export const isValidSlug = (slug: string): boolean => SLUG_PATTERN.test(slug)

export const similarTopics = (topics: ReadonlyArray<Topic>, typed: string): Topic[] => {
  const wanted = slugFrom(typed).replace(/-+$/, '')
  if (wanted === '') return []
  return topics
    .filter((topic) => topic.slug.includes(wanted) || wanted.includes(topic.slug))
    .sort((a, b) => Number(b.slug === wanted) - Number(a.slug === wanted) || a.slug.localeCompare(b.slug))
}

export const topicNamed = (topics: ReadonlyArray<Topic>, slug: string): Topic | null =>
  topics.find((topic) => topic.slug === slug) ?? null

export const topicOfRoom = (topics: ReadonlyArray<Topic>, conversationId: ConversationId): Topic | null =>
  topics.find((topic) => topic.conversationId === conversationId) ?? null

export const topicRooms = (conversations: ReadonlyArray<Conversation>): Conversation[] =>
  conversations
    .filter((conversation) => conversation.kind === 'topic' && !isArchivedRoom(conversation))
    .sort(byTitle)

export const archivedRooms = (conversations: ReadonlyArray<Conversation>): Conversation[] =>
  conversations.filter(isArchivedRoom).sort(byTitle)

export const peopleConversations = (conversations: ReadonlyArray<Conversation>): Conversation[] =>
  conversations.filter((conversation) => conversation.kind !== 'topic' && !isArchivedRoom(conversation))

export const joinedFirst = (a: Topic, b: Topic): number =>
  Number(b.joined) - Number(a.joined) || b.memberCount - a.memberCount || a.slug.localeCompare(b.slug)

export const destinationsFrom = (
  topics: ReadonlyArray<Topic>,
  here: Topic | null,
  movingFrom: Topic | null,
): Topic[] =>
  topics.filter((topic) => topic.slug !== here?.slug && mayMoveBetween(movingFrom, topic)).sort(joinedFirst)

export const mayMoveBetween = (from: Topic | null, to: Topic): boolean =>
  from !== null && isPrivate(from) ? isPrivate(to) && to.joined : !isPrivate(to) || to.joined

export const isPrivate = (topic: Topic): boolean => topic.visibility === 'private'

export const withTopic = (topics: ReadonlyArray<Topic>, changed: Topic): Topic[] =>
  topics.some((topic) => topic.slug === changed.slug)
    ? topics.map((topic) => (topic.slug === changed.slug ? changed : topic))
    : [...topics, changed].sort((a, b) => a.slug.localeCompare(b.slug))

export const withoutRoom = (
  topics: ReadonlyArray<Topic>,
  conversationId: ConversationId,
  viewerIsAdmin: boolean,
): Topic[] =>
  topics.flatMap((topic) =>
    topic.conversationId !== conversationId
      ? [topic]
      : isPrivate(topic) && !viewerIsAdmin
        ? []
        : [{ ...topic, joined: false, answering: false, managing: viewerIsAdmin }],
  )

export const chipsForPerson = (
  theirs: ReadonlyArray<string>,
  mine: ReadonlySet<string>,
  shown = CHIPS_SHOWN,
): { readonly first: string[]; readonly rest: string[] } => {
  const ordered = [...theirs].sort((a, b) => Number(mine.has(b)) - Number(mine.has(a)))
  const keep = ordered.length > shown + 1 ? shown : ordered.length
  return { first: ordered.slice(0, keep), rest: ordered.slice(keep) }
}

export interface Roster {
  readonly memberCount: number
  readonly members: ReadonlyArray<TopicMember>
}

export interface RosterFacts {
  readonly hasManager: boolean
  readonly lastManagerId: MemberId | null
  readonly viewerIsLastManager: boolean
}

export const rosterFacts = (roster: Roster | null, viewerId: MemberId | null): RosterFacts => {
  const managers = (roster?.members ?? []).filter((member) => member.manager)
  const lastManagerId = managers.length === 1 ? managers[0]!.memberId : null
  return {
    hasManager: managers.length > 0,
    lastManagerId,
    viewerIsLastManager:
      lastManagerId !== null && lastManagerId === viewerId && (roster?.members.length ?? 0) > 1,
  }
}

const isArchivedRoom = (conversation: Conversation): boolean => conversation.archivedAt !== null

const byTitle = (a: Conversation, b: Conversation): number => (a.title ?? '').localeCompare(b.title ?? '')

const SLUG_MAX = 40
const CHIPS_SHOWN = 6
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
