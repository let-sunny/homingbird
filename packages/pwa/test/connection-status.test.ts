import { describe, expect, it } from 'vitest'
import { connectionShown } from '../src/connection-status.ts'
import { en } from '../src/languages/en.ts'
import { ko } from '../src/languages/ko.ts'
import { compile } from '../src/messages.ts'

const english = compile<typeof en>('en', en)
const korean = compile<typeof en>('ko', ko)

describe('connectionShown', () => {
  it('says Connected, quietly, while the page is connected', () => {
    expect(connectionShown('live', english)).toEqual({
      state: 'connected',
      label: 'Connected',
      description: 'Connected',
      noticeable: false,
      whenShort: 'hidden',
    })
  })

  it('says Connected for the fallback transport too, which people cannot tell apart', () => {
    expect(connectionShown('polling', english)).toEqual(connectionShown('live', english))
  })

  it('says Connecting… and draws attention while it connects', () => {
    expect(connectionShown('connecting', english)).toMatchObject({ label: 'Connecting…', noticeable: true })
  })

  it('says Offline in short and explains what happens in full', () => {
    expect(connectionShown('offline', english)).toEqual({
      state: 'offline',
      label: 'Offline',
      description: 'Offline: new notes will appear when you are back online.',
      noticeable: true,
      whenShort: 'label',
    })
  })

  it('hides a bare mark where the header is short of room, but always words connecting and offline', () => {
    expect(connectionShown('live', english).whenShort).toBe('hidden')
    expect(connectionShown('polling', english).whenShort).toBe('hidden')
    expect(connectionShown('connecting', english).whenShort).toBe('label')
    expect(connectionShown('offline', korean)).toMatchObject({ whenShort: 'label', label: '오프라인' })
  })

  it('speaks Korean', () => {
    expect(connectionShown('live', korean).label).toBe('연결됨')
    expect(connectionShown('polling', korean).label).toBe('연결됨')
    expect(connectionShown('connecting', korean).label).toBe('연결 중…')
    expect(connectionShown('offline', korean).description).toBe('오프라인: 다시 연결되면 새 노트가 보여요.')
  })
})
