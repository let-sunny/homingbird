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
  (opened with `https:`) and plain mail addresses (opened with `mailto:`) become links, all with
  `rel="noopener noreferrer"`. Never assign note content to `innerHTML`.

## Hierarchy

Every screen leads with one thing. The brand look stays (pixel art, hard shadows, brand colours); what
changes is how loudly each part speaks. `test/stylesheets.test.ts` checks the first four.

- **One focus.** Each screen decides its first thing: the waiting draft, the result, whose turn it is,
  the time to pick. Only that and buttons cast a hard shadow (`--hb-shadow`, `--hb-shadow-raised`
  for floating layers). Repeated rows and cards (people, turns, notes, characters) lie flat, divided
  by `--hb-border-divider`.
- **One primary action, and orange means action.** `--hb-color-action` paints only `primary` buttons,
  one per screen, never one per row. Where you are is `--hb-color-current` (`--hb-shadow-current*`),
  what is chosen is `--hb-shadow-selected`, and every count is the one badge, `.count`
  (`--hb-color-badge`); a glyph, not a colour, tells a draft from an unread note.
- **Five sizes with a meaning.** `--hb-text-meta` (times, counts, explanations), `-body`, `-lead` (the
  words a person decides on: a draft, a conclusion, whose turn it is), `-heading` (h2) and `-page` (h1).
  Labels are `--hb-text-label` in `--hb-weight-label`, in the text colour, in sentence case. Weights are
  `--hb-weight-body`, `-label` and `-heading` only.
- **No capitals, no monospace for labels.** Monospace is for code and commands a person copies.
- **Space groups.** `--hb-gap-item` between items, `--hb-gap-group` between groups,
  `--hb-gap-section` (or a divider with `--hb-space-6`) before a section heading; the space above a
  heading is at least three times the space below it.
- **One border layer, each title once.** No 2px border inside a bordered container: use
  `--hb-color-sunken` or a divider. A heading that repeats its tab stays for assistive technology only.
  Rules and long help go into one `--hb-text-meta` line or a closed `<details>`.
