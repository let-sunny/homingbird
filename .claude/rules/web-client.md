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
- All text shown to people is English and lives in `strings.ts`.
- Note bodies are rendered as text. Only `http:` and `https:` URLs become links, with
  `rel="noopener noreferrer"`. Never assign note content to `innerHTML`.
