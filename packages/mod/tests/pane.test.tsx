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

test('the approve button is what approves a draft, on every surface that takes presses', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
  await $.session.start(START)
  await openDesk($, seen)
  expect(seen.commands.some((args) => args[0] === 'approve')).toBe(false)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const before = seen.commands.filter((args) => args[0] === 'approve').length
    await ui.press({ key: `approve:${DRAFT.id}` })
    const approvals = seen.commands.filter((args) => args[0] === 'approve')
    expect(approvals.length).toBe(before + 1)
    expect(approvals.at(-1)).toEqual(['approve', DRAFT.id, '--json'])
    await ui.unmount()
  }
  seen.release()
})

test('discard discards, and edit sends the edited text', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `discard:${DRAFT.id}` })
  expect(seen.commands.filter((args) => args[0] === 'discard')).toEqual([['discard', DRAFT.id, '--json']])
  await ui.press({ key: `edit-toggle:${DRAFT.id}` })
  await ui.input({ key: `edit:${DRAFT.id}`, text: 'Yes, after 6pm.' })
  expect(seen.commands.filter((args) => args[0] === 'approve')).toEqual([
    ['approve', DRAFT.id, '--body', 'Yes, after 6pm.', '--json'],
  ])
  await ui.unmount()
  seen.release()
})

test('without the approve button the pane offers no way to send, and links each draft to the web client', async ($, on) => {
  const seen = engineBeneath(on, { overview: { ...OVERVIEW, hasApproveButton: false }, holdsStream: true })
  await $.session.start(START)
  await openDesk($, seen)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /web client/ })).toBeDefined()
    expect((await ui.find({ type: 'Link', text: /Approve in the web client/ }))?.props?.href).toBe(
      `https://homingbird.example.com/#/c/${DRAFT.conversationId}`,
    )
    expect((await ui.find({ type: 'Link', text: /Open web/ }))?.props?.href).toBe(
      'https://homingbird.example.com',
    )
    await ui.unmount()
  }
  seen.release()
})

test('when the organization turned the approve button off, the pane never approves or discards', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true, approveButton: false })
  await $.session.start(START)
  await openDesk($, seen)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    expect(await ui.find({ key: `approve:${DRAFT.id}` })).toBeUndefined()
    expect(await ui.find({ key: `discard:${DRAFT.id}` })).toBeUndefined()
    expect(await ui.find({ type: 'Link' })).toBeDefined()
    await ui.unmount()
  }
  expect(seen.commands).toContainEqual(['status', '--json'])
  expect(seen.commands.some((args) => args[0] === 'approve' || args[0] === 'discard')).toBe(false)
  seen.release()
})

test('when the organization allows the approve button, the pane shows Approve, Edit and Discard', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true, approveButton: true })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: `approve:${DRAFT.id}` })).toBeDefined()
  expect(await ui.find({ key: `edit-toggle:${DRAFT.id}` })).toBeDefined()
  expect(await ui.find({ key: `discard:${DRAFT.id}` })).toBeDefined()
  expect(await ui.find({ type: 'Link', text: /Approve in the web client/ })).toBeUndefined()
  expect(await ui.find({ type: 'Link', text: /Open web/ })).toBeDefined()
  await ui.unmount()
  seen.release()
})

test('signing in asks for no approve button when the organization turned it off', async ($, on) => {
  const seen = engineBeneath(on, { overview: { signedIn: false }, approveButton: false })
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
  expect(seen.commands).toContainEqual([
    'login',
    '--server',
    'https://homingbird.example.com',
    '--approve-button',
    '--json',
  ])
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
    expect(await ui.find({ type: 'Text', text: /전용 세션으로 열어 두세요/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /승인을 기다리는 초안/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Laptop이\(가\) 쓴 답장 초안/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ana, Ben · 읽지 않음 2/ })).toBeDefined()
    expect((await ui.find({ key: `approve:${DRAFT.id}` }))?.props?.label).toBe('승인')
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

test('both languages have every pane string', () => {
  expect(Object.keys(paneTextIn('ko')).sort()).toEqual(Object.keys(paneTextIn('en')).sort())
  expect(paneTextIn('ko').approve).toBe('승인')
  expect(paneTextIn('ko').send).toBe('보내기')
})

test('with no usable Node, the pane says what to do, once, without toasts or retries of the probe', async ($, on) => {
  const seen = engineBeneath(on, { overview: OVERVIEW, node: null, environment: { HOME: '/home/ben' } })
  await $.session.start(START)
  await openDesk($, seen)
  await openDesk($, seen)
  await seen.clock.advance(120_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const said = await ui.find({ type: 'Text', text: /Node 22 or newer was not found/ })
  expect(said?.text).toContain('/plugin configure homingbird@homingbird')
  expect(seen.toasts).toEqual([])
  expect(seen.commands).toEqual([])
  await ui.unmount()
})

test('the Node message names an old version, and reads in Korean', () => {
  expect(paneTextIn('en').noNode('v20.11.1')).toContain('Node v20.11.1 is too old')
  expect(paneTextIn('ko').noNode(null)).toContain('Node 22 이상을 찾지 못했어요')
  expect(paneTextIn('ko').noNode('v18.0.0')).toContain('Node v18.0.0은 너무 오래됐어요')
})
