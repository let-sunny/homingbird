import type { PushTitles } from '../titles.ts'

export const ko: PushTitles = {
  noteFrom: (author) => `${author}님이 보낸 노트`,
  noteFromColleague: '동료가 보낸 노트',
  draftWaiting: '승인을 기다리는 초안이 있어요',
  reviewWaiting: (channel) => `${channel} · 검토를 기다리는 답변이 있어요`,
  test: 'Homingbird 알림 테스트',
  testBody: '이 기기에서 알림을 받을 수 있어요.',
}
