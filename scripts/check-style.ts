import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import ts from 'typescript'

const ENFORCED_PACKAGES = ['kernel', 'protocol', 'dovecote', 'client', 'a2a']

const ADAPTER_FILES = [
  'packages/kernel/src/clock.ts',
  'packages/dovecote/src/random.ts',
  'packages/dovecote/src/runtime.ts',
  'packages/dovecote/src/main.ts',
  'packages/dovecote/src/http/node-server.ts',
  'packages/dovecote/src/sql/sqlite.ts',
  'packages/dovecote/src/sql/postgres.ts',
  'packages/dovecote/src/sql/mysql.ts',
  'packages/cli/src/main.ts',
  'packages/cli/src/node-environment.ts',
  'packages/mcp/src/stdio.ts',
  'packages/pwa/src/main.ts',
  'packages/pwa/src/service-worker.ts',
]

const ENTRY_FILES = /(^|\/)(index|main|bin)\.ts$|\/bin\//

/** The programs that start with one top-level `await T.run(...)`; nothing else outside the kernel awaits. */
const PROGRAM_ENTRY_FILES = [
  'packages/cli/src/main.ts',
  'packages/dovecote/src/main.ts',
  'packages/mcp/src/stdio.ts',
]

/** Sources outside a package's `src` that ship: the plugin's host adapters and the sprites command. */
const SHIPPED_SOURCE_DIRECTORIES = ['packages/plugin/hooks', 'packages/sprites/bin']

const PACKAGES_WITH_ASYNC = ['kernel']

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.stryker-tmp', 'reports'])

const LANGUAGE_FILE = 'packages/pwa/src/languages/en.ts'

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

/** The only sources that may write `audit_events`, each with its reason. */
const AUDIT_WRITERS: Readonly<Record<string, string>> = {
  'packages/dovecote/src/domain/audit.ts':
    'records each row chained to the head and purges the oldest prefix for retention',
}

/** The only sources that may write to stdout or the console, each with its reason. */
const STANDARD_OUTPUT_WRITERS: Readonly<Record<string, string>> = {
  'packages/dovecote/src/log/operational-log.ts': 'the operational log is JSON lines on stdout',
  'packages/dovecote/src/main.ts': 'prints what `dovecote audit verify` and `dovecote audit export` answer',
  'packages/cli/src/node-environment.ts': "the command line's terminal output",
  'packages/mcp/src/stdio.ts': 'the MCP stdio transport, whose stdout carries JSON-RPC',
}

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
    ...asyncIn(file, source, at),
    ...auditWritesIn(file, source, at),
    ...standardOutputIn(file, source, at),
  ]
}

/** Writes to `audit_events` and to stdout or the console outside the files listed for them. */
export const checkAuditAndOutput = (file: string, text: string): Violation[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const at = (position: number, message: string): Violation => ({
    file,
    line: source.getLineAndCharacterOfPosition(position).line + 1,
    message,
  })
  return [...auditWritesIn(file, source, at), ...standardOutputIn(file, source, at)]
}

/** `async` and `await` outside the kernel, but for one top-level `await T.run(...)` in a program entry file. */
export const checkAsync = (file: string, text: string): Violation[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  return asyncIn(file, source, (position, message) => ({
    file,
    line: source.getLineAndCharacterOfPosition(position).line + 1,
    message,
  }))
}

export const checkPackageNames = (manifests: ReadonlyArray<{ file: string; name: unknown }>): Violation[] =>
  manifests
    .filter(({ name }) => typeof name === 'string' && VENDOR_TRADEMARKS.test(name))
    .map(({ file, name }) => ({
      file,
      line: 1,
      message: `package name ${String(name)} contains a vendor trademark`,
    }))

export const missingTestFiles = (
  sources: ReadonlyArray<string>,
  exists: (path: string) => boolean,
): string[] => sources.filter((file) => !ENTRY_FILES.test(file) && !testFilesFor(file).some(exists))

export interface SourceText {
  readonly file: string
  readonly text: string
}

