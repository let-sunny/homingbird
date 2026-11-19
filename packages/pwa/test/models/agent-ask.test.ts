import { describe, expect, it } from 'vitest'
import { agentChoices, chosenAgent } from '../../src/models/agent-ask.ts'
import { strings } from '../../src/strings.ts'
import { credential } from '../support/fixtures.ts'

describe('the agent to ask', () => {
  it('is chosen only when the person has more than one, any of them first', () => {
    expect(agentChoices([])).toBeNull()
    expect(agentChoices([credential('cred_one')])).toBeNull()
    expect(agentChoices([credential('cred_one'), credential('cred_two')])).toEqual([
      { value: '', label: strings.anyAgent },
      { value: 'cred_one', label: 'cred_one' },
      { value: 'cred_two', label: 'cred_two' },
    ])
  })

  it('is any agent for the empty choice', () => {
    expect(chosenAgent('')).toBeNull()
    expect(chosenAgent('cred_one')).toBe('cred_one')
  })
})
