import { describe, expect, it } from 'vitest'
import { parseConfiguredClients } from '../src/auth/configured-clients.ts'

const problemsOf = (value: string): ReadonlyArray<string> => {
  const parsed = parseConfiguredClients(value)
  return parsed._tag === 'Err' ? parsed.error : []
}

describe('pre-registered OAuth clients', () => {
  it('reads nothing when the variable is unset or blank', () => {
    expect(parseConfiguredClients(undefined)).toMatchObject({ _tag: 'Ok', value: [] })
    expect(parseConfiguredClients(' , ')).toMatchObject({ _tag: 'Ok', value: [] })
  })

  it('reads clients separated by commas, with redirect URIs separated by semicolons', () => {
    expect(
      parseConfiguredClients(
        ' tool | Team Tool | https://tool.example/cb ; http://127.0.0.1/cb ,other.agent|Other agent|cursor://x/cb',
      ),
    ).toMatchObject({
      _tag: 'Ok',
      value: [
        {
          client_id: 'tool',
          client_name: 'Team Tool',
          redirect_uris: ['https://tool.example/cb', 'http://127.0.0.1/cb'],
        },
        { client_id: 'other.agent', client_name: 'Other agent', redirect_uris: ['cursor://x/cb'] },
      ],
    })
  })

  it('names each problem on its own line, with the position and id of the client', () => {
    expect(problemsOf('tool|Tool')).toEqual([
      'HB_OAUTH_CLIENTS: client 1 ("tool") must be written as id|Name|redirect;redirect',
      'HB_OAUTH_CLIENTS: client 1 ("tool") needs 1 to 10 redirect URIs separated by ";"',
    ])
  })

  it.each([
    ['bad id!|Tool|https://tool.example/cb', 'client 1 needs an id of letters'],
    ['|Tool|https://tool.example/cb', 'client 1 needs an id of letters'],
    ['client_x|Tool|https://tool.example/cb', 'may not start with "client_"'],
    ['tool||https://tool.example/cb', 'needs a name of 1 to 200 characters'],
    [`tool|${'n'.repeat(201)}|https://tool.example/cb`, 'needs a name of 1 to 200 characters'],
    ['tool|Tool|', 'needs 1 to 10 redirect URIs'],
    [`tool|Tool|${Array.from({ length: 11 }, (_, i) => `https://t.example/${i}`).join(';')}`, '1 to 10'],
    ['tool|Tool|http://tool.example/cb', 'has redirect URI "http://tool.example/cb"'],
    ['tool|Tool|https://tool.example/cb#x', 'without a fragment'],
    ['tool|Tool|javascript:alert(1)', 'has redirect URI "javascript:alert(1)"'],
    ['tool|Tool|https://a.example/cb|extra', 'must be written as id|Name|redirect;redirect'],
    ['tool|A|https://a.example/cb,tool|B|https://b.example/cb', 'client id "tool" is listed more than once'],
  ])('refuses %s', (value, problem) => {
    const problems = problemsOf(value)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain(problem)
  })

  it('reports problems of several clients together', () => {
    expect(problemsOf('a||https://a.example/cb, b|B|')).toHaveLength(2)
  })
})
