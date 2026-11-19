/** The vocabulary of a migration step: a table, an added column or index, or a backfill. */
export type Migration = ReadonlyArray<Step>

export type Step = Table | AddedColumn | AddedIndex | Backfill

export type ColumnType = 'id' | 'string' | 'text' | 'integer' | 'serial'

export interface Column {
  readonly type: ColumnType
  readonly nullable?: true
}

export interface Table {
  readonly name: string
  readonly columns: Readonly<Record<string, Column>>
  readonly primaryKey: ReadonlyArray<string>
  readonly indexes?: ReadonlyArray<{ readonly columns: ReadonlyArray<string>; readonly unique?: true }>
}

export interface AddedColumn {
  readonly addTo: string
  readonly name: string
  readonly column: Column & { readonly nullable: true }
}

export interface AddedIndex {
  readonly indexOn: string
  readonly columns: ReadonlyArray<string>
}

export interface Backfill {
  readonly backfill: string
}

export const id: Column = { type: 'id' }
export const optionalId: Column = { type: 'id', nullable: true }
export const string: Column = { type: 'string' }
export const optionalString = { type: 'string', nullable: true } as const satisfies Column
export const text: Column = { type: 'text' }
export const optionalText = { type: 'text', nullable: true } as const satisfies Column
export const integer: Column = { type: 'integer' }
export const optionalInteger = { type: 'integer', nullable: true } as const satisfies Column
