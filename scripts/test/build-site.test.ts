import { describe, expect, it } from 'vitest'
import { llmsFull, withAbsoluteLinks } from '../build-site.ts'

describe('the site build', () => {
  it('points relative links in a document at the file on GitHub', () => {
    expect(withAbsoluteLinks('See [deployment](deployment.md#backups).', 'docs/guide.md')).toBe(
      'See [deployment](https://github.com/let-sunny/homingbird/blob/main/docs/deployment.md#backups).',
    )
    expect(withAbsoluteLinks('[policy](../SECURITY.md)', 'docs/guide.md')).toBe(
      '[policy](https://github.com/let-sunny/homingbird/blob/main/SECURITY.md)',
    )
  })

  it('leaves anchors and absolute links as they are', () => {
    const markdown = '[up](#contents) [site](https://example.com/a) [mail](mailto:a@example.com)'
    expect(withAbsoluteLinks(markdown, 'docs/guide.md')).toBe(markdown)
  })

  it('appends the guide, deployment, security rules and policy to llms.txt, each with its source', () => {
    const full = llmsFull((path) => `contents of ${path}`)
    expect(full.startsWith('contents of site/llms.txt\n\n---\n\n# Guide\n')).toBe(true)
    expect(full.match(/^# .+$/gm)).toEqual([
      '# Guide',
      '# Deployment',
      '# Security rules',
      '# Security policy',
    ])
    expect(full).toContain(
      'Source: https://github.com/let-sunny/homingbird/blob/main/.claude/rules/security.md\n\ncontents of .claude/rules/security.md',
    )
  })
})
