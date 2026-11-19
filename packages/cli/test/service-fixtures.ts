import type { ServicePlace, ServiceSpec } from '../src/service-definition.ts'

export const SPEC: ServiceSpec = {
  server: 'https://hb.example.com',
  agent: 'claude',
  timeoutSeconds: null,
  split: false,
  reader: null,
  requireToollessReader: false,
  workdir: '/home/june',
  program: ['/usr/bin/node', '/usr/lib/node_modules/@homingbird/cli/dist/homingbird.js'],
  path: '/home/june/.local/bin:/usr/local/bin:/usr/bin:/bin',
}

export const SPLIT_SPEC: ServiceSpec = {
  ...SPEC,
  agent: 'claude -p --model "opus 5" 100%',
  timeoutSeconds: 120,
  split: true,
  reader: "claude -p --tools '' --strict-mcp-config",
  requireToollessReader: true,
  workdir: '/home/june/work notes',
}

export const PLACE: ServicePlace = {
  homeDirectory: '/home/june',
  configDirectory: '/home/june/.config/homingbird',
  systemdDirectory: '/home/june/.config/systemd/user',
  userId: 501,
  windowsUser: null,
}

export const MAC_PLACE: ServicePlace = {
  ...PLACE,
  homeDirectory: '/Users/june',
  configDirectory: '/Users/june/.config/homingbird',
}

export const WINDOWS_PLACE: ServicePlace = {
  homeDirectory: 'C:\\Users\\june',
  configDirectory: 'C:\\Users\\june/.config/homingbird',
  systemdDirectory: '',
  userId: null,
  windowsUser: 'EXAMPLE\\june',
}

export const WINDOWS_SPEC: ServiceSpec = {
  ...SPEC,
  workdir: 'C:\\Users\\june',
  program: [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Users\\june\\AppData\\Roaming\\npm\\node_modules\\@homingbird\\cli\\dist\\homingbird.js',
  ],
  path: null,
}

export const unescapeXml = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
