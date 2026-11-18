export const compile = <Source>(locale: string, source: Translation<Source>): Compiled<Source> => {
  const numbers = new Intl.NumberFormat(locale)
  const plurals = new Intl.PluralRules(locale)
  const fill = (template: string, values: Readonly<Record<string, Value>>): string =>
    template.replace(PLACEHOLDER, (whole, name: string) => {
      const value = values[name]
      if (value === undefined) return whole
      return typeof value === 'number' ? numbers.format(value) : value
    })
  const compileEntry = (entry: unknown): unknown => {
    if (typeof entry === 'string')
      return placeholdersOf(entry).length === 0 ? entry : (values: never) => fill(entry, values)
    if (isPlural(entry))
      return (values: { readonly count: number }) =>
        fill(entry[plurals.select(values.count)] ?? entry.other, values)
    return Object.fromEntries(
      Object.entries(entry as Readonly<Record<string, unknown>>).map(([key, value]) => [
        key,
        compileEntry(value),
      ]),
    )
  }
  return compileEntry(source) as Compiled<Source>
}

export const placeholdersOf = (template: string): string[] =>
  [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]!))].sort()

export const isPlural = (entry: unknown): entry is Plural =>
  typeof entry === 'object' &&
  entry !== null &&
  typeof (entry as { other?: unknown }).other === 'string' &&
  Object.keys(entry).every((key) => PLURAL_FORMS.includes(key as Intl.LDMLPluralRule))

export type Plural = { readonly other: string } & {
  readonly [Form in Exclude<Intl.LDMLPluralRule, 'other'>]?: string
}

export type Translation<Source> = {
  readonly [Key in keyof Source]: Source[Key] extends string
    ? string
    : Source[Key] extends { readonly other: string }
      ? Plural
      : Translation<Source[Key]>
}

export type Compiled<Source> = {
  readonly [Key in keyof Source]: Source[Key] extends string
    ? [Placeholders<Source[Key]>] extends [never]
      ? string
      : (values: Readonly<Record<Placeholders<Source[Key]>, Value>>) => string
    : Source[Key] extends { readonly other: string }
      ? (values: Readonly<Record<Exclude<FormPlaceholders<Source[Key]>, 'count'>, Value>> & CountOf) => string
      : Compiled<Source[Key]>
}

export type Placeholders<Template> = Template extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never

type FormPlaceholders<Forms> = { [Form in keyof Forms]: Placeholders<Forms[Form]> }[keyof Forms]

type CountOf = { readonly count: number }

type Value = string | number

const PLACEHOLDER = /\{(\w+)\}/g

const PLURAL_FORMS: ReadonlyArray<Intl.LDMLPluralRule> = ['zero', 'one', 'two', 'few', 'many', 'other']
