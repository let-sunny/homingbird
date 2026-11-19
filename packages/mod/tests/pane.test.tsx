import { expect, test } from 'claude-code/testing'

import { paneTitleFor } from '../hooks/pane'
import { paneLanguageFrom, paneTextIn } from '../hooks/pane-text'
import { DRAFT, NOTE_ID, OVERVIEW, PANE, START, WRAPPED, engineBeneath, openDesk } from './world'

test('the desk pane says to keep the session open and lists drafts, waiting notes and rooms', async ($, on) => {
  const awaiting = [{ noteId: NOTE_ID, from: { name: 'Ana', email: 'ana@example.com' }, wrapped: WRAPPED }]
  const seen = engineBeneath(on, { overview: { ...OVERVIEW, awaiting }, holdsStream: true })
  await $.session.start(START)
  await openDesk($, seen)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Keep this session/ }))?.text).toBe(paneTextIn('en').keepOpen)
    expect(await ui.find({ type: 'Text', text: /Ben on https:\/\/homingbird\.example\.com/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Reply drafted by Laptop/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ana: Is the migration safe\?/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ana, Ben · 2 unread/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^#payments/ }))?.text).toBe('#payments')
    expect(await ui.find({ type: 'Text', text: /1 waiting/ })).toBeDefined()
    await ui.unmount()
  }
  seen.release()
})

const freshSessionLine = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  usage: { readonly startedAt: number; readonly percent: number },
): Promise<string | null> => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true, sessionUsage: usage })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const line = (await ui.find({ type: 'Text', text: /fresh one/ }))?.text ?? null
  await ui.unmount()
  seen.release()
  return line
}

test('the desk pane suggests no fresh session while this one is young and has room', async ($, on) => {
  expect(await freshSessionLine($, on, { startedAt: -30 * 60_000, percent: 20 })).toBeNull()
})

test('the desk pane suggests a fresh session once this one ran for eight hours', async ($, on) => {
  expect(await freshSessionLine($, on, { startedAt: -9 * 60 * 60_000, percent: 20 })).toBe(
    paneTextIn('en').freshSession,
  )
})

test('the desk pane suggests a fresh session once this one used most of its context', async ($, on) => {
  expect(await freshSessionLine($, on, { startedAt: -30 * 60_000, percent: 85 })).toBe(
    paneTextIn('en').freshSession,
  )
})

test('Pip is a small picture on every surface', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
  await $.session.start(START)
  await openDesk($, seen)
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Image' })).toBeDefined()
  await terminal.unmount()
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  }
  seen.release()
})

test('the pane cannot approve: each draft waits for approval and opens in the web client', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
  await $.session.start(START)
  await openDesk($, seen)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.findAll({ type: 'Button' })).map((button) => button.key)).toEqual(['sign-out'])
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Waiting for your approval$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /only in the Homingbird web client/ })).toBeDefined()
    expect((await ui.find({ type: 'Link', text: /Open in web$/ }))?.props?.href).toBe(
      `https://homingbird.example.com/#/c/${DRAFT.conversationId}`,
    )
    expect((await ui.find({ type: 'Link', text: /Open web$/ }))?.props?.href).toBe(
      'https://homingbird.example.com',
    )
    await ui.unmount()
  }
  expect(seen.commands.some((args) => args[0] === 'approve' || args[0] === 'discard')).toBe(false)
  seen.release()
})

test('signing in from the pane asks for an agent credential and nothing more', async ($, on) => {
  const seen = engineBeneath(on, { overview: { signedIn: false } })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'server', text: 'https://homingbird.example.com' })
  expect(seen.commands).toContainEqual(['login', '--server', 'https://homingbird.example.com', '--json'])
  expect(seen.commands.flat()).not.toContain('--approve-button')
  await ui.unmount()
})

test('a signed-out person without a configured server is asked for it, then signed in', async ($, on) => {
  const seen = engineBeneath(on, { overview: { signedIn: false } })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /not signed in/ })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(seen.commands.some((args) => args[0] === 'stream' || args[0] === 'login')).toBe(false)
  await ui.input({ key: 'server', text: ' https://homingbird.example.com ' })
  expect(seen.commands).toContainEqual(['login', '--server', 'https://homingbird.example.com', '--json'])
  await ui.unmount()
})

