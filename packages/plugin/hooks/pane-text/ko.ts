import type { PaneText } from '../pane-text'

export const ko: PaneText = {
  connection: {
    idle: '데스크 아님',
    starting: '시작하는 중',
    live: '데스크 · 실시간',
    reconnecting: '데스크 · 다시 연결하는 중',
    'signed-out': '로그인 안 됨',
    unavailable: '명령줄 도구를 찾을 수 없어요',
  },
  waiting: (count) => `초안 ${count}개 대기 중`,
  keepOpen: '이 세션을 Homingbird 데스크로 열어 두세요.',
  freshSession: (reason) =>
    reason === 'age'
      ? '이 세션은 8시간 넘게 실행됐어요. 새 세션을 열어 데스크로 지정하면 초안이 더 나아질 때가 많아요.'
      : reason === 'context'
        ? '이 세션은 컨텍스트를 거의 다 썼고 자동 압축이 꺼져 있어요. 새 세션을 열어 데스크로 지정하면 초안이 더 나아질 때가 많아요.'
        : '이 세션은 컨텍스트를 거의 다 썼어요. Claude Code가 자동 압축이 켜져 있는지 플러그인에 알려 주지 않아요. 켜져 있다면 무시하세요. 아니라면 새 세션을 열어 데스크로 지정하면 초안이 더 나아질 때가 많아요.',
  sessionFigures: (ageMinutes, contextPercent) =>
    `세션 ${durationOf(ageMinutes)}${contextPercent === null ? '' : ` · 컨텍스트 ${contextPercent}% 사용`}`,
  moved: '이제 다른 세션이 Homingbird 데스크예요. 이 세션은 더 이상 노트에 반응하지 않아요.',
  becomeDesk: '이 세션을 데스크로',
  confirmSignIn: '브라우저에서 로그인을 확인해 주세요. 브라우저가 열리지 않았다면:',
  openSignInPage: '로그인 페이지 열기',
  signInCode: (code) => `코드 ${code}.`,
  signInPrompt: '조직의 Homingbird 서버에 로그인하면 이 세션이 데스크가 돼요.',
  serverUrl: '서버 URL',
  signIn: '로그인',
  memberOn: (member, server) => `${member} · ${server}`,
  draftsWaiting: '승인을 기다리는 초안',
  none: '없음',
  noneYet: '아직 없음',
  notesWaiting: '답장을 기다리는 노트',
  drafting: '초안 작성 중',
  askedForDraft: '초안을 요청했어요',
  askedForDraftWith: (instruction) => `초안을 요청했어요: ${instruction}`,
  conversations: 'DN과 채널',
  unread: (count) => `읽지 않음 ${count}`,
  newNote: '새 노트',
  reply: '답장',
  newNoteBy: (agent) => `${agent}이(가) 쓴 새 노트 초안`,
  replyBy: (agent) => `${agent}이(가) 쓴 답장 초안`,
  inReplyTo: (author, firstLine) => `${author} 님의 노트에 답장: ${firstLine}`,
  approveInWebClient:
    '초안은 직접 로그인한 Homingbird 웹 클라이언트에서만 승인, 수정, 삭제해요. 초안마다 바로 가는 링크가 있어요.',
  awaitingYourApproval: '승인을 기다리고 있어요',
  awaitingManagers: (channel) => `#${channel} 채널 운영자를 기다리고 있어요`,
  openInWebClient: '웹에서 열기',
  deskStatus: (waiting) =>
    waiting === 0 ? 'Homingbird 데스크' : `Homingbird 데스크 · 승인을 기다리는 초안 ${waiting}개`,
  toast: (text) => `Homingbird: ${text}`,
  noteArrived: (author) => `${author} 님이 보낸 노트가 도착했어요. 답장 초안을 쓰고 있어요.`,
  aColleague: '동료',
  draftReadyNotice: 'Homingbird 웹 클라이언트에서 승인할 초안이 준비됐어요.',
  draftingRequest: '요청한 초안을 쓰고 있어요.',
  debateWaiting: (wants) =>
    wants === 'turn'
      ? '플록에서 에이전트의 차례가 왔어요. 플록은 한 번에 한 에이전트에게만 차례를 주고, 제때 쓰지 않으면 다음 에이전트에게 넘겨요. 이 데스크는 차례를 갖지 않아요. 참여시킨 에이전트로 로그인한 homingbird run이 차례를 가져요. 웹 클라이언트에서 플록을 지켜보세요.'
      : wants === 'result'
        ? '플록의 차례가 끝나 에이전트에게 결과를 요청하고 있어요. homingbird run이 결과 초안을 쓰고 에이전트들이 투표로 정해요. 결과를 게시하는 건 사람만 할 수 있어요.'
        : '플록이 다른 에이전트들이 쓴 결과 초안에 투표해 달라고 에이전트에게 요청하고 있어요. homingbird run이 투표하고, 뽑힌 초안이 결과가 돼요. 게시하는 건 사람만 할 수 있어요.',
  debateToast: (wants) =>
    wants === 'turn'
      ? '플록에서 에이전트 차례가 왔어요'
      : wants === 'result'
        ? '플록이 에이전트 결과를 기다려요'
        : '플록이 에이전트 투표를 기다려요',
  streamStopped: '실시간 연결이 끊겼어요. 30초 뒤에 다시 연결해요.',
  couldNotSignIn: (reason) => `로그인하지 못했어요: ${reason}`,
  noNode: (olderVersion) =>
    `${olderVersion === null ? 'Node 22 이상을 찾지 못했어요' : `Node ${olderVersion}은 너무 오래됐어요. Homingbird에는 Node 22 이상이 필요해요`}. node -v가 22 이상으로 나오는 터미널에서 Claude Code를 시작하거나, /plugin의 Homingbird 설정에서 "Homingbird command"에 node의 전체 경로를 넣어 주세요.`,
  serverHeading: 'Homingbird 서버 주소를 입력하세요',
  serverHelp: '조직에서 알려 준 주소예요. 예: https://homingbird.example.com',
  serverByCommand:
    '/homingbird 뒤에 주소를 붙여 입력해도 돼요. 예: /homingbird https://homingbird.example.com',
  checkingServer: '주소를 확인하는 중…',
  useServer: '계속',
  serverRefused: (reason, typed) =>
    reason === 'not-https'
      ? `"${typed}"는 https 주소가 아니에요. https://로 시작하는 전체 주소를 입력하세요.`
      : `${typed}에서 Homingbird 서버를 찾지 못했어요. 주소를 알려 준 사람에게 확인해 주세요.`,
  changeServer: `다른 서버를 쓰려면 /homingbird 뒤에 주소를 붙여 입력하거나, /plugin의 Homingbird 설정에서 "Homingbird server address"를 바꾸세요.`,
  serverUsuallySet:
    '보통은 플러그인을 설치할 때 조직에서 이 주소를 정해 둬요. 그렇지 않다면 Homingbird를 운영하는 사람에게 물어보세요.',
  signInTo: (host) => `${host}에 로그인`,
  openWeb: '웹에서 열기',
  signOut: '로그아웃',
  deskStopped: (before, after) =>
    after === null
      ? `${before.server}에서 로그아웃했어요. 데스크를 멈췄어요. 다시 로그인하면 이 세션을 데스크로 쓸 수 있어요.`
      : `이 창의 계정이 바뀌어 데스크를 멈췄어요. 이전: ${before.memberName} · ${before.server}, 지금: ${after.memberName} · ${after.server}. 다시 쓰려면 /homingbird를 입력하세요.`,
  hostTooOld:
    'Homingbird 도구와 데스크를 쓰려면 Claude Code를 2.1.327 이상으로 업데이트하세요. 그동안 창은 계속 쓸 수 있어요.',
  waitingForApproval: '브라우저에서 승인하기를 기다리는 중이에요.',
  signInDenied: '브라우저에서 로그인을 거절했어요. 아무것도 연결되지 않았어요.',
  signInExpired: '승인하기 전에 코드가 만료됐어요. 다시 시작해서 새 코드를 받으세요.',
  signInUnreachable: '로그인을 마치려고 했지만 Homingbird 서버에 연결할 수 없었어요.',
  tryAgain: '다시 시도',
  characterStarted:
    '캐릭터 만들기를 시작했어요. 에이전트가 초안을 만들고 확인한 뒤 편집기 링크를 줘요. 저장은 "이 캐릭터 쓰기"를 눌러야만 돼요.',
  teachStarted:
    '채팅으로 가르치기를 시작했어요. 에이전트가 몇 가지 질문에 어떻게 답하는지 묻고 원칙을 제안해요. 제안은 웹 클라이언트의 둥지 › 가르치기에서 저장해야만 원칙이 돼요.',
}

const durationOf = (minutes: number): string =>
  minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`
