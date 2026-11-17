import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

const CHECKED_PACKAGES = ['protocol', 'dovecote', 'client']

const ADAPTER_FILES = [
  'packages/kernel/src/clock.ts',
  'packages/dovecote/src/random.ts',
  'packages/dovecote/src/runtime.ts',
  'packages/dovecote/src/main.ts',
  'packages/dovecote/src/http/node-server.ts',
  'packages/dovecote/src/sql/sqlite.ts',
  'packages/dovecote/src/sql/postgres.ts',
  'packages/dovecote/src/sql/mysql.ts',
  'scripts/load-test.ts',
]

const ENTRY_FILES = /(^|\/)(index|main|bin)\.ts$|\/bin\//

const PACKAGES_WITH_CLASSES = ['kernel']

const MAX_COMMENT_RATIO = 0.08
const COMMENT_LINES_ALWAYS_ALLOWED = 4

const HISTORY_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bused to\b/i, '"used to"'],
  [/\bchanged from\b/i, '"changed from"'],
  [/\bpreviously\b/i, '"previously"'],
  [/\blegacy\b/i, '"legacy"'],
  [/\bfix(ed|es)? for\b/i, '"fix for"'],
  [/\badded for\b/i, '"added for"'],
  [/\bno longer\b/i, '"no longer"'],
  [/#\d+\b/, 'an issue number'],
  [/\b(19|20)\d{2}-\d{2}-\d{2}\b/, 'a date'],
  [/\bTODO\b(?!.*docs\/roadmap\.md)/, 'a TODO without a docs/roadmap.md reference'],
]

const BANNED_GLOBAL_CALLS: ReadonlyArray<readonly [string, string]> = [
  ['Date.now', 'use the clock service'],
  ['Math.random', 'use the random service'],
  ['setTimeout', 'use Task.sleep'],
  ['setInterval', 'use Task.forever or Stream.interval'],
  ['fetch', 'use the injected fetch'],
]

export interface Violation {
  readonly file: string
  readonly line: number
  readonly message: string
}

export const checkSource = (file: string, text: string): Violation[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const at = (position: number, message: string): Violation => ({
    file,
    line: source.getLineAndCharacterOfPosition(position).line + 1,
    message,
  })
  const comments = commentsOf(source, text)
  return [
    ...leadWithAnExport(file, source, at),
    ...comments.flatMap((comment) => historyIn(comment, at)),
    ...commentDensity(text, comments, at),
    ...(isAdapter(file) ? [] : bannedCalls(source, at)),
    ...(mayDeclareClasses(file) ? [] : classesIn(source, at)),
  ]
}

const repositoryRoot = join(import.meta.dirname, '..')

const sourceFilesOf = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesOf(path)
    return path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : []
  })

const leadWithAnExport = (
  file: string,
  source: ts.SourceFile,
  at: (position: number, message: string) => Violation,
): Violation[] => {
  if (ENTRY_FILES.test(file)) return []
  const first = source.statements.find((statement) => !ts.isImportDeclaration(statement))
  if (first === undefined || isExported(first)) return []
  return [at(first.getStart(source), 'the first declaration after the imports must be an export')]
}

const isExported = (statement: ts.Statement): boolean =>
  ts.isExportDeclaration(statement) ||
  ts.isExportAssignment(statement) ||
  (ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))

interface Comment {
  readonly position: number
  readonly text: string
}

const commentsOf = (source: ts.SourceFile, text: string): Comment[] => {
  const seen = new Map<number, Comment>()
  const collect = (node: ts.Node): void => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? []),
    ])
      seen.set(range.pos, { position: range.pos, text: text.slice(range.pos, range.end) })
    node.forEachChild(collect)
  }
  collect(source)
  return [...seen.values()]
}

const historyIn = (comment: Comment, at: (position: number, message: string) => Violation): Violation[] =>
  HISTORY_MARKERS.filter(([pattern]) => pattern.test(comment.text)).map(([, what]) =>
    at(comment.position, `comment contains ${what}; history belongs in the commit message`),
  )

