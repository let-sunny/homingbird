# Brand

**Pip** is Homingbird's mascot and mark: a 16×16 pixel pigeon shaped like a speech bubble, with a
slate-blue body, a tall black eye, and an orange beak and feet. When a note is on its way, Pip carries
a yellow envelope.

## Assets

| Path | Contents |
| --- | --- |
| `assets/brand/homingbird-mark.svg`, `-mark-{64,128,256,512}.png` | Pip alone, on a transparent ground |
| `assets/brand/homingbird-icon.svg`, `-icon-{180,192,512,1024}.png` | Pip on a Night tile, for app icons |
| `assets/brand/favicon.ico`, `favicon-{16,32,48}.png` | Favicons |
| `assets/pip/pip-<state>.gif` | One animation per state |
| `assets/pip/pip-sheet@1x.png`, `pip-sheet@8x.png`, `pip-sheet.json` | Sprite sheet and frame map |
| `assets/fonts/` | Inter and Bricolage Grotesque, Open Font License |

`pip-sheet.json` lists 22 states with what each is for. Use the ones your UI needs.

## Logo

Pip followed by lowercase `homingbird` in Bricolage Grotesque ExtraBold with `-0.02em` letter
spacing. Interface text is set in Inter.

## Colour

| Name | Value | Use |
| --- | --- | --- |
| Pip Blue | `#8DA4CB` | Pip's body, primary accents |
| Wing | `#6D86B0` | Pip's wing, pressed and hover states |
| Ink | `#1B2333` | Text, Pip's eye |
| Beak | `#F4A259` | Pip's beak and feet, calls to action |
| Night | `#22324E` | Icon tile, dark surfaces |
| Mist | `#F2F5FA` | Light surfaces |
| Envelope | `#FFD879` | Notes in flight, drafts waiting for approval |
| Sparkle | `#3FBFA6` | Success |
| Alert | `#F25F5C` | Errors, blocked |

## Rules

- Scale Pip by whole numbers only, with nearest-neighbour sampling: `image-rendering: pixelated`.
- Keep two pixels of clear space around the mark, at the mark's own scale.
- Minimum size: 16px for the mark, 96px wide for the full logo.
- Do not stretch, blur, recolour or rotate Pip.

An organization that restyles the web client through `theme.css` changes the interface tokens, not
Pip.
