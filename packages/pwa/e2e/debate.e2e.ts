import { strict as assert } from 'node:assert'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Person,
  api,
  connectAgent,
  freePort,
  holdEventStream,
  newPage,
  overflowsSideways,
  pastTheRightEdge,
  screenshotCounter,
  signInWith,
  startDovecote,
  submitDevelopmentLogin,
} from './support.ts'

const screenshots = process.env.HB_E2E_SCREENSHOTS_DEBATE ?? join(tmpdir(), 'homingbird-e2e-debate')
const { chromium } = createRequire(import.meta.url)('playwright')

const NARROW = { width: 360, height: 760 }
const QUESTION = 'Should we ship the billing migration this week?'

const scenario = async (): Promise<void> => {
  const port = await freePort()
  const base = `http://localhost:${port}`
  const databasePath = join(tmpdir(), `homingbird-e2e-debate-${port}.sqlite`)
  await rm(screenshots, { recursive: true, force: true })
  await mkdir(screenshots, { recursive: true })
  const dovecote = await startDovecote(port, databasePath, 'billing')
  const browser = await chromium.launch()
  const { capture } = screenshotCounter(screenshots)
  const signIn = signInWith(browser, base)

  try {
    const ana = await signIn('ana@example.com', 'Ana')
    const ben = await signIn('ben@example.com', 'Ben')
    const cy = await signIn('cy@example.com', 'Cy')
    const anaAgent = await connectAgent(base, ana, 'Ana laptop')
    const benAgent = await connectAgent(base, ben, 'Ben desk')
    const desks = [holdEventStream(base, anaAgent.token), holdEventStream(base, benAgent.token)]
    const ids = {
      ana: (await api(ana, 'GET', '/me')).member.id as string,
      ben: (await api(ben, 'GET', '/me')).member.id as string,
    }

    // -- The list starts empty, and a person opens a private room with its limits -----------------
    await ana.page.goto(`${base}/#/channels`)
    await ana.page.click('.tab:has-text("Flocks")')
    await ana.page.waitForSelector('.tab[aria-current="page"]:has-text("Flocks")')
    await ana.page.waitForSelector('.empty:has-text("No flocks yet.")')
    await capture(ana.page, 'no-debate-rooms-yet')
    await ana.page.click('button.new-flock-button')
    await ana.page.waitForSelector('dialog[open] .create-debate')
    await ana.page.fill('.create-debate textarea[name="question"]', QUESTION)
    await ana.page.check('.create-debate input[name="visibility"][value="private"]')
    await ana.page.fill('#debate-invite-field', 'Ben')
    await ana.page.press('#debate-invite-field', 'Enter')
    await ana.page.waitForSelector('.create-debate .people-picker-chip:has-text("Ben")')
    await ana.page.click('.create-debate details > summary')
    await ana.page.fill('.create-debate input[name="turnsPerAgent"]', '1')
    await ana.page.fill('.create-debate input[name="totalTurns"]', '2')
    await capture(ana.page, 'new-room-with-question-limits-and-an-invitee')
    await ana.page.click('.create-debate button[type="submit"]')
    await ana.page.waitForSelector(`h1:has-text("${QUESTION}")`)
    const id = decodeURIComponent(new URL(ana.page.url()).hash.replace('#/debate/', ''))
    await ana.page.waitForSelector('.debate-meta .debate-stage:has-text("Waiting for agents")')
    await ana.page.click('.debate-settings > summary')
    await ana.page.waitForSelector('.debate-limits-summary:has-text("Turns per agent: 1. In total: 2.")')

    // -- Each person opts their own agent in; nobody else sees the private room -----------------
    await ana.page.reload()
    await ana.page.waitForSelector('.debate-opt-in-form select[name="agent"]')
    await ana.page.click('.debate-opt-in-form button[type="submit"]')
    await ana.page.waitForSelector(
      `.debate-participants li[data-member="${ids.ana}"]:has-text("Ana laptop, your agent")`,
    )
    await ben.page.reload()
    await ben.page.waitForSelector('.app')
    await ben.page.goto(`${base}/#/debate/${id}`)
    await ben.page.waitForSelector('.debate-opt-in-form')
    await capture(ben.page, 'invited-person-opts-their-agent-in')
    await ben.page.click('.debate-opt-in-form button[type="submit"]')
    await ben.page.waitForSelector('.debate-meta .debate-stage:has-text("Agents are debating")')
    await cy.page.goto(`${base}/#/debate/${id}`)
    await cy.page.waitForSelector('.empty:has-text("does not exist, or you cannot see it")')
    await cy.page.goto(`${base}/#/debates`)
    await cy.page.waitForSelector('.empty:has-text("No flocks yet.")')

    // -- Turns arrive live over the event stream, quoted as text --------------------------------
    await anaAgent.call('POST', `/debates/${id}/turns`, {
      body: 'The March incident report says the rollback failed. <script>alert(1)</script> See https://wiki.example.com/march',
    })
    await ben.page.waitForSelector('.debate-turn[data-position="1"]:has-text("The March incident report")')
    assert.equal(await ben.page.locator('.debate-turn script').count(), 0, 'a turn is rendered as text')
    await ben.page.waitForSelector(
      '.debate-turn a[href="https://wiki.example.com/march"][rel="noopener noreferrer"]',
    )
    await benAgent.call('POST', `/debates/${id}/turns`, {
      body: 'I had not read it. My goal is to avoid any customer-facing risk this quarter.',
    })
    await ana.page.waitForSelector('.debate-tabs a[aria-current="page"][data-tab="result"]')
    await ana.page.waitForSelector('.debate-result:has-text("The turns ran out")')
    await capture(ana.page, 'turns-ran-out-and-the-room-asks-for-its-result')
    await ana.page.click('.debate-tabs a[data-tab="turns"]')
    await ana.page.waitForSelector('.debate-turn[data-position="2"]')
    await ana.page.waitForSelector('.debate-turns-taken:has-text("2 of 2 turns taken.")')
    assert.equal(await ana.page.locator('.debate-result').count(), 0, 'the turns tab leaves the result out')
    await ana.page.goto(`${base}/#/debate/${id}`)

    // -- Both agents draft the result, vote on each other's draft, and the winner closes the room
    const drafted = await anaAgent.call('PUT', `/debates/${id}/result`, {
      kind: 'no_conclusion',
      summary: 'The agents did not agree on shipping this week.',
      points: [
        {
          point: 'Whether the rollback works',
          category: 'information',
          explanation: 'Ana’s agent read the March incident report; Ben’s agent had no access to it.',
        },
        {
          point: 'What matters most',
          category: 'goals',
          explanation:
            'Ana’s agent aimed to ship this week; Ben’s agent aimed to avoid any customer-facing risk.',
        },
      ],
      contributions: [
        {
          memberId: ids.ana,
          summary: 'Brought the March incident report.',
          credits: [{ credit: 'gap_filled', turn: 1 }],
        },
        {
          memberId: ids.ben,
          summary: 'Named the goal behind the risk.',
          credits: [{ credit: 'disagreement_separated', turn: 2 }],
        },
      ],
      nextSteps: [{ step: 'Ana and Ben agree on the goal first.', owner: ids.ben, proposedBy: ids.ben }],
    })
    assert.equal(drafted.status, 'concluding')
    await ben.page.waitForSelector('.debate-collecting')
    await ben.page.waitForSelector(`.debate-draft[data-member="${ids.ana}"]`)
    await capture(ben.page, 'first-draft-while-the-room-collects-drafts')
    const voting = await benAgent.call('PUT', `/debates/${id}/result`, {
      kind: 'conclusion',
      conclusion: 'Ship next week, after the rollback is tested again.',
      reasons: ['The March rollback failed.'],
      contributions: [
        {
          memberId: ids.ana,
          summary: 'Brought the March incident report.',
          credits: [{ credit: 'gap_filled', turn: 1 }],
        },
        { memberId: ids.ben, summary: 'Asked for another test.', credits: [] },
      ],
      nextSteps: [],
    })
    assert.equal(typeof voting.votingClosesAt, 'number', 'two drafts go to a vote')
    await ana.page.waitForSelector('.debate-meta .debate-stage:has-text("Agents are voting on the drafts")')
    await ana.page.waitForSelector('.debate-voting:has-text("0 agents have voted.")')
    await capture(ana.page, 'two-drafts-put-to-a-vote')
    const own = await anaAgent.call('POST', `/debates/${id}/result/vote`, { round: 0, draftBy: ids.ana })
    assert.match(own.error.message, /own draft/)
    await anaAgent.call('POST', `/debates/${id}/result/vote`, { round: 0, draftBy: ids.ben })
    const chosen = await benAgent.call('POST', `/debates/${id}/result/vote`, { round: 0, draftBy: ids.ana })
    assert.equal(chosen.result.draftedBy, ids.ana, 'a tie goes to the earliest draft')
    await ben.page.waitForSelector(`.debate-draft.is-chosen[data-member="${ids.ana}"]:has-text("1 vote")`)
    await ben.page.waitForSelector(`.debate-draft[data-member="${ids.ben}"]:has-text("1 vote")`)
    await ben.page.waitForSelector('.debate-point[data-category="goals"]')
    await ana.page.waitForSelector('.debate-meta .debate-stage:has-text("Closed")')
    await ben.page.click('.debate-tabs a[data-tab="votes"]')
    await ben.page.waitForSelector(`.debate-vote-record li.is-voted[data-member="${ids.ben}"]`)
    await capture(ben.page, 'closed-room-votes')
    await ben.page.click('.debate-tabs a[data-tab="credit"]')
    await ben.page.waitForSelector(
      `.debate-credit-list li[data-member="${ids.ben}"]:has-text("Ana and Ben agree")`,
    )
    await capture(ben.page, 'closed-room-credit')
    await capture(ana.page, 'closed-room-with-the-result-the-agents-settled')
    for (const desk of desks) desk.abort()

    // -- Export as Markdown, with display names; post the result as a draft --------------------
    const [download] = await Promise.all([
      ana.page.waitForEvent('download'),
      ana.page.click('button.export-markdown'),
    ])
    const exported = await readFile(await download.path(), 'utf8')
    assert.match(exported, /^# Flock: Should we ship the billing migration this week\?/)
    assert.match(exported, /Ana’s agent \(Ana laptop; model: not stated\)/)
    assert.equal(exported.includes(ids.ana), false, 'the export names people, not ids')
    const [json] = await Promise.all([
      ana.page.waitForEvent('download'),
      ana.page.click('button.export-json'),
    ])
    assert.equal(JSON.parse(await readFile(await json.path(), 'utf8')).result.kind, 'no_conclusion')
    await ana.page.selectOption('.debate-post-form select[name="person"]', ids.ben)
    await ana.page.click('.debate-post-form button[type="submit"]')
    await ana.page.waitForSelector('main .draft:has-text("From the flock")')
    await capture(ana.page, 'settled-result-waiting-as-a-draft')

    // -- The growth record credits the agent, never with a count -------------------------------
    await ana.page.goto(`${base}/#/agent/teaching`)
    await ana.page.waitForSelector('.milestone:has-text("filled a gap another agent lacked")')
    await capture(ana.page, 'milestones-credit-the-debate')

    // -- Narrow, and in Korean ------------------------------------------------------------------
    const narrow: Person = await newPage(browser, base, 'en-US', { viewport: NARROW })
    await submitDevelopmentLogin(narrow.page, 'ben@example.com', 'Ben')
    await narrow.page.waitForSelector('.app')
    const narrowPages = [
      [`#/debate/${id}`, '.debate-result'],
      [`#/debate/${id}/turns`, '.debate-turn'],
      [`#/debate/${id}/votes`, '.debate-vote-record'],
      [`#/debate/${id}/credit`, '.debate-credit-list'],
      ['#/debates', '.debate-card'],
    ] as const
    for (const [path, ready] of narrowPages) {
      await narrow.page.goto(`${base}/${path}`)
      await narrow.page.waitForSelector(ready)
      assert.equal(await overflowsSideways(narrow.page), false, `${path} scrolls sideways when narrow`)
      assert.deepEqual(await pastTheRightEdge(narrow.page), [], `${path} reaches past the right edge`)
    }
    await capture(narrow.page, 'narrow-room-list')
    await narrow.context.close()

    const korean: Person = await newPage(browser, base, 'ko-KR', { viewport: NARROW })
    await submitDevelopmentLogin(korean.page, 'ben@example.com', 'Ben')
    await korean.page.waitForSelector('.app')
    await korean.page.goto(`${base}/#/debate/${id}`)
    await korean.page.waitForSelector('.debate-meta .debate-stage:has-text("닫힘")')
    await korean.page.waitForSelector('.debate-point[data-category="goals"]:has-text("목표")')
    await korean.page.waitForSelector('.debate-tabs a[aria-current="page"]:has-text("결과")')
    assert.equal(await overflowsSideways(korean.page), false, 'the Korean room scrolls sideways when narrow')
    assert.deepEqual(await pastTheRightEdge(korean.page), [], 'the Korean room reaches past the right edge')
    await capture(korean.page, 'korean-closed-room-narrow')
    const [koreanDownload] = await Promise.all([
      korean.page.waitForEvent('download'),
      korean.page.click('button.export-markdown'),
    ])
    assert.match(await readFile(await koreanDownload.path(), 'utf8'), /^# 플록: /)
    await korean.page.goto(`${base}/#/debates`)
    await korean.page.click('button.new-flock-button')
    await korean.page.waitForSelector('dialog[open] .create-debate')
    await capture(korean.page, 'korean-new-room-form')
    await korean.context.close()
  } finally {
    await browser.close()
    await dovecote.stop()
  }
}

await scenario()
process.stdout.write(`debate e2e passed; screenshots in ${screenshots}\n`)
process.exit(0)
