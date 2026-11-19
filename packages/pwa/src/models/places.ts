import type { PlaceName } from '@homingbird/protocol'
import { channelLabel } from '../channels.ts'
import { strings } from '../strings.ts'

/** Where an agent drafts, in words: a channel by its label, else direct messages. */
export const placeName = (place: PlaceName): string =>
  place === null ? strings.trust.directMessages : channelLabel(place)