/** Keys of the English language file that no source outside `languages/` names, by property or string. */
export const unusedLanguageKeys = (language: SourceText, sources: ReadonlyArray<SourceText>): Violation[] => {
  const { names, readWhole } = namesIn(sources)
  const source = ts.createSourceFile(language.file, language.text, ts.ScriptTarget.Latest, true)
  const found: Violation[] = []
  const walk = (object: ts.ObjectLiteralExpression, path: ReadonlyArray<string>): void => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const name = propertyNameOf(property.name)
      if (!names.has(name))
        found.push({
          file: language.file,
          line: source.getLineAndCharacterOfPosition(property.getStart(source)).line + 1,
          message: `language key ${[...path, name].join('.')} is never used; delete it from every language`,
        })
      const value = withoutTypeAssertions(property.initializer)
      if (ts.isObjectLiteralExpression(value) && !readWhole.has(name)) walk(value, [...path, name])
    }
  }
  for (const statement of source.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer && withoutTypeAssertions(declaration.initializer)
        if (value !== undefined && ts.isObjectLiteralExpression(value)) walk(value, [])
      }
  return found
}

export interface ModuleLayout {
  /** Files whose exports are a package's public surface or a program's start. */
  readonly entries: ReadonlySet<string>
  /** Bare specifiers such as `@homingbird/kernel/testing`, mapped to the file they name. */
  readonly packages: ReadonlyMap<string, string>
}

/** Exported values of `checked` files that no other file imports, unless the file is an entry. */
export const unimportedExports = (
  sources: ReadonlyArray<SourceText>,
  checked: (file: string) => boolean,
  layout: ModuleLayout,
): Violation[] => {
  const parsed = sources.map(({ file, text }) =>
    ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
  )
  const known = new Set(sources.map(({ file }) => file))
  const imported = new Map<string, Set<string> | 'all'>()
  const use = (target: string | null, names: ReadonlyArray<string> | 'all'): void => {
    if (target === null) return
    const already = imported.get(target)
    if (already === 'all') return
    if (names === 'all') imported.set(target, 'all')
    else imported.set(target, new Set([...(already ?? []), ...names]))
  }
  for (const source of parsed)
    for (const reference of referencesIn(source))
      use(resolveModule(source.fileName, reference.specifier, known, layout), reference.names)
  return parsed
    .filter((source) => checked(source.fileName) && !layout.entries.has(source.fileName))
    .flatMap((source) => {
      const used = imported.get(source.fileName) ?? new Set<string>()
      if (used === 'all') return []
      return exportedValuesOf(source)
        .filter(({ name }) => !used.has(name))
        .map(({ name, position }) => ({
          file: source.fileName,
          line: source.getLineAndCharacterOfPosition(position).line + 1,
          message: `${name} is exported but no other file imports it; delete it or stop exporting it`,
        }))
    })
}

const VENDOR_TRADEMARKS = /claude|anthropic/i

const testFilesFor = (file: string): string[] => {
  const match = /^(packages\/[^/]+)\/src\/(.+)\.ts$/.exec(file)
  if (match === null) return []
  const [, packageRoot, inside] = match
  const base = inside!.split('/').pop()!
  return [`${packageRoot}/test/${inside}.test.ts`, `${packageRoot}/test/${base}.test.ts`]
}

const repositoryRoot = join(import.meta.dirname, '..')

const sourceFilesOf = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return SKIPPED_DIRECTORIES.has(entry) ? [] : sourceFilesOf(path)
    return /\.tsx?$/.test(path) && !path.endsWith('.d.ts') ? [path] : []
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

const asyncIn = (
  file: string,
  source: ts.SourceFile,
  at: (position: number, message: string) => Violation,
): Violation[] => {
  if (mayUseAsync(file)) return []
  const found: Violation[] = []
  const visit = (node: ts.Node, inFunction: boolean): void => {
    if (ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(isAsyncKeyword))
      found.push(at(node.getStart(source), `async functions belong in the kernel; ${ASYNC_ADVICE}`))
    if (ts.isAwaitExpression(node) && !(PROGRAM_ENTRY_FILES.includes(file) && !inFunction && isTaskRun(node)))
      found.push(at(node.getStart(source), `await belongs in the kernel; ${ASYNC_ADVICE}`))
    if (ts.isForOfStatement(node) && node.awaitModifier !== undefined)
      found.push(
        at(node.getStart(source), 'for await belongs in the kernel; use Stream.forEach or Stream.toArray'),
      )
    node.forEachChild((child) => visit(child, inFunction || ts.isFunctionLike(node)))
  }
  visit(source, false)
  return found
}

