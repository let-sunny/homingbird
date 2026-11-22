import { Schema as S } from '@homingbird/kernel'
import { AUDIT_EVENT_NAMES, AUDIT_TARGET_ID_MAX, AuditOutcome, CredentialKind } from '@homingbird/protocol'
import type { OperationalLevel } from './log-settings.ts'

/**
 * Every line Dovecote may write, with its level, a fixed sentence and typed attributes. There is no
 * free-form message, so a line cannot carry a token, a note or an email address by accident.
 */
export const OPERATIONAL_EVENTS = {
  'system.started': line('info', 'Dovecote is starting.', {
    version: S.string({ maxLength: 40 }),
    port: S.int({ min: 0 }),
  }),
  'system.development_login': line(
    'warn',
    'HB_DEV_LOGIN=1: anyone who can reach this server can sign in as anyone. Never use it in production.',
    { anyAddress: S.boolean, firstMemberBecomesAdministrator: S.boolean },
  ),
  'system.audit_off': line('warn', 'The audit trail is off (HB_LOGS audit=off): nothing is recorded.', {}),
  'system.debug_on': line(
    'warn',
    'Debug lines can contain redacted request detail; do not use operational=debug in production.',
    {},
  ),
  'system.ignored_variable': line('warn', 'A variable this version does not read is set; remove it.', {
    variable: S.literal('HB_AUDIT_WEBHOOK_URL'),
  }),
  'system.audit_retention_raised': line(
    'warn',
    'HB_AUDIT_RETENTION_DAYS is below the minimum, so audit rows are kept for the minimum instead.',
    { requested: S.int({ min: 1 }), days: S.int({ min: 1 }) },
  ),
  'system.audit_retention_shorter': line(
    'warn',
    'Audit rows are kept for fewer days than an administrator saved; housekeeping removes older rows.',
    { saved: S.union(S.int({ min: 1 }), S.literal('forever')), days: S.int({ min: 1 }) },
  ),
  'system.stopped': line('error', 'Dovecote stopped unexpectedly. Restart it.', { defect: defectName() }),
  'background.stopped': line(
    'error',
    'Background work stopped unexpectedly, so no background pass runs any more. Restart Dovecote.',
    { defect: defectName() },
  ),
  'background.shutdown': line('info', 'Background work stopped for shutdown.', {}),
  'background.pass_failed': line('error', 'A background pass failed; the next one runs as planned.', {
    pass: S.string({ pattern: /^[a-z0-9 _]{1,80}$/ }),
    defect: defectName(),
  }),
  'http.request': line('info', 'A request was answered.', {
    route: S.string({ pattern: /^[A-Za-z0-9.]{1,60}$/ }),
    method: S.string({ pattern: /^[A-Z]{1,10}$/ }),
    status: S.int({ min: 100, max: 599 }),
    durationMs: S.int({ min: 0 }),
  }),
  'http.request_failed': line('error', 'A request failed with a defect.', {
    route: S.string({ pattern: /^[A-Za-z0-9.]{1,60}$/ }),
    method: S.string({ pattern: /^[A-Z]{1,10}$/ }),
    defect: defectName(),
  }),
  'defect.detail': line('debug', 'The detail of a defect, redacted.', {
    defect: defectName(),
    detail: S.string({ maxLength: 4000 }),
  }),
  'push.delivered': line('info', 'A push service answered a notification.', {
    memberId: S.string({ maxLength: 64 }),
    endpointHost: S.string({ maxLength: 253 }),
    status: S.int({ min: 0 }),
    removed: S.boolean,
  }),
  'desk_wake.fired': line('info', 'A cloud desk was woken.', {
    memberId: S.string({ maxLength: 64 }),
    host: S.string({ maxLength: 253 }),
    status: S.int({ min: 0 }),
    timedOut: S.boolean,
    outcome: S.literal('sent', 'refused', 'rate_limited', 'unreachable'),
    reason: S.literal('work', 'debate', 'test'),
  }),
  'desk_wake.unanswered': line('warn', 'A woken cloud desk did not come online within ten minutes.', {
    memberId: S.string({ maxLength: 64 }),
    host: S.string({ maxLength: 253 }),
  }),
  'slack.event_refused': line('warn', 'A request to the Slack events address was refused.', {
    reason: S.literal('signature_missing', 'signature_stale', 'signature_mismatch', 'malformed'),
  }),
  'slack.event_received': line('debug', 'Slack sent an event.', {
    kind: S.string({ maxLength: 40 }),
    kept: S.boolean,
  }),
  'slack.event_dropped': line(
    'warn',
    'A signed Slack event was dropped: no workspace is connected, or it came from another one.',
    {
      kind: S.string({ maxLength: 40 }),
      reason: S.literal('not_connected', 'other_workspace', 'no_event_id'),
    },
  ),
  'slack.call_failed': line('warn', 'A call to Slack failed.', {
    method: S.string({ maxLength: 40 }),
    failure: S.literal('SlackUnreachable', 'SlackRateLimited', 'SlackRefused'),
    error: S.string({ maxLength: 60 }),
  }),
  'slack.review_request_sent': line('info', 'A person was told in Slack that a draft waits for them.', {
    memberId: S.string({ maxLength: 64 }),
  }),
  'slack.not_posted_told': line('info', 'A person was told in Slack that a reply was not posted there.', {
    memberId: S.string({ maxLength: 64 }),
  }),
  'oauth.client_metadata_refused': line('warn', 'A client metadata document was refused.', {
    reason: S.string({ maxLength: 200 }),
  }),
  'authn.refused_burst': line(
    'warn',
    'Requests from one address were refused for a missing, expired or revoked credential.',
    {
      clientAddress: S.string({ maxLength: 64 }),
      count: S.int({ min: 1 }),
    },
  ),
  'audit.invalid_detail': line(
    'warn',
    'An audit detail did not match its schema; the row was kept without it.',
    {
      event: S.literal(...AUDIT_EVENT_NAMES),
    },
  ),
  'analytics.dropped': line('warn', 'Product analytics were dropped because the forwarding queue is full.', {
    count: S.int({ min: 1 }),
  }),
  'sign_in.provider_failed': line('warn', 'The identity provider could not be reached or refused.', {}),
  'audit.chain_head': line('info', 'The head of the audit chain, to anchor it outside the database.', {
    id: S.int({ min: 0 }),
    hash: S.string({ pattern: /^[0-9a-f]{64}$/ }),
  }),
  'audit.copy': line('info', 'An audit event, copied from the audit trail without its detail.', {
    event: S.literal(...AUDIT_EVENT_NAMES),
    outcome: AuditOutcome,
    actorId: S.nullable(S.string({ maxLength: 64 })),
    credentialId: S.nullable(S.string({ maxLength: 64 })),
    credentialKind: S.nullable(CredentialKind),
    targetKind: S.string({ maxLength: 40 }),
    targetId: S.nullable(S.string({ maxLength: AUDIT_TARGET_ID_MAX })),
  }),
  'analytics.forward_failed': line(
    'warn',
    'Product analytics could not be forwarded; the events were dropped.',
    {
      destination: S.literal('posthog', 'ga4', 'http'),
      status: S.int({ min: 0 }),
    },
  ),
} as const

export type OperationalEventName = keyof typeof OPERATIONAL_EVENTS

export type OperationalEvent = {
  readonly [N in OperationalEventName]: {
    readonly name: N
    readonly attributes: S.Infer<(typeof OPERATIONAL_EVENTS)[N]['attributes']>
  }
}[OperationalEventName]

function line<const L extends OperationalLevel, const F extends S.Fields>(level: L, body: string, fields: F) {
  return { level, body, attributes: S.struct(fields) }
}

function defectName() {
  return S.string({ maxLength: 60 })
}
