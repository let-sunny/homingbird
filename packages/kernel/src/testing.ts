import fc from 'fast-check'
import type { Ast, Schema } from './schema.ts'

export type RefinementArbitraries = Readonly<Record<string, fc.Arbitrary<unknown>>>

export const arbitrary = <A>(schema: Schema<A>, refinements: RefinementArbitraries = {}): fc.Arbitrary<A> => {
  const go = (ast: Ast): fc.Arbitrary<unknown> => {
    switch (ast.type) {
      case 'string':
        return ast.pattern !== undefined
          ? fc
              .stringMatching(new RegExp(ast.pattern))
              .filter(
                (s) =>
                  s.length >= (ast.minLength ?? 0) && s.length <= (ast.maxLength ?? Number.POSITIVE_INFINITY),
              )
          : fc.string({
              minLength: ast.minLength ?? 0,
              ...(ast.maxLength !== undefined && { maxLength: ast.maxLength }),
            })
      case 'number':
        return ast.integer
          ? fc.integer({
              min: ast.min ?? Number.MIN_SAFE_INTEGER,
              max: ast.max ?? Number.MAX_SAFE_INTEGER,
            })
          : fc.double({
              noNaN: true,
              noDefaultInfinity: true,
              ...(ast.min !== undefined && { min: ast.min }),
              ...(ast.max !== undefined && { max: ast.max }),
            })
      case 'boolean':
        return fc.boolean()
      case 'unknown':
        return fc.jsonValue()
      case 'literal':
        return fc.constantFrom(...ast.values)
      case 'array':
        return fc.array(go(ast.items), {
          minLength: ast.minItems ?? 0,
          maxLength: ast.maxItems ?? 5,
        })
      case 'record':
        return fc.dictionary(fc.string({ maxLength: 8 }), go(ast.values), { maxKeys: 4 })
      case 'struct': {
        const required = Object.entries(ast.fields).filter(([, f]) => !f.optional)
        const optional = Object.entries(ast.fields).filter(([, f]) => f.optional)
        return fc
          .tuple(
            fc.record(Object.fromEntries(required.map(([k, f]) => [k, go(f.ast)]))),
            fc.record(Object.fromEntries(optional.map(([k, f]) => [k, go(f.ast)])), { requiredKeys: [] }),
          )
          .map(([a, b]) => ({ ...a, ...b }))
      }
      case 'union':
        return fc.oneof(...ast.members.map(go))
      case 'refined':
        return refinements[ast.name] ?? go(ast.inner)
    }
  }
  return go(schema.ast).filter((value) => schema.is(value)) as fc.Arbitrary<A>
}
