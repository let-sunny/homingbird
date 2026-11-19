import { describe, expect, it } from 'vitest'
import {
  id,
  integer,
  optionalId,
  optionalInteger,
  optionalString,
  optionalText,
  string,
  text,
} from '../src/sql/schema-steps.ts'

describe('the column vocabulary', () => {
  it('names each type once, required unless it says optional', () => {
    expect([id, string, text, integer].map((column) => [column.type, column.nullable ?? false])).toEqual([
      ['id', false],
      ['string', false],
      ['text', false],
      ['integer', false],
    ])
    expect(
      [optionalId, optionalString, optionalText, optionalInteger].map((column) => [
        column.type,
        column.nullable,
      ]),
    ).toEqual([
      ['id', true],
      ['string', true],
      ['text', true],
      ['integer', true],
    ])
  })
})
