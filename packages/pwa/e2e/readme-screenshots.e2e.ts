import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILT_IN_CHARACTERS } from '@homingbird/protocol'
import {
  type Person,
  api,
  connectAgent,
  freePort,
  newPage,
  sendThroughApi,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const here = dirname(fileURLToPath(import.meta.url))
const output = process.env.HB_README_SCREENSHOTS ?? join(here, '..', '..', '..', 'docs', 'screenshots')
const { chromium } = createRequire(import.meta.url)('playwright')

const WIDE = { width: 1200, height: 800 }
const PHONE = { width: 390, height: 780 }
const WIDE_SCALE = 4 / 3

const character = (id: string) => BUILT_IN_CHARACTERS.find((spec) => spec.id === id)

const scenario = async (): Promise<void> => {
  await mkdir(output, { recursive: true })
  const port = await freePort()
  const base = `http://localhost:${port}`
  const dovecote = await startDovecote(port, join(tmpdir(), `homingbird-readme-${port}.sqlite`))
  const browser = await chromium.launch()
  const wideAs = async (locale: string, email: string, name: string): Promise<Person> => {
    const person = await newPage(browser, base, locale, { viewport: WIDE, deviceScaleFactor: WIDE_SCALE })
    await submitDevelopmentLogin(person.page, email, name)
    await person.page.waitForSelector('.app')
    return { ...person, name }
  }
  const signIn = (email: string, name: string): Promise<Person> => wideAs('en-US', email, name)
  const shot = async (person: Person, name: string): Promise<void> => {
    await person.page.waitForTimeout(400)
    await person.page.screenshot({ path: join(output, `${name}.png`) })
  }
  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const june = await signIn('june@example.com', 'June')
    const ben = await signIn('ben@example.com', 'Ben')
    const ids = Object.fromEntries(
      await Promise.all(
        [ana, june, ben].map(async (person) => [person.name, (await api(person, 'GET', '/me')).member.id]),
      ),
    ) as Record<string, string>
    await api(ana, 'PUT', '/me', { profile: 'Billing and the payments database.' }).catch(() => undefined)
    await api(june, 'PUT', '/me/character', character('cat'))
    await api(ben, 'PUT', '/me/character', character('fox'))

    const laptop = await connectAgent(base, june, 'June laptop agent')
    await connectAgent(base, june, 'June desk')
    const direct = await api(ana, 'POST', '/conversations', { participantIds: [ids.June] })
    await sendThroughApi(ana, {
      conversationId: direct.id,
      body: 'Is the billing migration safe to run today? Plan: https://example.com/plans/billing',
    })
    const question = (await api(june, 'GET', `/conversations/${direct.id}/notes`)).notes[0]
    await laptop.call('POST', '/drafts', {
      conversationId: direct.id,
      inReplyTo: question.id,
      body: 'Yes. I checked the lock ordering and the batch size; run it after the nightly export.',
    })
    await june.page.goto(`${base}/#/c/${direct.id}`)
    await june.page.waitForSelector('.pending .draft')
    await shot(june, 'draft-waiting-for-approval')

    await june.page.click('.draft button:has-text("Edit")')
    await june.page.fill(
      'dialog[open] textarea',
      'Yes. Run it after the nightly export; I checked the lock ordering.',
    )
    await june.page.click('dialog[open] button[type=submit]')
    await june.page.waitForSelector('.note.is-mine.is-edited')
    await june.page.click('.ask-agent summary')
    await june.page.fill(
      '.ask-agent textarea[name=instruction], .ask-agent input[name=instruction]',
      'Offer to watch it with Ana',
    )
    await june.page.waitForSelector('.ask-agent select[name=agent]')
    await shot(june, 'ask-my-agent-for-a-draft')

    await api(ana, 'POST', '/channels', {
      slug: 'billing',
      description: 'Invoices, refunds and the payments database.',
    })
    await api(ana, 'POST', '/channels', {
      slug: 'deploys',
      description: 'Release trains, rollbacks and the deploy queue.',
    })
    await api(ana, 'POST', '/channels', {
      slug: 'payroll',
      description: 'Salaries and pay slips. Only the people a manager adds.',
      visibility: 'private',
    })
    await api(june, 'PUT', '/channels/billing/membership', { answering: true })
    await api(ben, 'PUT', '/channels/billing/membership', {})
    await api(ana, 'PUT', `/channels/payroll/members/${ids.Ben}`).catch(() => undefined)
    await sendThroughApi(ben, {
      channel: 'billing',
      body: 'Who can explain the refund rule for annual plans?',
    })
    const billing = (await api(ben, 'GET', '/channels/billing')).conversationId as string
    const asked = (await api(june, 'GET', `/conversations/${billing}/notes`)).notes.find(
      (note: { body: string }) => note.body.startsWith('Who can explain'),
    )
    await sendThroughApi(june, {
      conversationId: billing,
      inReplyTo: asked.id,
      body: 'Annual plans are refunded pro rata for the unused months.',
    })
    await ben.page.goto(`${base}/#/c/${billing}`)
    await ben.page.waitForSelector('.answered-by')
    await shot(ben, 'channel-room-answered-by')

    await ben.page.goto(`${base}/#/channels`)
    await ben.page.waitForSelector('.channel-card[data-slug="payroll"]')
    await shot(ben, 'browse-channels')

    await ben.page.goto(`${base}/#/people`)
    await ben.page.waitForSelector('.person canvas[data-character="cat"]')
    await shot(ben, 'directory-with-characters')

    await ben.page.goto(`${base}/#/character?from=cat`)
    await ben.page.waitForSelector('.character-editor')
    await ben.page.locator('.character-editor .field:has-text("Up to 20 characters") input').fill('Biscuit')
    await shot(ben, 'character-editor')

    const korean = await wideAs('ko-KR', 'june@example.com', 'June')
    await korean.page.goto(`${base}/#/c/${direct.id}`)
    await korean.page.waitForSelector('.note.is-mine')
    await shot(korean, 'conversation-in-korean')
    await korean.context.close()

    const phone = await newPage(browser, base, 'en-US', { viewport: PHONE })
    await submitDevelopmentLogin(phone.page, 'june@example.com', 'June')
    await phone.page.waitForSelector('.app')
    await phone.page.goto(`${base}/#/c/${direct.id}`)
    await phone.page.waitForSelector('.note.is-mine')
    await shot(phone, 'phone-conversation')
    await phone.page.goto(`${base}/#/c/${billing}`)
    await phone.page.waitForSelector('.answering-chip')
    await shot(phone, 'phone-channel-room')
    await phone.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`README screenshots written to ${output}\n`)
process.exit(0)
