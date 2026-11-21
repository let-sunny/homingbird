import { h, noteText } from '@homingbird/ui'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { button } from './parts.ts'

/** A note's text as people read it: links, inline code, and code blocks that each copy on a click. */
export const noteBody = (context: ViewContext, text: string, className = 'note-body'): HTMLElement =>
  h(
    'div',
    { class: className },
    noteText(text, (code) => button(strings.copyCode, () => copyCode(context, code), { class: 'copy-code' })),
  )

const copyCode = (context: ViewContext, code: string): void => {
  void context.page
    .copyText(code)
    .then((isCopied) =>
      context.state.notice.set(
        isCopied
          ? { kind: 'info', text: strings.codeCopied }
          : { kind: 'error', text: strings.noteNotCopied },
      ),
    )
}
