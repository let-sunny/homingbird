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
  deskUnavailable: '지금은 에이전트가 답할 수 없어요',
  deskUnavailableBody: {
    usage_limit: '사용 한도에 도달했어요. 다시 답할 수 있을 때까지 노트는 전달됨 상태로 기다려요.',
    signed_out: '로그인이 풀렸어요. 데스크가 실행되는 컴퓨터에서 다시 로그인하세요.',
    failed: '명령이 계속 실패하고 있어요. 내 에이전트 → 연결에서 이유를 확인하세요.',
  },
}
