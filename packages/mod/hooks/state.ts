import { atom } from 'claude-code'

export const overview = atom({ plugin: 'homingbird', key: 'overview' } as const, null, {
  shape: 'overview-2',
})
export const requests = atom({ plugin: 'homingbird', key: 'requests' } as const, [], { shape: 'requests-1' })
export const connection = atom({ plugin: 'homingbird', key: 'connection' } as const, 'idle')
export const desk = atom({ plugin: 'homingbird', key: 'desk' } as const, 'not-desk')
export const signIn = atom({ plugin: 'homingbird', key: 'signIn' } as const, null)
export const editing = atom({ plugin: 'homingbird', key: 'editing' } as const, null)
export const problem = atom({ plugin: 'homingbird', key: 'problem' } as const, null)
