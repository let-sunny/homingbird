import type { Locale } from '@homingbird/protocol'
import { en } from '../languages/inspector/en.ts'
import { ko } from '../languages/inspector/ko.ts'
import { type Compiled, type Translation, compile } from '../messages.ts'

/** The panel's words, kept apart from the client's own so that a page without the panel never downloads them. */
export const inspectorWords = (locale: Locale): InspectorWords =>
  compile<typeof en>(locale, INSPECTOR_LANGUAGES[locale])

export type InspectorWords = Compiled<typeof en>

const INSPECTOR_LANGUAGES: Readonly<Record<Locale, Translation<typeof en>>> = { en, ko }
