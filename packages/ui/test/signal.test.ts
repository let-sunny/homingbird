import { describe, expect, it, vi } from 'vitest'
import { derived, onAnyChange, signal } from '../src/signal.ts'

describe('signal', () => {
  it('notifies subscribers of each new value and stops after unsubscribing', () => {
    const count = signal(0)
    const seen: number[] = []
    const unsubscribe = count.subscribe((value) => seen.push(value))
    count.set(1)
    count.update((value) => value + 1)
    unsubscribe()
    count.set(9)
    expect(seen).toEqual([1, 2])
    expect(count.get()).toBe(9)
  })

  it('stays silent when the value is unchanged', () => {
    const name = signal('ana')
    const listener = vi.fn()
    name.subscribe(listener)
    name.set('ana')
    expect(listener).not.toHaveBeenCalled()
  })

  it('lets a listener unsubscribe another during notification', () => {
    const count = signal(0)
    const second = vi.fn()
    let stopSecond = (): void => {}
    count.subscribe(() => stopSecond())
    stopSecond = count.subscribe(second)
    count.set(1)
    expect(second).toHaveBeenCalledTimes(1)
    count.set(2)
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('derived', () => {
  it('recomputes from its sources and only notifies when the result changes', () => {
    const a = signal(1)
    const b = signal(2)
    const isLarge = derived([a, b], (x, y) => x + y > 10)
    const seen: boolean[] = []
    const unsubscribe = isLarge.subscribe((value) => seen.push(value))
    expect(isLarge.get()).toBe(false)
    a.set(5)
    b.set(20)
    a.set(6)
    expect(seen).toEqual([true])
    unsubscribe()
    b.set(0)
    expect(seen).toEqual([true])
    expect(isLarge.get()).toBe(false)
  })
})

describe('onAnyChange', () => {
  it('reacts to every source until released', () => {
    const a = signal(0)
    const b = signal('x')
    const react = vi.fn()
    const release = onAnyChange([a, b], react)
    a.set(1)
    b.set('y')
    release()
    a.set(2)
    expect(react).toHaveBeenCalledTimes(2)
  })
})
