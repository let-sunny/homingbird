import { expect, test } from 'claude-code/testing'

import { paneTextIn } from '../hooks/pane-text'
import { OVERVIEW, PANE, START, engineBeneath, openDesk } from './world'

const SIGN_IN_STEP = JSON.stringify({
  step: 'awaiting_approval',
  verificationUri: 'https://homingbird.example.com/device?code=ABCD-EFGH',
  userCode: 'ABCD-EFGH',
})

test('with no server configured, the pane asks only for the server address', async ($, on) => {
  const seen = engineBeneath(on, { overview: { signedIn: false } })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /server address/ }))?.text).toBe(
    'Enter your Homingbird server address',
  )
  expect(await ui.find({ type: 'Text', text: /The address your organization gave you/ })).toBeDefined()
  expect(await ui.find({ type: 'Input' })).toBeDefined()
  expect(
    await ui.find({ type: 'Text', text: /\/homingbird https:\/\/homingbird\.example\.com/ }),
  ).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(seen.commands.some((command) => command[0] === 'login')).toBe(false)
  await ui.unmount()
})

test('an address typed into the pane is checked, saved and signed in to', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: { signedIn: false },
    loginLines: [SIGN_IN_STEP],
    holdsLogin: true,
  })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'server', text: ' https://homingbird.example.com/ ' })
  await seen.clock.settle()
  expect(seen.fetched).toContain('https://homingbird.example.com/api/v1/info')
  expect(seen.settings).toEqual([{ key: 'homingbird.server', value: 'https://homingbird.example.com' }])
  expect(seen.commands).toContainEqual(['login', '--server', 'https://homingbird.example.com', '--json'])
  expect(await ui.find({ type: 'Text', text: /Code ABCD-EFGH/ })).toBeDefined()
  seen.release()
  await ui.unmount()
})

test('/homingbird with an address saves it and continues to sign-in, then the desk', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: { signedIn: false },
    loginLines: [SIGN_IN_STEP],
    signedInAfterLogin: OVERVIEW,
    holdsStream: true,
  })
  await $.session.start(START)
  await $.command.run({ command: 'homingbird', args: 'https://homingbird.example.com' } as never)
  await seen.clock.settle()
  expect(seen.settings).toEqual([{ key: 'homingbird.server', value: 'https://homingbird.example.com' }])
  expect(seen.commands.find((command) => command[0] === 'login')).toBeDefined()
  expect(seen.commands).toContainEqual(['stream', '--json'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /To use another server, type \/homingbird/ })).toBeDefined()
  seen.release()
  await ui.unmount()
})

for (const [name, world, typed, said] of [
  ['an address that is not https', {}, 'http://homingbird.example.com', /is not an https address/],
  ['an address with no scheme', {}, 'homingbird.example.com', /is not an https address/],
  [
    'an unreachable server',
    { server: 'unreachable' },
    'https://nowhere.example.com',
    /No Homingbird server was found at https:\/\/nowhere\.example\.com/,
  ],
  [
    'a server that is not Homingbird',
    { server: 'other' },
    'https://wiki.example.com',
    /No Homingbird server was found at https:\/\/wiki\.example\.com/,
  ],
] as const)
  test(`${name} is refused, nothing is saved, and the pane keeps asking`, async ($, on) => {
    const seen = engineBeneath(on, { overview: { signedIn: false }, ...world })
    await $.session.start(START)
    await openDesk($, seen)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.input({ key: 'server', text: typed })
    await seen.clock.settle()
    expect(await ui.find({ type: 'Text', text: said })).toBeDefined()
    expect(await ui.find({ type: 'Input' })).toBeDefined()
    expect(seen.settings).toEqual([])
    expect(seen.commands.some((command) => command[0] === 'login')).toBe(false)
    await ui.unmount()
  })

test('a loopback address may use http, for a server on this computer', async ($, on) => {
  const seen = engineBeneath(on, { overview: { signedIn: false }, holdsLogin: true })
  await $.session.start(START)
  await $.command.run({ command: 'homingbird', args: 'http://localhost:8080' } as never)
  await seen.clock.settle()
  expect(seen.settings).toEqual([{ key: 'homingbird.server', value: 'http://localhost:8080' }])
  seen.release()
})