test('while signing in, the pane links the sign-in page', async ($, on) => {
  const awaiting = JSON.stringify({
    step: 'awaiting_approval',
    verificationUri: 'https://homingbird.example.com/device?code=ABCD-EFGH',
    userCode: 'ABCD-EFGH',
  })
  const seen = engineBeneath(on, { overview: { signedIn: false }, loginLines: [awaiting], holdsLogin: true })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'server', text: 'https://homingbird.example.com' })
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Code ABCD-EFGH/ })).toBeDefined()
  await ui.unmount()
  seen.release()
})

test('a desk another session took over offers to take it back', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
  await $.session.start(START)
  await openDesk($, seen)
  seen.store.set('desk', { sessionId: 'session-other', claimedAt: 1 })
  await seen.clock.advance(30_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Another session is your Homingbird desk/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Keep this session/ })).toBeUndefined()
  await ui.press({ key: 'become-desk' })
  await seen.clock.settle()
  expect(seen.store.get('desk')).toEqual({ sessionId: 'session-desk', claimedAt: 30_000 })
  await ui.unmount()
  seen.release()
})

test('the pane title carries the number of drafts waiting', () => {
  expect(paneTitleFor(0)).toBe('Homingbird')
  expect(paneTitleFor(3)).toBe('Homingbird (3)')
})

test('the pane speaks Korean when the environment is set to Korean', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    holdsStream: true,
    environment: { LANG: 'ko_KR.UTF-8' },
  })
  await $.session.start(START)
  await openDesk($, seen)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /데스크로 열어 두세요/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /승인을 기다리는 초안/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Laptop이\(가\) 쓴 답장 초안/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ana, Ben · 읽지 않음 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^승인을 기다리고 있어요$/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', text: /웹에서 열기$/ })).toBeDefined()
    await ui.unmount()
  }
  seen.release()
})

test('the language the member picked, read from the command line status, wins over the environment', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: OVERVIEW,
    locale: 'ko',
    holdsStream: true,
    environment: { LANG: 'en_US.UTF-8' },
  })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /승인을 기다리는 초안/ })).toBeDefined()
  await ui.unmount()
  seen.release()
})

test('the pane language follows the member, then LC_ALL, LC_MESSAGES and LANG, then English', () => {
  expect(paneLanguageFrom('ko', ['en_US.UTF-8'])).toBe('ko')
  expect(paneLanguageFrom(null, [undefined, 'ko_KR.UTF-8', 'en_US.UTF-8'])).toBe('ko')
  expect(paneLanguageFrom(null, ['', undefined, 'ko'])).toBe('ko')
  expect(paneLanguageFrom('fr', ['C.UTF-8'])).toBe('en')
  expect(paneLanguageFrom(undefined, [])).toBe('en')
})

test('the Korean pane calls the desk 데스크, never 전용 세션', () => {
  const written = Object.values(paneTextIn('ko'))
    .map((text) => (typeof text === 'function' ? text.toString() : JSON.stringify(text)))
    .join(' ')
  expect(written).toContain('데스크')
  expect(written).not.toContain('전용 세션')
})

test('both languages have every pane string', () => {
  expect(Object.keys(paneTextIn('ko')).sort()).toEqual(Object.keys(paneTextIn('en')).sort())
  expect(paneTextIn('ko').openInWebClient).toBe('웹에서 열기')
})

test('with no usable Node, the pane says what to do, once, without toasts or retries of the probe', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, node: null, environment: { HOME: '/home/ben' } })
  await $.session.start(START)
  await openDesk($, seen)
  await openDesk($, seen)
  await seen.clock.advance(120_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const said = await ui.find({ type: 'Text', text: /Node 22 or newer was not found/ })
  expect(said?.text).toContain('Homingbird plugin settings (/plugin)')
  expect(seen.toasts).toEqual([])
  expect(seen.commands).toEqual([])
  await ui.unmount()
})

test('the Node message names an old version, and reads in Korean', () => {
  expect(paneTextIn('en').noNode('v20.11.1')).toContain('Node v20.11.1 is too old')
  expect(paneTextIn('ko').noNode(null)).toContain('Node 22 이상을 찾지 못했어요')
  expect(paneTextIn('ko').noNode('v18.0.0')).toContain('Node v18.0.0은 너무 오래됐어요')
})