const commentDensity = (
  text: string,
  comments: ReadonlyArray<Comment>,
  at: (position: number, message: string) => Violation,
): Violation[] => {
  const explanatory = comments.filter((comment) => !/biome-ignore|@ts-expect-error/.test(comment.text))
  const commentLines = explanatory.reduce((total, comment) => total + comment.text.split('\n').length, 0)
  const codeLines = text.split('\n').filter((line) => line.trim() !== '').length - commentLines
  if (commentLines <= COMMENT_LINES_ALWAYS_ALLOWED || commentLines <= codeLines * MAX_COMMENT_RATIO) return []
  return [
    at(
      explanatory[0]!.position,
      `${commentLines} comment lines for ${codeLines} lines of code; let names carry the meaning`,
    ),
  ]
}

const bannedCalls = (
  source: ts.SourceFile,
  at: (position: number, message: string) => Violation,
): Violation[] => {
  const found: Violation[] = []
  const visit = (node: ts.Node, locals: ReadonlySet<string>): void => {
    const scope = ts.isFunctionLike(node) || ts.isSourceFile(node) ? withDeclarations(node, locals) : locals
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source)
      const banned = BANNED_GLOBAL_CALLS.find(([name]) => name === callee)
      if (banned !== undefined && !scope.has(callee.split('.')[0]!))
        found.push(at(node.getStart(source), `${banned[0]}() is not allowed here; ${banned[1]}`))
    }
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(source) === 'Date' &&
      (node.arguments?.length ?? 0) === 0
    )
      found.push(at(node.getStart(source), 'new Date() reads the wall clock; use the clock service'))
    node.forEachChild((child) => visit(child, scope))
  }
  visit(source, new Set())
  return found
}

const withDeclarations = (scopeNode: ts.Node, outer: ReadonlySet<string>): ReadonlySet<string> => {
  const names = new Set(outer)
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text)
    else for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name)
  }
  if (ts.isFunctionLike(scopeNode)) for (const parameter of scopeNode.parameters) bind(parameter.name)
  const collect = (node: ts.Node): void => {
    if (node !== scopeNode && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node)) bind(node.name)
    if (ts.isImportSpecifier(node) || ts.isImportClause(node)) if (node.name) names.add(node.name.text)
    node.forEachChild(collect)
  }
  collect(scopeNode)
  return names
}

const classesIn = (
  source: ts.SourceFile,
  at: (position: number, message: string) => Violation,
): Violation[] => {
  const found: Violation[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node))
      found.push(
        at(node.getStart(source), 'classes are only allowed in the kernel; use plain data and functions'),
      )
    node.forEachChild(visit)
  }
  visit(source)
  return found
}

const isAdapter = (file: string): boolean => ADAPTER_FILES.includes(file) || /\/bin\//.test(file)

const mayDeclareClasses = (file: string): boolean =>
  PACKAGES_WITH_CLASSES.some((name) => file.startsWith(`packages/${name}/`))

const isRunDirectly = process.argv[1] !== undefined && import.meta.filename === process.argv[1]

if (isRunDirectly) {
  const requested = process.argv.slice(2)
  const files =
    requested.length > 0
      ? requested.filter((file) => CHECKED_PACKAGES.some((name) => file.includes(`packages/${name}/src/`)))
      : CHECKED_PACKAGES.flatMap((name) => sourceFilesOf(join(repositoryRoot, 'packages', name, 'src')))
  const violations = files.flatMap((path) => {
    const file = relative(repositoryRoot, join(process.cwd(), relative(process.cwd(), path)))
      .split(sep)
      .join('/')
    return checkSource(file, readFileSync(path, 'utf8'))
  })
  for (const violation of violations)
    process.stdout.write(`${violation.file}:${violation.line}  ${violation.message}\n`)
  if (violations.length > 0) {
    process.stdout.write(`\n${violations.length} style violation(s). See .claude/rules/code-style.md\n`)
    process.exit(1)
  }
}
