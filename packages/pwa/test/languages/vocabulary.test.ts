import { describe, expect, it } from 'vitest'
import { en } from '../../src/languages/en.ts'
import { ko } from '../../src/languages/ko.ts'

const INTERNAL_TERMS: ReadonlyArray<{ readonly term: RegExp; readonly instead: string }> = [
  { term: /\bdirector(y|ies)\b/i, instead: 'People' },
  { term: /디렉터리/, instead: '사람' },
  { term: /\bhelpers?\b/i, instead: 'people who answer' },
  { term: /도우미/, instead: '답변자' },
  { term: /\bcredentials?\b/i, instead: 'devices and agents, or a connection' },
  { term: /자격 ?증명/, instead: '기기와 에이전트, 또는 연결' },
  { term: /\bparticipants?\b/i, instead: 'people in the room' },
  { term: /참여자/, instead: '방에 있는 사람' },
  { term: /\bpoll(ing)?\b/i, instead: 'Connected' },
  { term: /폴링/, instead: '연결됨' },
  { term: /(?<!연결 )코드/, instead: '연결 코드 (a bare 코드 reads as a product name)' },
  { term: /\breceipts?\b/i, instead: 'Delivered, Read, Replied' },
  { term: /(?<!화면 |다크 |라이트 )모드/, instead: 'Homingbird 플러그인 (모드 reads as “mode”)' },
  { term: /\btopics?\b/i, instead: 'channel' },
  { term: /주제/, instead: '채널' },
  { term: /\bconversations?\b/i, instead: 'direct message, or channel' },
  { term: /대화/, instead: 'DM, 또는 채널' },
]

const EXCEPTIONS: Readonly<Record<string, string>> = {}

const textsOf = (entry: unknown, path = ''): Array<readonly [string, string]> =>
  typeof entry === 'string'
    ? [[path, entry]]
    : Object.entries(entry as Readonly<Record<string, unknown>>).flatMap(([key, value]) =>
        textsOf(value, path === '' ? key : `${path}.${key}`),
      )

describe.each([
  ['en', en],
  ['ko', ko],
])('%s says what the interface shows, not what the code calls it', (_, language) => {
  it.each(INTERNAL_TERMS)('never says $term in a string a person reads (say “$instead”)', ({ term }) => {
    const found = textsOf(language)
      .filter(([path, text]) => term.test(text) && EXCEPTIONS[path] === undefined)
      .map(([path, text]) => `${path}: ${text}`)
    expect(found).toEqual([])
  })
})

describe('the internal-term check', () => {
  it('catches a term that slips in', () => {
    const found = textsOf({ hint: 'Add someone from the directory' }).filter(([, text]) =>
      INTERNAL_TERMS.some(({ term }) => term.test(text)),
    )
    expect(found).toHaveLength(1)
  })

  it('keeps every exception explained', () => {
    for (const reason of Object.values(EXCEPTIONS)) expect(reason.length).toBeGreaterThan(20)
  })
})
