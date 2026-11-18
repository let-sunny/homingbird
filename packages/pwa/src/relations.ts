import type { ContactMode, DirectoryEntry, Relation } from '@homingbird/protocol'

export const shownRelation = (entry: Pick<DirectoryEntry, 'relation'>, mode: ContactMode): Relation =>
  mode === 'open' && entry.relation !== 'self' && entry.relation !== 'blocked' ? 'none' : entry.relation
