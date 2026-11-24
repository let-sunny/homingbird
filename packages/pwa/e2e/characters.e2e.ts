import { strict as assert } from 'node:assert'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { characterForMember } from '@homingbird/protocol'
import {
  type Person,
  api,
  clippedText,
  connectAgent,
  freePort,
  newPage,
  overflowsSideways,
  screenshotCounter,
  sendThroughApi,
  signInWith,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const here = dirname(fileURLToPath(import.meta.url))
const screenshots = process.env.HB_E2E_SCREENSHOTS_CHARACTERS ?? join(here, 'screenshots-characters')
const { chromium } = createRequire(import.meta.url)('playwright')

const OTTER = {
  version: 1,
  base: 'bubble-16',
  id: 'sunny-otter',
  name: 'Otter',
  palette: { B: '#8A6A52', D: '#6E523F', O: '#E7D3BF', F: '#6E523F' },
  marks: [
    [5, 1, 1, 1, 'B'],
    [10, 1, 1, 1, 'B'],
    [15, 6, 1, 1, '#2E2018'],
    [4, 8, 7, 4, '#E7D3BF'],
  ],
}

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-characters-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, databasePath)
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  const signIn = signInWith(browser, base)

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const ben = await signIn('ben@example.com', 'Ben')
    const june = await signIn('june@example.com', 'June')
    const juneId = (await api(june, 'GET', '/me')).member.id as string
    const juneDefault = characterForMember({ id: juneId, character: null })
    assert.notEqual(juneDefault.name, 'Pigeon', 'no person is ever drawn as the logo bird')
    await api(ben, 'PUT', '/me/character', BUILT_INS.fox)

    // -- Everyone is drawn as their character; nobody chose one yet, so they get the default their id picks -----------
    await ana.page.goto(`${base}/#/people`)
    await ana.page.waitForSelector('.person canvas.character[aria-label="Ben: Fox"]')
    await ana.page.waitForSelector(
      `.person canvas.character[aria-label="June: ${juneDefault.name}"][data-character="${juneDefault.id}"]`,
    )
    await capture(ana.page, 'directory-shows-each-character-as-a-still')
    assert.equal(
      await isStill(ana.page, '.person canvas.character'),
      true,
      'directory characters must not move',
    )

    // -- Picking a built-in character saves nothing until the button is pressed --------------------
    await ana.page.goto(`${base}/#/me`)
    await ana.page.waitForSelector('.my-character .character-choice')
    await capture(ana.page, 'my-character-on-the-profile')
    await ana.page.click('.character-choice[data-character="cat"]')
    await ana.page.waitForSelector('.character-picked .character-ground.is-dark')
    await ana.page.locator('.character-picked').scrollIntoViewIfNeeded()
    await capture(ana.page, 'picked-cat-previewed-on-light-and-dark')
    assert.equal((await api(ana, 'GET', '/me')).member.character, null, 'picking must not save')
    await ana.page.click('.character-picked button.primary:has-text("Use this character")')
    await ana.page.waitForSelector('.toast:has-text("Your character is saved.")')
    assert.equal((await api(ana, 'GET', '/me')).member.character.id, 'cat')
    await ana.page.waitForSelector('.user-button canvas.character[data-character="cat"]')
    await ana.page.click('.toast button.icon')
    await ana.page.waitForSelector('.toast', { state: 'detached' })

    // -- The editor: parts per slot, blocked parts say why, Surprise me ----------------------------
    await ana.page.click('a.button:has-text("Make my own")')
    await ana.page.waitForSelector('.character-editor .character-slot')
    await ana.page.check('input[name="part-ears"][value="round"]')
    await ana.page.fill('input[name="character-name"]', 'Biscuit')
    await scrollToTop(ana.page, '.character-editor')
    await capture(ana.page, 'editor-with-parts-colors-and-preview')
    const blocked = await ana.page.locator('.character-part:has(input:disabled) .character-blocked').count()
    assert.ok(blocked > 0, 'parts that would break a rule are disabled with a reason')
    await ana.page.locator('.character-part:has(input:disabled)').first().scrollIntoViewIfNeeded()
    const previewBox = await ana.page.locator('.character-review .character-ground').first().boundingBox()
    assert.ok(
      previewBox !== null && previewBox.y >= 0 && previewBox.y < 800,
      'the preview stays in view while choosing parts further down',
    )
    await capture(ana.page, 'editor-disables-parts-that-break-a-rule-with-the-reason')
    await ana.page.click('button[name="surprise"]')
    await ana.page.waitForSelector('.character-passes')
    await ana.page.evaluate(() => (globalThis as any).scrollTo(0, 0))
    await capture(ana.page, 'editor-after-surprise-me')
    assert.equal(await isStill(ana.page, '.character-preview canvas'), false, 'previews play their state')
    const surprised = await ana.page.inputValue('input[name="character-name"]')
    await ana.page.click('button[name="use"]')
    await ana.page.waitForFunction(() => (globalThis as any).location.hash === '#/me')
    await ana.page.waitForSelector('.my-character')
    const saved = (await api(ana, 'GET', '/me')).member.character
    assert.equal(saved.name, surprised)
    assert.match(saved.id, /^my-/)

    // -- Ask my agent: the agent checks and previews; the link opens a draft that only a click saves --
    const agent = await connectAgent(base, ana, 'Ana laptop agent')
    const preview = await mcpTool(base, agent.token, 'preview_character', { character: OTTER })
    const link = /Show this link to your human: (\S+)/.exec(preview)![1]!
    assert.ok(link.startsWith(`${base}/#/character/`), preview)
    const refused = await agent.call('PUT', '/me/character', OTTER)
    assert.equal(refused.error.code, 'Forbidden')
    await ana.page.goto(link)
    await ana.page.waitForSelector('.banner:has-text("Your agent’s draft is loaded")')
    await ana.page.waitForSelector('.character-layer:has-text("Markings from your agent’s draft")')
    await capture(ana.page, 'agent-draft-opened-from-the-link')
    assert.equal((await api(ana, 'GET', '/me')).member.character.id, saved.id, 'opening a link must not save')
    await ana.page.uncheck('input[name="keep-layer"]')
    await capture(ana.page, 'agent-markings-removed-as-a-layer')
    await ana.page.check('input[name="keep-layer"]')
    await ana.page.click('button[name="use"]')
    await ana.page.waitForFunction(() => (globalThis as any).location.hash === '#/me')
    await ana.page.waitForSelector('.my-character')
    const fromAgent = (await api(ana, 'GET', '/me')).member.character
    assert.deepEqual({ ...fromAgent, palette: undefined }, { ...OTTER, palette: undefined })
    assert.deepEqual({ ...fromAgent.palette, ...OTTER.palette }, fromAgent.palette)

    const failing = encodeCharacter({ ...OTTER, id: 'my-mouthy', marks: [[12, 9, 2, 1, '#2E2018']] })
    await ana.page.goto(`${base}/#/character/${failing}`)
    await ana.page.waitForSelector('.character-problem-list li:has-text("characters have no mouths")')
    assert.equal(await ana.page.isDisabled('button[name="use"]'), true, 'a failing character cannot be used')
    await capture(ana.page, 'a-draft-that-breaks-a-rule-cannot-be-used')
    await ana.page.goto(`${base}/#/character/not-a-character`)
    await ana.page.waitForSelector('.toast:has-text("This link does not hold a character")')
    await ana.page.goto(`${base}/#/character/${'A'.repeat(6000)}`)
    await ana.page.waitForSelector('.toast:has-text("This link does not hold a character")')

    // -- A row that just received a note plays it once; the rest stay still -----------------------
    await ana.page.goto(`${base}/#/`)
    await ana.page.waitForSelector('.sidebar')
    await sendThroughApi(ben, { to: [(await api(ana, 'GET', '/me')).member.id], body: 'Lunch at noon?' })
    await ana.page.waitForSelector(
      '.conversation canvas.character[data-state="new-note"][data-character="fox"]',
    )
    await capture(ana.page, 'a-row-that-just-received-a-note')

    // -- An administrator resets a member to their default bird --------------------------------------------
    await ana.page.goto(`${base}/#/admin/members`)
    await ana.page.waitForSelector('.member canvas.character[aria-label="Ben: Fox"]')
    await capture(ana.page, 'admin-sees-each-member-character')
    await ana.page
      .locator('.member', { hasText: 'ben@example.com' })
      .getByRole('button', { name: 'Reset character' })
      .click()
    await ana.page.waitForSelector('.toast:has-text("Ben is shown as their default bird again.")')
    assert.equal((await api(ben, 'GET', '/me')).member.character, null)

    // -- Reduced motion: always the first frame ----------------------------------------------------
    const calm = await newPage(browser, base, 'en-US', { reducedMotion: 'reduce' })
    await submitDevelopmentLogin(calm.page, 'june@example.com', 'June')
    await calm.page.waitForSelector('.app')
    await calm.page.goto(`${base}/#/character/${encodeCharacter(OTTER)}`)
    await calm.page.waitForSelector('.character-preview canvas')
    assert.equal(
      await isStill(calm.page, '.character-preview canvas'),
      true,
      'reduced motion shows the first frame',
    )
    await calm.context.close()

    // -- Narrow screen -----------------------------------------------------------------------------
    await ana.page.setViewportSize({ width: 390, height: 844 })
    await ana.page.goto(`${base}/#/character`)
    await ana.page.waitForSelector('.character-editor')
    assert.equal(await overflowsSideways(ana.page), false, 'the editor fits a phone')
    await capture(ana.page, 'editor-on-a-phone')
    await ana.page.goto(`${base}/#/me`)
    await ana.page.waitForSelector('.character-grid')
    await ana.page.locator('.my-character').scrollIntoViewIfNeeded()
    assert.equal(await overflowsSideways(ana.page), false, 'my character fits a phone')
    await capture(ana.page, 'my-character-on-a-phone')
    await ana.page.setViewportSize({ width: 1200, height: 800 })

    // -- Korean ------------------------------------------------------------------------------------
    await api(ana, 'PATCH', '/me', { locale: 'ko' })
    await ana.page.goto(`${base}/#/me`)
    await ana.page.reload()
    await ana.page.waitForSelector('.my-character legend:has-text("내 캐릭터")')
    await ana.page.click('.character-choice[data-character="owl"]')
    await ana.page.waitForSelector('.character-picked:has-text("고른 캐릭터: 부엉이")')
    assert.deepEqual(await clippedText(ana.page), [], 'the Korean profile clips text')
    await ana.page.locator('.my-character').scrollIntoViewIfNeeded()
    await capture(ana.page, 'ko-my-character')
    await ana.page.goto(link)
    await ana.page.waitForSelector('.banner:has-text("에이전트가 만든 초안을 불러왔어요")')
    await ana.page.waitForSelector('.character-slot legend:has-text("머리 위")')
    assert.deepEqual(await clippedText(ana.page), [], 'the Korean editor clips text')
    await capture(ana.page, 'ko-editor-with-agent-draft')
    await ana.page.goto(`${base}/#/character/${failing}`)
    await ana.page.waitForSelector('.character-problem-list li:has-text("캐릭터에는 입이 없어요")')
    await capture(ana.page, 'ko-draft-that-breaks-a-rule')
    await ana.page.goto(`${base}/#/people`)
    const benDefault = characterForMember({
      id: (await api(ben, 'GET', '/me')).member.id as string,
      character: null,
    })
    await ana.page.waitForSelector(
      `.person canvas.character[data-character="${benDefault.id}"][aria-label^="Ben: "]`,
    )
    await capture(ana.page, 'ko-directory')
  } finally {
    await browser.close()
    await dovecote.stop()
    for (const suffix of ['', '-wal', '-shm']) await rm(`${databasePath}${suffix}`, { force: true })
  }
}

