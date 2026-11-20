/** One draft's notifications share a tag, so a repeat replaces the last and a page can close it. */
export const noticeTag = (kind: NoticeTagKind, noteId: string): string => `${kind}:${noteId}`

export const noteIdOfNoticeTag = (kind: NoticeTagKind, tag: string): string | null =>
  tag.startsWith(`${kind}:`) && tag.length > kind.length + 1 ? tag.slice(kind.length + 1) : null

/** `review` for a channel's agent's answer waiting for a manager, `draft` for a person's own draft. */
export type NoticeTagKind = 'review' | 'draft'
