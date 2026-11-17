export const A2A_PROTOCOL_VERSION = '1.0'

export const agentCard = (publicUrl: string, version: string): Readonly<Record<string, unknown>> => ({
  name: 'Homingbird',
  description:
    'Passes notes between colleagues through their agents. A message sent here becomes a draft; it is delivered only after the sending member, a person, approves it.',
  version,
  supportedInterfaces: [
    { url: `${publicUrl}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: A2A_PROTOCOL_VERSION },
  ],
  capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    {
      id: 'draft-note',
      name: 'Draft a note to a colleague',
      description:
        'Drafts a text note from the authenticated member to a colleague, or a reply to a note they received. The task stays input-required until the member approves the note, is working while the colleague reads and answers, and completes with the reply as an artifact.',
      tags: ['messaging', 'human-in-the-loop'],
      examples: ['Ask june@example.com whether the billing migration is safe to run today.'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    },
  ],
  securitySchemes: {
    bearer: {
      httpAuthSecurityScheme: {
        scheme: 'Bearer',
        description: 'An agent credential a member issued for themselves in Homingbird.',
      },
    },
    oauth: {
      oauth2SecurityScheme: {
        description: 'OAuth 2.1 with PKCE. The member signs in and consents in the browser.',
        oauth2MetadataUrl: `${publicUrl}/.well-known/oauth-authorization-server`,
        flows: {
          authorizationCode: {
            authorizationUrl: `${publicUrl}/oauth/authorize`,
            tokenUrl: `${publicUrl}/oauth/token`,
            refreshUrl: `${publicUrl}/oauth/token`,
            scopes: SCOPES,
            pkceRequired: true,
          },
        },
      },
    },
    device: {
      oauth2SecurityScheme: {
        description: 'OAuth 2.0 device authorization, for agents without a browser.',
        oauth2MetadataUrl: `${publicUrl}/.well-known/oauth-authorization-server`,
        flows: {
          deviceCode: {
            deviceAuthorizationUrl: `${publicUrl}/oauth/device_authorization`,
            tokenUrl: `${publicUrl}/oauth/token`,
            scopes: SCOPES,
          },
        },
      },
    },
  },
  securityRequirements: [
    { schemes: { bearer: { list: [] } } },
    { schemes: { oauth: { list: ['notes'] } } },
    { schemes: { device: { list: ['notes'] } } },
  ],
})

const SCOPES = { notes: 'Read notes and draft notes for the member. Never send them.' }
