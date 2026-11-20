import fc from 'fast-check'

export const refinements = {
  'note-body': fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  'agent-label': fc
    .string({ minLength: 1, maxLength: 80 })
    .filter((s) => s.trim() !== '' && !/[\p{Cc}\p{Cf}]/u.test(s)),
  'group-name': fc
    .string({ minLength: 1, maxLength: 80 })
    .filter((s) => s.trim() !== '' && !/[\p{Cc}\p{Cf}]/u.test(s)),
}
