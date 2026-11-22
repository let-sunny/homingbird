import { Schema as S } from '@homingbird/kernel'

export const PRINCIPLE_SOURCE_MAX = 500

/** Linked material a principle or a channel's teaching names, read by an agent as data. */
export const PrincipleSource = S.string({
  maxLength: PRINCIPLE_SOURCE_MAX,
  pattern: /^https?:\/\/[^\s/]+(\/\S*)?$/,
})