const ASYNC_ADVICE = 'wrap each call that returns a promise in Task.promise and chain the steps with Task.gen'

const isAsyncKeyword = (modifier: ts.ModifierLike): boolean => modifier.kind === ts.SyntaxKind.AsyncKeyword

const isTaskRun = (node: ts.AwaitExpression): boolean =>
  ts.isCallExpression(node.expression) &&
  /^(T|Task)\.(run|runPromise)$/.test(node.expression.expression.getText())

const mayUseAsync = (file: string): boolean =>
  PACKAGES_WITH_ASYNC.some((name) => file.startsWith(`packages/${name}/`))

const auditWritesIn = (
  file: string,
  source: ts.SourceFile,
  at: (position: number, message: string) => Violation,
): Violation[] => {
  if (!isPackageSource(file) || Object.hasOwn(AUDIT_WRITERS, file)) return []
  const found: Violation[] = []
  const visit = (node: ts.Node): void => {
    const literal = literalTextOf(node)
    if ((literal !== null && AUDIT_WRITE_STATEMENT.test(literal)) || isAuditWriteHelperCall(node))
      found.push(
        at(node.getStart(source), `audit_events is written only in ${Object.keys(AUDIT_WRITERS).join(', ')}`),
      )
    node.forEachChild(visit)
  }
  visit(source)
  return found
}

const AUDIT_WRITE_STATEMENT =
  /\b(?:insert(?:\s+ignore)?(?:\s+into)?|replace(?:\s+into)?|update(?:\s+only)?|delete(?:\s+from)?|truncate(?:\s+table)?|drop\s+table(?:\s+if\s+exists)?)\s+[`"[]?audit_events\b/i

const literalTextOf = (node: ts.Node): string | null => {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isTemplateExpression(node))
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ? ')
  return null
}

const isAuditWriteHelperCall = (node: ts.Node): boolean => {
  if (!ts.isCallExpression(node)) return false
  const table = node.arguments[0]
  const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression
  return (
    table !== undefined &&
    ts.isStringLiteralLike(table) &&
    table.text === 'audit_events' &&
    ts.isIdentifier(callee) &&
    /^(insert|replace|upsert|update|delete|truncate|drop)/i.test(callee.text)
  )
}

const standardOutputIn = (
  file: string,
  source: ts.SourceFile,
  at: (position: number, message: string) => Violation,
): Violation[] => {
  if (!isPackageSource(file) || Object.hasOwn(STANDARD_OUTPUT_WRITERS, file)) return []
  const found: Violation[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const name = node
        .getText(source)
        .replace(/[\s?]/g, '')
        .replace(/^globalThis\./, '')
      if (STANDARD_OUTPUT.test(name))
        found.push(
          at(
            node.getStart(source),
            `${name} is not allowed here; log through the Log service, print through the program's output`,
          ),
        )
    }
    node.forEachChild(visit)
  }
  visit(source)
  return found
}

const STANDARD_OUTPUT = /^(process\.stdout\.write|console\.(log|info|warn|error|debug))$/

const isPackageSource = (file: string): boolean => /^packages\/[^/]+\/src\//.test(file)

const isAdapter = (file: string): boolean => ADAPTER_FILES.includes(file) || /\/bin\//.test(file)

const mayDeclareClasses = (file: string): boolean =>
  PACKAGES_WITH_CLASSES.some((name) => file.startsWith(`packages/${name}/`))

const namesIn = (
  sources: ReadonlyArray<SourceText>,
): { readonly names: ReadonlySet<string>; readonly readWhole: ReadonlySet<string> } => {
  const names = new Set<string>()
  const readWhole = new Set<string>()
  for (const { file, text } of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) names.add(node.text)
      if (ts.isElementAccessExpression(node) && ts.isPropertyAccessExpression(node.expression))
        readWhole.add(node.expression.name.text)
      if (ts.isCallExpression(node) && /^Object\.(values|entries|keys)$/.test(node.expression.getText()))
        for (const argument of node.arguments)
          if (ts.isPropertyAccessExpression(argument)) readWhole.add(argument.name.text)
      node.forEachChild(visit)
    }
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true))
  }
  return { names, readWhole }
}

