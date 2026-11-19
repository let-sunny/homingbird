import { describe, expect, it } from 'vitest'
import {
  SMOKE_AGENT_SOURCE,
  leftoverRunners,
  logPathIn,
  processListing,
  serviceStateIn,
  sessionCookieIn,
  smokeAgentCommand,
} from '../service-smoke.ts'

describe('the service smoke test', () => {
  it('finds the session cookie in a Set-Cookie header, and nothing when there is none', () => {
    expect(sessionCookieIn('hb_session=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=60')).toBe(
      'hb_session=abc123',
    )
    expect(sessionCookieIn('other=1; Path=/, hb_session=xyz; Path=/')).toBe('hb_session=xyz')
    expect(sessionCookieIn('hb_session=; Max-Age=0')).toBeNull()
    expect(sessionCookieIn(null)).toBeNull()
  })

  it('lists processes with PowerShell on Windows and with ps elsewhere', () => {
    expect(processListing('win32')[0]).toBe('powershell')
    expect(processListing('darwin')).toEqual(['ps', ['-axww', '-o', 'pid=,command=']])
  })

  it('counts as leftover only a background runner for the server it tested, quoted or not', () => {
    const server = 'http://localhost:8191'
    const listing = [
      `  412 /usr/local/bin/node /x/homingbird.js run --service --server ${server} --agent node a.mjs`,
      '  413 /usr/local/bin/node /x/homingbird.js run --service --server http://localhost:9999 --agent x',
      `  414 /usr/local/bin/node /x/homingbird.js service status --server ${server}`,
      `\r\n415 "C:\\node.exe" "C:\\x\\homingbird.js" "run" "--service" "--server" "${server}"`,
    ].join('\n')
    expect(leftoverRunners(listing, server)).toEqual([
      `412 /usr/local/bin/node /x/homingbird.js run --service --server ${server} --agent node a.mjs`,
      `415 "C:\\node.exe" "C:\\x\\homingbird.js" "run" "--service" "--server" "${server}"`,
    ])
  })

  it('reads the service status tolerantly, as not installed and not running when it cannot', () => {
    expect(serviceStateIn('{"installed":true,"running":true,"loaded":true}\n')).toEqual({
      installed: true,
      running: true,
    })
    expect(serviceStateIn('{"installed":true,"running":false}')).toEqual({ installed: true, running: false })
    expect(serviceStateIn('Not JSON')).toEqual({ installed: false, running: false })
    expect(serviceStateIn('null')).toEqual({ installed: false, running: false })
  })

  it('reads where the service log is from the status, and nothing when the status does not say', () => {
    expect(logPathIn('{"log":"/Users/ana/.config/homingbird/logs/runner-x.log"}')).toBe(
      '/Users/ana/.config/homingbird/logs/runner-x.log',
    )
    expect(logPathIn('{"log":""}')).toBeNull()
    expect(logPathIn('Say which server with --server <url>.')).toBeNull()
  })

  it('gives the service an agent command without quotes or percent signs, which a Run key cannot hold', () => {
    const command = smokeAgentCommand('C:\\Temp\\smoke\\agent.mjs', 'C:\\Temp\\smoke\\agent.pid')
    expect(command).toBe('node C:\\Temp\\smoke\\agent.mjs C:\\Temp\\smoke\\agent.pid')
    expect(command).not.toMatch(/["%]/)
  })

  it('has an agent that records its process id only after reading the whole prompt, then keeps running', () => {
    expect(SMOKE_AGENT_SOURCE).toContain("process.stdin.on('end'")
    expect(SMOKE_AGENT_SOURCE).toContain('String(process.pid)')
    expect(SMOKE_AGENT_SOURCE).toContain('setInterval')
  })
})