const BUILT_INS: Readonly<Record<string, object>> = {
  fox: {
    version: 1,
    base: 'bubble-16',
    id: 'fox',
    name: 'Fox',
    palette: { B: '#F08B3C', D: '#CF6B22', O: '#FFF3E6', F: '#4A3428' },
    marks: [
      [5, 0, 1, 2, 'B'],
      [6, 1, 1, 1, 'B'],
      [10, 0, 1, 2, 'B'],
      [9, 1, 1, 1, 'B'],
      [5, 0, 1, 1, '#4A3428'],
      [10, 0, 1, 1, '#4A3428'],
      [0, 14, 1, 1, '#FFF3E6'],
      [15, 6, 1, 1, '#2E2018'],
    ],
  },
}

const encodeCharacter = (spec: object): string =>
  Buffer.from(JSON.stringify(spec), 'utf8').toString('base64url')

const mcpTool = async (base: string, token: string, name: string, args: object): Promise<string> => {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const answer = (await response.json()) as { result: { content: Array<{ text: string }> } }
  return answer.result.content.map((part) => part.text).join('\n')
}

const isStill = async (page: any, selector: string): Promise<boolean> => {
  const snapshot = () =>
    page.evaluate(
      (wanted: string) =>
        [...(globalThis as any).document.querySelectorAll(wanted)].map((canvas: any) => canvas.toDataURL()),
      selector,
    )
  const first = JSON.stringify(await snapshot())
  for (let sample = 0; sample < 8; sample++) {
    await page.waitForTimeout(250)
    if (JSON.stringify(await snapshot()) !== first) return false
  }
  return true
}

const scrollToTop = (page: any, selector: string): Promise<void> =>
  page.evaluate((wanted: string) => {
    for (
      let node = (globalThis as any).document.querySelector(wanted);
      node !== null;
      node = node.parentElement
    )
      node.scrollTop = 0
    ;(globalThis as any).scrollTo(0, 0)
  }, selector)

await scenario()
process.stdout.write(`characters e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
