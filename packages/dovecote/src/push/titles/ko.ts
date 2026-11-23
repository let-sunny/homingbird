import type { PushTitles } from '../titles.ts'

export const ko: PushTitles = {
  noteFrom: (author) => `${author}님이 보낸 노트`,
  noteFromColleague: '동료가 보낸 노트',
  draftWaiting: '승인을 기다리는 초안이 있어요',
  reviewWaiting: (channel) => `${channel} · 검토를 기다리는 답변이 있어요`,
  notPosted: (channel) => `Slack ${channel}에 올리지 못했어요 · 열어서 다시 시도하세요`,
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
  meeting: {
    colleague: '동료',
    waits: (room) => `${room} · 시간을 찾았어요`,
    waitsBody: {
      send: '열어서 초대장을 보내세요.',
      add: '열어서 회의를 캘린더에 넣으세요.',
    },
    added: (room) => `${room} · 캘린더에 들어갔어요`,
    addedBody: '에이전트가 회의를 넣었어요. 열어서 뺄 수 있어요.',
    cancelled: (room) => `${room} · 취소됐어요`,
    cancelledBody: '방을 연 사람이 회의를 뺐어요.',
    busy: (room, person) => `${room} · ${person}님은 그 시간에 일정이 있어요`,
    busyBody: '그 시간에 캘린더가 차 있어요. 열어서 다른 시간을 찾으세요.',
    left: (room, person) => `${room} · ${person}님이 빠졌어요`,
    leftBody: {
      took_out: '회의를 뺐어요. 열어서 다시 잡으세요.',
      declined: '참석할 수 없대요. 열어서 다시 잡으세요.',
    },
    removeByHand: (room) => `${room} · 직접 빼 주세요`,
    removeByHandBody: '에이전트가 캘린더에서 회의를 빼지 못했어요.',
  },
}