const propertyNameOf = (name: ts.PropertyName): string =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : name.getText()

const withoutTypeAssertions = (expression: ts.Expression): ts.Expression =>
  ts.isSatisfiesExpression(expression) ||
  ts.isAsExpression(expression) ||
  ts.isParenthesizedExpression(expression)
    ? withoutTypeAssertions(expression.expression)
    : expression

interface ModuleReference {
  readonly specifier: string
  readonly names: ReadonlyArray<string> | 'all'
}

const referencesIn = (source: ts.SourceFile): ModuleReference[] => {
  const found: ModuleReference[] = []
  const namespaces = new Map<string, string>()
  for (const statement of source.statements) {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) continue
    const specifier = statement.moduleSpecifier
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      const bindings = clause?.namedBindings
      if (clause?.name !== undefined) found.push({ specifier: specifier.text, names: ['default'] })
      if (bindings !== undefined && ts.isNamespaceImport(bindings))
        namespaces.set(bindings.name.text, specifier.text)
      else if (bindings !== undefined)
        found.push({
          specifier: specifier.text,
          names: bindings.elements.map((element) => (element.propertyName ?? element.name).text),
        })
    } else {
      const clause = statement.exportClause
      found.push({
        specifier: specifier.text,
        names:
          clause === undefined || ts.isNamespaceExport(clause)
            ? 'all'
            : clause.elements.map((element) => (element.propertyName ?? element.name).text),
      })
    }
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      found.push({ specifier: node.arguments[0].text, names: 'all' })
    if (ts.isIdentifier(node) && namespaces.has(node.text) && !ts.isNamespaceImport(node.parent)) {
      const parent = node.parent
      const specifier = namespaces.get(node.text)!
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node)
        found.push({ specifier, names: [parent.name.text] })
      else if (!(ts.isQualifiedName(parent) && parent.left === node)) found.push({ specifier, names: 'all' })
    }
    node.forEachChild(visit)
  }
  visit(source)
  return found
}

const resolveModule = (
  importer: string,
  specifier: string,
  known: ReadonlySet<string>,
  layout: ModuleLayout,
): string | null => {
  if (!specifier.startsWith('.')) return layout.packages.get(specifier) ?? null
  const path = posix.normalize(posix.join(posix.dirname(importer), specifier))
  const candidates = [path, path.replace(/\.m?js$/, '.ts'), `${path}.ts`, `${path}.tsx`, `${path}/index.ts`]
  return candidates.find((candidate) => known.has(candidate)) ?? null
}

interface ExportedValue {
  readonly name: string
  readonly position: number
}

const exportedValuesOf = (source: ts.SourceFile): ExportedValue[] =>
  source.statements.flatMap((statement): ExportedValue[] => {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause
      if (statement.moduleSpecifier !== undefined || statement.isTypeOnly || clause === undefined) return []
      if (!ts.isNamedExports(clause)) return []
      return clause.elements
        .filter((element) => !element.isTypeOnly)
        .map((element) => ({ name: element.name.text, position: element.getStart(source) }))
    }
    if (!isExported(statement)) return []
    if (ts.isVariableStatement(statement))
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name)
          ? [{ name: declaration.name.text, position: declaration.getStart(source) }]
          : [],
      )
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    )
      return [{ name: statement.name.text, position: statement.getStart(source) }]
    return []
  })

interface Manifest {
  readonly name?: unknown
  readonly exports?: Readonly<Record<string, string>>
  readonly bin?: Readonly<Record<string, string>>
}

