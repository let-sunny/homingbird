import { type Lifetime, type ReadableSignal, isSameData, signal } from '@homingbird/ui'
import type { ViewContext } from './context.ts'

/**
 * Follows what a region draws from, except while a character is being composed inside it, as in typing
 * Korean: drawing the field again would end the composition. `watch` is given the region's element.
 */
export const unlessComposing = <A>(
  context: Pick<ViewContext, 'page'>,
  life: Lifetime,
  source: ReadableSignal<A>,
): { readonly drawn: ReadableSignal<A>; readonly watch: (host: HTMLElement) => HTMLElement } => {
  const drawn = signal(source.get())
  let field: Element | null = null
  const follow = (): void => {
    if (field?.isConnected === true) return
    const now = source.get()
    if (!isSameData(now, drawn.get())) drawn.set(now)
  }
  life.add(source.subscribe(follow))
  return {
    drawn,
    watch: (host) => {
      host.addEventListener('compositionstart', (event) => {
        field = event.target as Element
      })
      host.addEventListener('compositionend', () => {
        field = null
        context.page.nextFrame(follow)
      })
      return host
    },
  }
}
