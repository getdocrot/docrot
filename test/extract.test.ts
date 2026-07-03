import { describe, expect, it } from 'vitest';
import { parseDoc } from '../src/extract.js';

const md = `# Title

## Second heading

Some [link](./other.md) and ![img](./a.png).

\`\`\`javascript
const x = 1;
\`\`\`

\`\`\`ts docrot-ignore
broken(
\`\`\`

<!-- docrot-ignore -->
\`\`\`js
also broken(
\`\`\`

<a id="custom-anchor"></a>

\`\`\`console
$ npm install thing
output line
\`\`\`
`;

describe('parseDoc', () => {
  const doc = parseDoc('/tmp/x/README.md', 'README.md', md);

  it('normalizes fence languages', () => {
    expect(doc.blocks.map((b) => b.norm)).toEqual(['js', 'ts', 'js', 'shell']);
  });

  it('honors fence-meta and comment ignores', () => {
    expect(doc.blocks[1].skipped).toBeTruthy();
    expect(doc.blocks[2].skipped).toBeTruthy();
    expect(doc.blocks[0].skipped).toBeNull();
  });

  it('collects headings, links and html anchors', () => {
    expect(doc.headings).toEqual(['Title', 'Second heading']);
    expect(doc.links.map((l) => l.url)).toEqual(['./other.md', './a.png']);
    expect(doc.htmlAnchors).toContain('custom-anchor');
  });

  it('records fence line numbers', () => {
    expect(doc.blocks[0].fenceLine).toBe(7);
    expect(doc.blocks[0].contentStartLine).toBe(8);
  });
});
