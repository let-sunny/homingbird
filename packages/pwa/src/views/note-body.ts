import { type Child, h, noteText } from '@homingbird/ui'
import type { CitedText } from '../models/debate-result.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'
import { button } from './parts.ts'

/** A note's text as people read it: links, inline code, and code blocks that each copy on a click. */
export const noteBody = (context: ViewContext, text: string, className = 'note-body'): HTMLElement =>
  h('div', { class: className }, codeText(context, text))

/** A debate turn's text: the same as a note's, with each cited turn a link to it. */
export const citedBody = (context: ViewContext, parts: CitedText, className: string): HTMLElement =>
  h(
    'div',
    { class: className },
    parts.map((part) =>
      part.kind === 'turn'
        ? h('a', { class: 'turn-cite', href: part.href }, part.text)
        : codeText(context, part.text),
    ),
  )

const codeText = (context: ViewContext, text: string): Child[] =>
  noteText(text, (code) => button(strings.copyCode, () => copyCode(context, code), { class: 'copy-code' }))

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
