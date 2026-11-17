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

export const helpingFirst = (a: Topic, b: Topic): number =>
  Number(b.helping) - Number(a.helping) ||
  Number(b.slug === GENERAL_TOPIC) - Number(a.slug === GENERAL_TOPIC) ||
  a.slug.localeCompare(b.slug)

const SLUG_MAX = 40
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
