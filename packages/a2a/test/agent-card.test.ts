import { describe, expect, it } from 'vitest'
import { A2A_PROTOCOL_VERSION, agentCard } from '../src/agent-card.ts'

const card = agentCard('https://hb.example.com', '1.2.3') as any

describe('agentCard', () => {
  it('advertises the JSON-RPC interface at /a2a for 1.0 first and for 0.3 readers second', () => {
    expect(A2A_PROTOCOL_VERSION).toBe('1.0')
    expect(card.supportedInterfaces).toEqual([
      { url: 'https://hb.example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { url: 'https://hb.example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '0.3' },
    ])
    expect(card.version).toBe('1.2.3')
    expect(card.name).toBe('Homingbird')
  })

  it('carries only the top-level fields of the 1.0 AgentCard, which allows no others', () => {
    const allowed = [
      'capabilities',
      'defaultInputModes',
      'defaultOutputModes',
      'description',
      'documentationUrl',
      'iconUrl',
      'name',
      'provider',
      'securityRequirements',
      'securitySchemes',
      'signatures',
      'skills',
      'supportedInterfaces',
      'version',
    ]
    expect(Object.keys(card).filter((key) => !allowed.includes(key))).toEqual([])
  })

  it('claims no capability the gateway refuses', () => {
    expect(card.capabilities).toEqual({
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    })
    expect(card.defaultInputModes).toEqual(['text/plain'])
    expect(card.defaultOutputModes).toEqual(['text/plain'])
  })

  it('says in its description and skill that a person approves before anything is delivered', () => {
    expect(card.description).toMatch(/only after the sending member, a person, approves/)
    expect(card.skills).toHaveLength(1)
    expect(card.skills[0].description).toMatch(/input-required until the member approves/)
    expect(card.skills[0].examples[0]).toContain('june@example.com')
  })

  it('tells a remote agent how to name a colleague, a channel or a note to reply to', () => {
    const { description } = card.skills[0]
    expect(description).toContain('metadata.to')
    expect(description).toContain('metadata.channel')
    expect(description).toContain('a private channel only when the member belongs to it')
    expect(description).toContain('never several for one question')
    expect(description).toContain('when nobody fits, tell the member that no destination was found')
    expect(description).toContain('metadata.inReplyTo')
  })

  it('points every OAuth scheme at this server and offers only the notes scope', () => {
    const { bearer, oauth, device } = card.securitySchemes
    expect(bearer.httpAuthSecurityScheme.scheme).toBe('Bearer')
    const code = oauth.oauth2SecurityScheme
    expect(code.oauth2MetadataUrl).toBe('https://hb.example.com/.well-known/oauth-authorization-server')
    expect(code.flows.authorizationCode).toMatchObject({
      authorizationUrl: 'https://hb.example.com/oauth/authorize',
      tokenUrl: 'https://hb.example.com/oauth/token',
      pkceRequired: true,
    })
    expect(Object.keys(code.flows.authorizationCode.scopes)).toEqual(['notes'])
    expect(device.oauth2SecurityScheme.flows.deviceCode).toMatchObject({
      deviceAuthorizationUrl: 'https://hb.example.com/oauth/device_authorization',
      tokenUrl: 'https://hb.example.com/oauth/token',
    })
    expect(JSON.stringify(card)).not.toContain('approve"')
  })

  it('requires one of its declared schemes', () => {
    const required = card.securityRequirements.flatMap((one: any) => Object.keys(one.schemes))
    expect(required.sort()).toEqual(Object.keys(card.securitySchemes).sort())
  })
})
