import { lifetime } from '@homingbird/ui'
import { fire, getByRole, queryByRole } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { strings } from '../../src/strings.ts'
import { agentAsk } from '../../src/views/agent-ask.ts'
import { testContext } from '../support/context.ts'
import { usingFakeDom } from '../support/dom.ts'
import { ROOM, credential, serverInfo } from '../support/fixtures.ts'

usingFakeDom()

describe('agentAsk', () => {
  it('loads the agents when opened and asks the one chosen, with the instruction typed', () => {
    const { context, called } = testContext()
    const asked = vi.fn()
    const shown = agentAsk(context, lifetime(), () => ({ conversationId: ROOM }), asked)
    expect(queryByRole(shown, 'combobox')).toBeNull()
    context.state.agentCredentials.set([credential('cred_one'), credential('cred_two')])
    getByRole(shown, 'button', { name: strings.letAgentWrite }).click()
    expect(called('loadAgents')).toHaveLength(1)
    fire.select(getByRole(shown, 'combobox', { name: strings.agentPickerLabel }), 'cred_two')
    const instruction = getByRole(shown, 'textbox', { name: strings.agentInstructionLabel })
    fire.type(instruction, 'Say yes')
    fire.key(instruction, 'Enter', { isComposing: true })
    expect(called('askAgent')).toHaveLength(0)
    fire.key(instruction, 'a')
    fire.key(instruction, 'Enter')
    const [ask] = called('askAgent')
    expect(ask!.args).toEqual([
      { destination: { conversationId: ROOM }, instruction: 'Say yes', agentId: 'cred_two' },
    ])
    ask!.then!.done!({ id: 'dreq_1' })
    expect((instruction as HTMLInputElement).value).toBe('')
    expect(shown.open).toBe(false)
    expect(asked).toHaveBeenCalledWith({ id: 'dreq_1' })
  })

  it('asks any agent with the button, and is left out while requests are off', () => {
    const { context, called } = testContext()
    const shown = agentAsk(context, lifetime(), () => ({ channel: 'billing' }))
    shown.open = true
    getByRole(shown, 'button', { name: strings.askAgent }).click()
    expect(called('askAgent')[0]!.args[0]).toMatchObject({ agentId: null })
    called('askAgent')[0]!.then!.done!({})
    context.state.serverInfo.set(serverInfo())
    expect(agentAsk(context, lifetime(), () => ({ channel: 'billing' })).hidden).toBe(true)
  })
})
