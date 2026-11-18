import type { Pixels } from '../render.ts'
import { encodePng } from './png.ts'

/** Packs square images into one ICO file, each stored as PNG. */
export const encodeIco = (images: ReadonlyArray<Pixels>): Buffer => {
  const pngs = images.map(encodePng)
  const directory = Buffer.alloc(6 + 16 * images.length)
  directory.writeUInt16LE(0, 0)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(images.length, 4)
  let offset = directory.length
  images.forEach((image, index) => {
    const entry = 6 + 16 * index
    directory[entry] = image.width >= 256 ? 0 : image.width
    directory[entry + 1] = image.height >= 256 ? 0 : image.height
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(pngs[index]!.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += pngs[index]!.length
  })
  return Buffer.concat([directory, ...pngs])
}
