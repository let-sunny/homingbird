/**
 * A stack of horizontal slices, bottom slice first. A slice has `length` rows from the tail (row 0) to
 * the beak, and `width` columns from one flank to the other. Each cell holds a voxel or nothing.
 */
export interface Volume {
  readonly width: number
  readonly length: number
  readonly height: number
  readonly cells: ReadonlyArray<Voxel | null>
}

/**
 * A palette key such as `B`, or a `#RRGGBB` color from a marking. A shaded voxel is darker the nearer it
 * is to the ground, which is what makes the stack read as round.
 */
export interface Voxel {
  readonly color: string
  readonly shaded: boolean
}

export const cellIndex = (volume: Pick<Volume, 'width' | 'length'>, z: number, row: number, column: number) =>
  (z * volume.length + row) * volume.width + column

export const voxelAt = (volume: Volume, z: number, row: number, column: number): Voxel | null =>
  volume.cells[cellIndex(volume, z, row, column)] ?? null
