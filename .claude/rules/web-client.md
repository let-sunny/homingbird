---
paths:
  - "packages/ui/**"
  - "packages/pwa/**"
---

# Web client

- No runtime dependencies. HTML, CSS and the DOM API only. Source is TypeScript; the build output is
  plain JavaScript.
- Responsive layout uses container queries (`@container`) only. No viewport media queries for layout;
  `@media` is allowed for user preferences (`prefers-reduced-motion`, `prefers-color-scheme`) and input
  capabilities (`hover`, `pointer`).
- A view is two functions: a pure view model that turns state into plain data (what to show, in what
  order, with which words), and a render that only turns that data into DOM. A view receives its
  state, its actions and its clock as arguments; it never reads a global or calls the API itself.
  Every view model has a unit test; renders are tested against the fake DOM in
  `@homingbird/ui/testing`, and the end-to-end tests only check that the pages connect.
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
  (`'Ask {channel}'`), let a language declare only the plural forms it needs, and format dates, numbers
  and lists with `Intl`.
- Note bodies are rendered as text. Only `http:` and `https:` URLs, addresses that start with `www.`
  (opened with `https:`) and mail addresses (opened with `mailto:`) become links; web links get
  `rel="noopener noreferrer"`. Never assign note content to `innerHTML`.
