import { describe, expect, it } from 'vitest'
import { connectionShown } from '../src/connection-status.ts'
import { en } from '../src/languages/en.ts'
import { ko } from '../src/languages/ko.ts'
import { compile } from '../src/messages.ts'

const english = compile<typeof en>('en', en)
const korean = compile<typeof en>('ko', ko)

describe('connectionShown', () => {
  it('says the page is up to date only to assistive technology while it is connected, naming the page and not the agent', () => {
    expect(connectionShown('live', english)).toEqual({
      state: 'connected',
      label: 'This page is up to date',
      description: 'This page is up to date',
      noticeable: false,
      shown: 'hidden',
    })
  })

  it('says Connected for the fallback transport too, which people cannot tell apart', () => {
    expect(connectionShown('polling', english)).toEqual(connectionShown('live', english))
  })

  it('says Connecting… and draws attention while it connects', () => {
    expect(connectionShown('connecting', english)).toMatchObject({
      label: 'This page is connecting…',
      noticeable: true,
    })
  })

  it('says Offline in short and explains what happens in full', () => {
    expect(connectionShown('offline', english)).toEqual({
      state: 'offline',
      label: 'This page is offline',
      description: 'Offline: new notes will appear when you are back online.',
      noticeable: true,
      shown: 'label',
    })
  })

  it('shows nothing while all is well, and always words connecting and offline', () => {
    expect(connectionShown('live', english).shown).toBe('hidden')
    expect(connectionShown('polling', english).shown).toBe('hidden')
    expect(connectionShown('connecting', english).shown).toBe('label')
    expect(connectionShown('offline', korean)).toMatchObject({
      shown: 'label',
      label: '이 페이지 오프라인',
    })
  })

  it('speaks Korean', () => {
    expect(connectionShown('live', korean).label).toBe('이 페이지 최신 상태')
    expect(connectionShown('polling', korean).label).toBe('이 페이지 최신 상태')
    expect(connectionShown('connecting', korean).label).toBe('이 페이지 연결 중…')
    expect(connectionShown('offline', korean).description).toBe('오프라인: 다시 연결되면 새 노트가 보여요.')
  })
})