test('the first-run words exist in Korean too', () => {
  const ko = paneTextIn('ko')
  expect(ko.serverHeading).toBe('Homingbird 서버 주소를 입력하세요')
  expect(ko.serverRefused('unreachable', 'https://x.example')).toContain('Homingbird 서버를 찾지 못했어요')
  expect(ko.changeServer).toContain('/plugin의 Homingbird 설정')
})

test('the server comes from the saved login first, then the plugin option, then HOMINGBIRD_SERVER', async ($, on) => {
  const seen = engineBeneath(on, {
    overview: { signedIn: false },
    environment: { HOMINGBIRD_SERVER: 'https://from-env.example.com/' },
  })
  await $.session.start(START)
  await openDesk($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'sign-in' }))?.props?.label).toBe('Sign in to from-env.example.com')
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.unmount()
})

test(
  'a configured server wins over HOMINGBIRD_SERVER',
  { options: { server: 'https://configured.example.com' } },
  async ($, on) => {
    const seen = engineBeneath(on, {
      overview: { signedIn: false },
      environment: { HOMINGBIRD_SERVER: 'https://from-env.example.com' },
    })
    await $.session.start(START)
    await openDesk($, seen)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: 'sign-in' }))?.props?.label).toBe('Sign in to configured.example.com')
    await ui.unmount()
  },
)

test(
  'the server a person is signed in to wins over the configured one',
  { options: { server: 'https://configured.example.com' } },
  async ($, on) => {
    const seen = engineBeneath(on, { overview: OVERVIEW, holdsStream: true })
    await $.session.start(START)
    await openDesk($, seen)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Link', text: /Open web/ }))?.props?.href).toBe(
      'https://homingbird.example.com',
    )
    expect(await ui.find({ type: 'Text', text: /Ben on https:\/\/homingbird\.example\.com/ })).toBeDefined()
    seen.release()
    await ui.unmount()
  },
)

test(
  'while the browser has not approved, the pane says it is waiting and shows the code and the page',
  { options: { server: 'https://homingbird.example.com' } },
  async ($, on) => {
    const seen = engineBeneath(on, {
      overview: { signedIn: false },
      loginLines: [SIGN_IN_STEP],
      holdsLogin: true,
    })
    await $.session.start(START)
    await openDesk($, seen)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'sign-in' })
    expect(await ui.find({ type: 'Text', text: /Waiting for you to approve in the browser/ })).toBeDefined()
    expect((await ui.find({ type: 'Link', text: /Open the sign-in page/ }))?.props?.href).toBe(
      'https://homingbird.example.com/device?code=ABCD-EFGH',
    )
    expect(await ui.find({ type: 'Text', text: /Code ABCD-EFGH/ })).toBeDefined()
    seen.release()
    await ui.unmount()
  },
)

for (const [ending, error, said] of [
  [
    'refused',
    'The request was denied in the browser.',
    'The sign-in was refused in the browser. Nothing was connected.',
  ],
  [
    'expired',
    'The code expired before it was approved.',
    'The code expired before it was approved. Start again to get a new one.',
  ],
] as const)
  test(
    `a sign-in ${ending} in the browser says so plainly and offers Try again, once`,
    { options: { server: 'https://homingbird.example.com' } },
    async ($, on) => {
      const seen = engineBeneath(on, {
        overview: { signedIn: false },
        loginLines: [SIGN_IN_STEP],
        loginError: error,
      })
      await $.session.start(START)
      await openDesk($, seen)
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      await ui.press({ key: 'sign-in' })
      await seen.clock.settle()
      expect((await ui.find({ type: 'Text', text: said }))?.text).toBe(said)
      expect((await ui.find({ key: 'sign-in' }))?.props?.label).toBe('Try again')
      expect(seen.toasts).toEqual([])
      expect(seen.commands.filter((command) => command[0] === 'login')).toHaveLength(1)
      await ui.press({ key: 'sign-in' })
      await seen.clock.settle()
      expect(seen.commands.filter((command) => command[0] === 'login')).toHaveLength(2)
      await ui.unmount()
    },
  )

test('sign-in words exist in Korean', () => {
  const ko = paneTextIn('ko')
  expect(ko.signInTo('homingbird.example.com')).toBe('homingbird.example.com에 로그인')
  expect(ko.waitingForApproval).toBe('브라우저에서 승인하기를 기다리는 중이에요.')
  expect(ko.tryAgain).toBe('다시 시도')
})
