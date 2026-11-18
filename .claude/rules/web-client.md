---
paths:
  - "packages/ui/**"
  - "packages/pwa/**"
---

# Web client

- No runtime dependencies. HTML, CSS and the DOM API only. Source is TypeScript; the build output is
  plain JavaScript.
- Responsive layout uses container queries (`@container`) only. No viewport media queries for layout;
  `@media` is allowed for user preferences (`prefers-reduced-motion`, `prefers-color-scheme`).
- Prefer the platform over script: `popover`, `<dialog>`, `command`/`commandfor`, `:has()`, anchor
  positioning, `@starting-style`, view transitions, scroll-driven animations. Script is for data.
- Newer features are progressive enhancement: the page must work without them. Guard with `@supports`.
- Every colour, font, radius, shadow and duration is a custom property declared in `tokens.css`.
  Components never hard-code one. An organization restyles the client by overriding tokens in its own
  `theme.css`; nothing else may be needed.
- Honour `prefers-reduced-motion`: animation is decoration, never information.
- English is the default and the fallback language. Text shown to people lives only in the language
  files under `src/languages/`, one file per language, registered in `src/languages.ts`; the type
  system fails `pnpm typecheck` when a language misses a key.
- Never concatenate translated fragments. Write whole sentences with named placeholders
  (`'Ask {topic}'`), let a language declare only the plural forms it needs, and format dates, numbers
  and lists with `Intl`.
- Note bodies are rendered as text. Only `http:` and `https:` URLs become links, with
  `rel="noopener noreferrer"`. Never assign note content to `innerHTML`.
