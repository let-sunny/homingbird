import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Iter as I, pipe } from '../src/index.ts'

const arr = fc.array(fc.integer({ min: -50, max: 50 }), { maxLength: 30 })
const small = fc.integer({ min: -3, max: 35 })

const tracked = <A>(items: ReadonlyArray<A>) => {
  const state = { pulled: 0, closed: false }
  const iterable: Iterable<A> = {
    *[Symbol.iterator]() {
      try {
        for (const item of items) {
          state.pulled++
          yield item
        }
      } finally {
        state.closed = true
      }
    },
  }
  return { state, iterable }
}

describe('Iter', () => {
  it('map matches Array.map, index included', () => {
    fc.assert(
      fc.property(arr, (xs) => {
        expect(
          pipe(
            xs,
            I.map((x, i) => x * 2 + i),
            I.toArray,
          ),
        ).toEqual(xs.map((x, i) => x * 2 + i))
      }),
    )
  })

  it('filter matches Array.filter', () => {
    fc.assert(
      fc.property(arr, (xs) => {
        expect(
          pipe(
            xs,
            I.filter((x) => x % 2 === 0),
            I.toArray,
          ),
        ).toEqual(xs.filter((x) => x % 2 === 0))
      }),
    )
  })

  it('flatMap matches Array.flatMap', () => {
    fc.assert(
      fc.property(arr, (xs) => {
        expect(
          pipe(
            xs,
            I.flatMap((x) => [x, -x]),
            I.toArray,
          ),
        ).toEqual(xs.flatMap((x) => [x, -x]))
      }),
    )
  })

  it('take and drop match slice', () => {
    fc.assert(
      fc.property(arr, small, (xs, n) => {
        expect(pipe(xs, I.take(n), I.toArray)).toEqual(xs.slice(0, Math.max(0, n)))
        expect(pipe(xs, I.drop(n), I.toArray)).toEqual(xs.slice(Math.max(0, n)))
      }),
    )
  })

  it('take pulls exactly n items and closes the source', () => {
    const { state, iterable } = tracked([1, 2, 3, 4])
    expect(pipe(iterable, I.take(2), I.toArray)).toEqual([1, 2])
    expect(state).toEqual({ pulled: 2, closed: true })
  })

  it('take(0) pulls nothing', () => {
    const { state, iterable } = tracked([1, 2])
    expect(pipe(iterable, I.take(0), I.toArray)).toEqual([])
    expect(state.pulled).toBe(0)
  })

  it('takeWhile stops at the first rejection', () => {
    fc.assert(
      fc.property(arr, (xs) => {
        const cut = xs.findIndex((x) => x < 0)
        expect(
          pipe(
            xs,
            I.takeWhile((x) => x >= 0),
            I.toArray,
          ),
        ).toEqual(cut === -1 ? xs : xs.slice(0, cut))
      }),
    )
  })

  it('scan yields running states without the seed', () => {
    fc.assert(
      fc.property(arr, (xs) => {
        let sum = 10
        expect(
          pipe(
            xs,
            I.scan(10, (s, x) => s + x),
            I.toArray,
          ),
        ).toEqual(xs.map((x) => (sum += x)))
      }),
    )
  })

  it('chunk splits into full chunks and a remainder', () => {
    fc.assert(
      fc.property(arr, fc.integer({ min: 1, max: 7 }), (xs, size) => {
        const chunks = pipe(xs, I.chunk(size), I.toArray)
        expect(chunks.flat()).toEqual(xs)
        expect(chunks.length).toBe(Math.ceil(xs.length / size))
        for (const c of chunks.slice(0, -1)) expect(c.length).toBe(size)
        for (const c of chunks) expect(c.length).toBeGreaterThan(0)
      }),
    )
    expect(pipe([1, 2, 3, 4], I.chunk(2), I.toArray)).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(pipe([1], I.chunk(1), I.toArray)).toEqual([[1]])
  })

  it('chunk rejects sizes below 1', () => {
    expect(() => pipe([1], I.chunk(0), I.toArray)).toThrow(new RangeError('chunk size must be at least 1'))
    expect(() => pipe([], I.chunk(0.5), I.toArray)).toThrow(RangeError)
  })

  it('zip pairs up to the shorter side', () => {
    fc.assert(
      fc.property(arr, arr, (xs, ys) => {
        const n = Math.min(xs.length, ys.length)
        expect(pipe(xs, I.zip(ys), I.toArray)).toEqual(Array.from({ length: n }, (_, i) => [xs[i], ys[i]]))
      }),
    )
  })

  it('zip closes the other side', () => {
    const other = tracked([1, 2, 3])
    expect(pipe(['a'], I.zip(other.iterable), I.toArray)).toEqual([['a', 1]])
    expect(other.state.closed).toBe(true)
    const shorter = tracked([1])
    expect(pipe(['a', 'b'], I.zip(shorter.iterable), I.toArray)).toEqual([['a', 1]])
    expect(shorter.state.closed).toBe(true)
  })

  it('zip tolerates iterators without return', () => {
    const bare: Iterable<number> = {
      [Symbol.iterator]: () => {
        let i = 0
        return { next: () => ({ done: false, value: i++ }) }
      },
    }
    expect(pipe(['a', 'b'], I.zip(bare), I.toArray)).toEqual([
      ['a', 0],
      ['b', 1],
    ])
  })

  it('enumerate pairs items with indices', () => {
    expect(I.toArray(I.enumerate(['a', 'b']))).toEqual([
      [0, 'a'],
      [1, 'b'],
    ])
  })

  it('concat appends in order', () => {
    fc.assert(
      fc.property(arr, arr, arr, (xs, ys, zs) => {
        expect(pipe(xs, I.concat(ys, zs), I.toArray)).toEqual([...xs, ...ys, ...zs])
      }),
    )
  })

  it('dedupeBy keeps the first of each key', () => {
    fc.assert(
      fc.property(arr, (xs) => {
        const key = (x: number) => Math.abs(x)
        const expected = xs.filter((x, i) => xs.findIndex((y) => key(y) === key(x)) === i)
        expect(pipe(xs, I.dedupeBy(key), I.toArray)).toEqual(expected)
      }),
    )
  })

  it('range counts up, down and forever', () => {
    expect(I.toArray(I.range(0, 3))).toEqual([0, 1, 2])
    expect(I.toArray(I.range(1, 8, 3))).toEqual([1, 4, 7])
    expect(I.toArray(I.range(3, 0, -1))).toEqual([3, 2, 1])
    expect(I.toArray(I.range(3, 3))).toEqual([])
    expect(I.toArray(I.range(0, 0, -1))).toEqual([])
    expect(pipe(I.range(), I.take(3), I.toArray)).toEqual([0, 1, 2])
    expect(pipe(I.range(5), I.take(2), I.toArray)).toEqual([5, 6])
    expect(() => I.toArray(I.range(0, 1, 0))).toThrow(new RangeError('range step must not be 0'))
  })

  it('iterate and repeat are infinite and lazy', () => {
    expect(
      pipe(
        I.iterate(1, (n) => n * 2),
        I.take(5),
        I.toArray,
      ),
    ).toEqual([1, 2, 4, 8, 16])
    expect(pipe(I.repeat('x'), I.take(3), I.toArray)).toEqual(['x', 'x', 'x'])
  })

  it('reduce and count', () => {
    fc.assert(
      fc.property(arr, (xs) => {
        expect(
          pipe(
            xs,
            I.reduce(1, (s, x) => s + x),
          ),
        ).toBe(xs.reduce((s, x) => s + x, 1))
        expect(I.count(xs)).toBe(xs.length)
      }),
    )
  })

  it('first, find, some, every', () => {
    fc.assert(
      fc.property(arr, (xs) => {
        const p = (x: number) => x > 10
        expect(I.first(xs)).toBe(xs[0])
        expect(pipe(xs, I.find(p))).toBe(xs.find(p))
        expect(pipe(xs, I.some(p))).toBe(xs.some(p))
        expect(pipe(xs, I.every(p))).toBe(xs.every(p))
      }),
    )
  })

  it('some and every short-circuit', () => {
    const a = tracked([1, 2, 3])
    expect(
      pipe(
        a.iterable,
        I.some((x) => x === 1),
      ),
    ).toBe(true)
    expect(a.state.pulled).toBe(1)
    const b = tracked([1, 2, 3])
    expect(
      pipe(
        b.iterable,
        I.every((x) => x !== 1),
      ),
    ).toBe(false)
    expect(b.state.pulled).toBe(1)
  })

  it('groupBy keeps insertion order within groups', () => {
    const groups = pipe(
      [1, 2, 3, 4, 5],
      I.groupBy((x) => (x % 2 === 0 ? 'even' : 'odd')),
    )
    expect([...groups.entries()]).toEqual([
      ['odd', [1, 3, 5]],
      ['even', [2, 4]],
    ])
  })

  it('combinators are re-iterable and lazy', () => {
    let calls = 0
    const mapped = pipe(
      [1, 2, 3],
      I.map((x) => {
        calls++
        return x
      }),
    )
    expect(calls).toBe(0)
    expect(I.toArray(mapped)).toEqual([1, 2, 3])
    expect(I.toArray(mapped)).toEqual([1, 2, 3])
    expect(calls).toBe(6)
  })

  it('endless generators stop cleanly when their consumer stops', () => {
    for (const source of [I.iterate(1, (n) => n * 2), I.repeat(1), I.range()]) {
      const seen: number[] = []
      for (const item of source) {
        seen.push(item)
        if (seen.length === 2) break
      }
      expect(seen).toHaveLength(2)
      expect(source.next().done).toBe(true)
    }
  })
})
