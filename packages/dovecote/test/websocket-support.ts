import { encodeFrame } from '../src/http/websocket.ts'

export const maskedFrame = (opcode: number, payload: Buffer, mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d])): Buffer => {
  const header = encodeFrame(opcode, payload).subarray(0, encodeFrame(opcode, payload).length - payload.length)
  header[1] = header[1]! | 0x80
  const masked = Buffer.from(payload)
  for (let i = 0; i < masked.length; i++) masked[i] = masked[i]! ^ mask[i % 4]!
  return Buffer.concat([header, mask, masked])
}
