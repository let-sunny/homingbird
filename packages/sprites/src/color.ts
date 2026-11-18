/** WCAG contrast ratio between two `#RRGGBB` colors, from 1 to 21. */
export const contrast = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

export const luminance = (hex: string): number => {
  const [r, g, b] = rgbOf(hex).map(linear) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Straight-line distance between two colors in RGB space, from 0 to about 441. */
export const distance = (a: string, b: string): number => {
  const [r1, g1, b1] = rgbOf(a)
  const [r2, g2, b2] = rgbOf(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

export const hsl = (hue: number, saturation: number, lightness: number): string => {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = s * Math.min(l, 1 - l)
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12
    return l - chroma * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
  }
  return `#${[channel(0), channel(8), channel(4)]
    .map((value) =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`
}

export const rgbOf = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

const linear = (channel: number): number => {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}
