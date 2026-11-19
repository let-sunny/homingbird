import { describe, expect, it } from 'vitest'
import { deskPausePath } from '../src/desk-pause.ts'
import { EXIT } from '../src/failure.ts'
import { ANA, SERVER, world } from './support.ts'

const ME = {
  member: ANA,
  credential: { id: 'cred_aaaaaaaaaaaa', kind: 'agent', name: 'Laptop' },
  contactMode: 'open',
} as never

describe('homingbird desk pause and resume', () => {
  it('writes the pause flag next to the desk claim, and does nothing more when paused already', async () => {
    const w = world({ stubs: { 'me.get': () => ME } })
    const flag = deskPausePath(w.env, SERVER, ANA.id)
    expect(flag).toBe(`/home/june/.config/homingbird/desks/https%3A%2F%2Fhb.example.com~${ANA.id}.paused`)
    expect(await w.run('desk', 'pause', '--server', SERVER)).toBe(0)
    expect(w.files.has(flag)).toBe(true)
    expect(w.lines[0]).toBe(
      `Paused the desk for Ana on ${SERVER}. Runners on this computer leave arriving notes waiting until \`homingbird desk resume\`.`,
    )
    const written = w.files.get(flag)
    expect(await w.run('desk', 'pause', '--server', SERVER, '--json')).toBe(0)
    expect(w.json()).toMatchObject({ paused: true, changed: false })
    expect(w.files.get(flag)).toBe(written)
  })

  it('removes the flag on resume, and says so when it was not paused', async () => {
    const w = world({ stubs: { 'me.get': () => ME } })
    const flag = deskPausePath(w.env, SERVER, ANA.id)
    w.files.set(flag, '{}')
    expect(await w.run('desk', 'resume')).toBe(0)
    expect(w.files.has(flag)).toBe(false)
    expect(w.lines[0]).toBe(
      `Resumed the desk for Ana on ${SERVER}. Runners on this computer answer arriving notes, starting with those that waited.`,
    )
    await w.run('desk', 'resume')
    expect(w.lines[1]).toBe(
      `Not paused: the desk for Ana on ${SERVER}. Runners on this computer answer arriving notes.`,
    )
  })

  it('shows a paused desk in homingbird status', async () => {
    const w = world({ stubs: { 'me.get': () => ME } })
    await w.run('desk', 'pause')
    await w.run('status')
    expect(w.lines.at(-1)).toContain(
      'Desk:           paused on this computer; `homingbird desk resume` to answer again',
    )
    await w.run('status', '--json')
    expect(w.json()).toMatchObject({ deskPaused: true })
  })

  it('needs a sign-in, since the flag belongs to one person on one server', async () => {
    const w = world({ signedIn: 'none' })
    expect(await w.run('desk', 'pause')).toBe(EXIT.signedOut)
    expect(w.files.size).toBe(0)
  })
})
