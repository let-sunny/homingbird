import { Schema } from '@homingbird/kernel'
import type { Rect } from './grid.ts'

/**
 * A profile character: Pip's bubble body with its own palette and markings. Built-in characters,
 * the editor and Claude's drafts all produce this one shape; `validateCharacter` holds the brand rules.
 */
export const CharacterSpec = Schema.struct({
  version: Schema.literal(1),
  base: Schema.literal('bubble-16'),
  id: Schema.string({ pattern: /^[a-z0-9][a-z0-9-]{1,31}$/ }),
  name: Schema.string({ minLength: 1, maxLength: 20 }),
  palette: Schema.struct({
    B: Schema.optional(Schema.string({ pattern: /^#[0-9A-Fa-f]{6}$/ })),
    D: Schema.optional(Schema.string({ pattern: /^#[0-9A-Fa-f]{6}$/ })),
    O: Schema.optional(Schema.string({ pattern: /^#[0-9A-Fa-f]{6}$/ })),
    F: Schema.optional(Schema.string({ pattern: /^#[0-9A-Fa-f]{6}$/ })),
    K: Schema.optional(Schema.string({ pattern: /^#[0-9A-Fa-f]{6}$/ })),
  }),
  noFeet: Schema.optional(Schema.boolean),
  marks: Schema.array(
    // A mark is the tuple [x, y, w, h, color]; the kernel has no tuple schema, so the refinement
    // proves the shape and the cast only narrows the decoded type to that tuple.
    Schema.refine(
      'mark',
      isMarkTuple,
      'expected [x, y, w, h, color] with whole numbers and a color',
    )(
      Schema.array(Schema.union(Schema.int(), Schema.string()), { minItems: 5, maxItems: 5 }),
    ) as unknown as Schema.Schema<Rect>,
    { maxItems: 80 },
  ),
})

export type CharacterSpec = Schema.Infer<typeof CharacterSpec>

export type PaletteKey = 'B' | 'D' | 'O' | 'F' | 'K'

export const CHARACTER_SPEC_JSON_SCHEMA = Schema.toJsonSchema(CharacterSpec.ast)

function isMarkTuple(mark: ReadonlyArray<number | string>): boolean {
  return mark.slice(0, 4).every((value) => typeof value === 'number') && typeof mark[4] === 'string'
}
