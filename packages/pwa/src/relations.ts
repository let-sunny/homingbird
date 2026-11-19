import { type AsRead, type Relation, UNKNOWN } from '@homingbird/protocol'

/** A relation or contact mode this client does not know is shown as no contact, never as one. */
export const shownRelation = (
  entry: Pick<AsRead.DirectoryEntry, 'relation'>,
  mode: AsRead.Settings['contactMode'],
): Relation =>
  entry.relation === UNKNOWN || (mode === 'open' && entry.relation !== 'self' && entry.relation !== 'blocked')
    ? 'none'
    : entry.relation
