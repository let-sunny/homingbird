import type { PushTitles } from '../titles.ts'

export const ko: PushTitles = {
  noteFrom: (author) => `${author}님이 보낸 노트`,
  noteFromColleague: '동료가 보낸 노트',
  draftWaiting: '승인을 기다리는 초안이 있어요',
}
