import { expect, it } from 'vitest'
import { encryptPushPayload } from '../src/push/payload-encryption.ts'

it('reproduces the encrypted message of RFC 8291 section 5', () => {
  const body = encryptPushPayload({
    plaintext: Buffer.from('When I grow up, I want to be a watermelon'),
    senderPrivateKey: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'),
    subscriberPublicKey: Buffer.from(
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'base64url',
    ),
    subscriberAuthSecret: Buffer.from('BTBZMqHH6r4Tts7J_aSIgg', 'base64url'),
    salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
  })
  expect(body.toString('base64url')).toBe(
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  )
})