const moduleLayoutOf = (manifests: ReadonlyArray<{ file: string; manifest: Manifest }>): ModuleLayout => {
  const packages = new Map<string, string>()
  const entries = new Set<string>(PROGRAM_ENTRY_FILES)
  for (const { file, manifest } of manifests) {
    const directory = posix.dirname(file)
    for (const [key, target] of Object.entries(manifest.exports ?? {})) {
      const path = posix.join(directory, target)
      packages.set(`${String(manifest.name)}${key.slice(1)}`, path)
      entries.add(path)
    }
    for (const target of Object.values(manifest.bin ?? {})) entries.add(posix.join(directory, target))
  }
  return { entries, packages }
}

const isRunDirectly = process.argv[1] !== undefined && import.meta.filename === process.argv[1]

if (isRunDirectly) {
  const surveyOnly = process.argv.includes('--survey')
  const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
  const packageNames = readdirSync(join(repositoryRoot, 'packages')).filter((name) =>
    existsSync(join(repositoryRoot, 'packages', name, 'package.json')),
  )
  const allPackages = packageNames.filter((name) => existsSync(join(repositoryRoot, 'packages', name, 'src')))
  const packages = surveyOnly ? allPackages : ENFORCED_PACKAGES
  const toRepositoryPath = (path: string): string =>
    relative(repositoryRoot, join(process.cwd(), relative(process.cwd(), path)))
      .split(sep)
      .join('/')
  const read = (file: string): SourceText => ({
    file,
    text: readFileSync(join(repositoryRoot, file), 'utf8'),
  })
  const sourcesOf = (directory: string): string[] =>
    existsSync(join(repositoryRoot, directory))
      ? sourceFilesOf(join(repositoryRoot, directory)).map(toRepositoryPath)
      : []
  const files =
    requested.length > 0
      ? requested.filter((file) => packages.some((name) => file.includes(`packages/${name}/src/`)))
      : packages.flatMap((name) => sourceFilesOf(join(repositoryRoot, 'packages', name, 'src')))
  const manifests = ['package.json', ...packageNames.map((name) => `packages/${name}/package.json`)].map(
    (file) => ({ file, manifest: JSON.parse(read(file).text) as Manifest }),
  )
  const unenforced =
    requested.length > 0 || surveyOnly
      ? []
      : [
          ...allPackages
            .filter((name) => !ENFORCED_PACKAGES.includes(name))
            .flatMap((name) => sourcesOf(`packages/${name}/src`)),
          ...SHIPPED_SOURCE_DIRECTORIES.flatMap(sourcesOf),
        ]
  const wholeRepository = [
    ...packageNames.flatMap((name) => sourcesOf(`packages/${name}`)),
    ...sourcesOf('scripts'),
  ]
  const layout = moduleLayoutOf(manifests.slice(1))
  const unimported =
    requested.length > 0 ? [] : unimportedExports(wholeRepository.map(read), isPackageSource, layout)
  const violations = [
    ...files.flatMap((path) => checkSource(toRepositoryPath(path), readFileSync(path, 'utf8'))),
    ...unenforced.flatMap((file) => {
      const { text } = read(file)
      return [...checkAsync(file, text), ...checkAuditAndOutput(file, text)]
    }),
    ...checkPackageNames(manifests.map(({ file, manifest }) => ({ file, name: manifest.name }))),
    ...(requested.length > 0
      ? []
      : [
          ...unusedLanguageKeys(
            read(LANGUAGE_FILE),
            sourcesOf('packages/pwa/src')
              .filter((file) => !file.startsWith('packages/pwa/src/languages/'))
              .map(read),
          ),
          ...unimported,
        ]),
  ]
  for (const violation of violations)
    process.stdout.write(`${violation.file}:${violation.line}  ${violation.message}\n`)
  const untested = missingTestFiles(
    allPackages.flatMap((name) => sourcesOf(`packages/${name}/src`)),
    (path) => existsSync(join(repositoryRoot, path)),
  )
  if (requested.length === 0 && untested.length > 0) {
    for (const file of untested) process.stdout.write(`warning  ${file} has no test file of the same name\n`)
    process.stdout.write(`${untested.length} source file(s) without a test file of the same name.\n`)
  }
  if (violations.length > 0 && !surveyOnly) {
    process.stdout.write(`\n${violations.length} style violation(s). See .claude/rules/code-style.md\n`)
    process.exit(1)
  }
}
