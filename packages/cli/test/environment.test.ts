import { describe, expect, it } from 'vitest'
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '../src/environment.ts'

const GROUP_AND_OTHERS = 0o077

describe('private file modes', () => {
  it('let only the owner read and write a private file, and run nothing', () => {
    expect(PRIVATE_FILE_MODE & GROUP_AND_OTHERS).toBe(0)
    expect(PRIVATE_FILE_MODE).toBe(0o400 | 0o200)
  })

  it('let only the owner list, enter and change a private directory', () => {
    expect(PRIVATE_DIRECTORY_MODE & GROUP_AND_OTHERS).toBe(0)
    expect(PRIVATE_DIRECTORY_MODE).toBe(0o400 | 0o200 | 0o100)
  })
})
