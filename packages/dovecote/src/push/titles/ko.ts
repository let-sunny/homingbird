import type { PushTitles } from '../titles.ts'

export const ko: PushTitles = {
  noteFrom: (author) => `${author}님이 보낸 노트`,
  noteFromColleague: '동료가 보낸 노트',
  draftWaiting: '승인을 기다리는 초안이 있어요',
  reviewWaiting: (channel) => `${channel} · 검토를 기다리는 답변이 있어요`,
  test: 'Homingbird 알림 테스트',
  testBody: '이 기기에서 알림을 받을 수 있어요.',
  deskStopped: '클라우드 데스크를 더 이상 깨우지 않아요',
  deskStoppedBody: 'Homingbird가 깨우기를 멈췄어요. 내 에이전트 → 연결에서 이유를 보고 다시 설정하세요.',
}
