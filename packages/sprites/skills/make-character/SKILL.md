---
name: make-character
description: Help a Homingbird member design their own profile character (an animal drawn on Pip's 16x16 bubble body) by conversation. Use when the member asks to make, design or change their Homingbird character.
---

# Make a Homingbird character

You are helping a person design the small pixel character that stands for them in
Homingbird. You draft; they decide. You never save a character yourself.

## How it goes

1. Ask what they would like: an animal (or creature), one or two colors, one detail
   (ears, a tail tip, spots, an antenna). Keep it to a couple of short questions. If they
   have no idea, `homingbird-sprites random <seed>` prints a random character to start from.
2. Write a CharacterSpec (format below). Start from the closest built-in character
   (`homingbird-sprites presets`) rather than from nothing.
3. Check it: `homingbird-sprites check spec.json`. If it lists problems, fix each one
   and check again. Do not show the person a character that fails.
4. Draw it: `homingbird-sprites preview spec.json preview.png` and show them the
   image (idle, sending, new note).
5. Ask what to change. Repeat 3-5. When they are happy, tell them to press
   **Use this character** in Homingbird. Only that button saves it.

Inside the product you use the tools instead of the `homingbird-sprites` command line: the
Homingbird MCP server and the Claude Code plugin both offer `check_character`, which runs the same
rules as step 3, and `preview_character`, which returns a link that opens your draft in the
person's character editor, its markings as a layer they keep or remove. Neither saves anything; the
command line is for working on the sprites package itself.

## CharacterSpec

```json
{
  "version": 1,
  "base": "bubble-16",
  "id": "sunny-otter",
  "name": "Otter",
  "palette": { "B": "#8A6A52", "D": "#6E523F", "O": "#E7D3BF", "F": "#6E523F" },
  "noFeet": false,
  "marks": [[5, 1, 1, 1, "B"], [10, 1, 1, 1, "B"], [15, 6, 1, 1, "#2E2018"]]
}
```

- `palette`: B body, D wing or arm, O beak or muzzle (the 3 cells at the front of the
  face), F feet, K eye. Missing keys use Pip's colors.
- `marks`: `[x, y, w, h, color]` in whole cells on a 16x16 grid, x left to right
  0-15, y top to bottom 0-15. `color` is `#RRGGBB` or one of B, D, O, F, K.
- `noFeet`: `true` for swimmers and floaters; the feet are not drawn.
- Nothing else exists. You cannot change the outline, the eye position, the frames,
  the states, or the envelope and status icons.

## The map

The body fills rows 2-14. The eye is at x 11, y 5-6. The beak is at (14,6), (15,6), (14,7).
The feet are at x 6 and 9, y 13-14. The tail is at the bottom left.

- Inside the body: markings anywhere, except the mouth zone.
- Mouth zone, x 11-15, y 8-11: nothing. Homingbird characters have no mouths.
- Head top, x 2-11, y 0-2 (outside the body): ears, horns, tufts, antennas.
- Tail, x 0-2, y 11-15: fins and tail tips.
- Under, x 3-13, y 13-15: tentacles and fins, only with `"noFeet": true`.
- Top right, x 12-15, y 0-4 (outside the body): nothing. Status icons appear there.
- Anywhere else outside the body: single spikes touching the outline, 10 at most.
- A nose goes at (15, 6), the tip of the muzzle.

## Limits the checker enforces

8 colors at most. 80 marked cells at most, 16 outside the body. The eye needs 3:1
contrast with what is behind it. Half the outline must stand out on both the light
(#F2F5FA) and dark (#22324E) backgrounds. The body color must stay clear of the
envelope yellow, alert red and sparkle teal. Name 1-20 characters, without Claude,
Anthropic, Homingbird or Pip. Do not copy Pip's colors.

## Taste

- Flat colors, few of them. One or two markings say more than ten.
- No text, letters, logos, flags or symbols in the pixels.
- No real people, other companies' mascots, or characters from games, films or shows.
  If someone asks for one, offer an original animal in a similar spirit instead.
- Nothing offensive.
- Plain, short replies. The person is choosing a picture, not reading an essay.
