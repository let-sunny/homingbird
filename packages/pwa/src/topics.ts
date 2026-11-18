import { type Conversation, type ConversationId, GENERAL_TOPIC, type Topic } from '@homingbird/protocol'

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
    .filter((conversation) => conversation.kind === 'topic')
    .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))

export const peopleConversations = (conversations: ReadonlyArray<Conversation>): Conversation[] =>
  conversations.filter((conversation) => conversation.kind !== 'topic')

export const canRename = (slug: string): boolean => slug !== GENERAL_TOPIC

export const answeringFirst = (a: Topic, b: Topic): number =>
  Number(b.answering) - Number(a.answering) ||
  Number(b.joined) - Number(a.joined) ||
  Number(b.slug === GENERAL_TOPIC) - Number(a.slug === GENERAL_TOPIC) ||
  a.slug.localeCompare(b.slug)

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

const SLUG_MAX = 40
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
