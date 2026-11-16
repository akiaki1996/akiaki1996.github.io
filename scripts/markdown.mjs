/**
 * Minimal zero-dependency Markdown + YAML-like frontmatter parser.
 */

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseFrontmatter(raw) {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { meta: {}, body: normalized };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { meta: {}, body: normalized };
  }
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 5).trimStart();
  const meta = {};
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key) meta[key] = val;
  }
  return { meta, body };
}

function renderInline(text) {
  const codeTokens = [];
  const withCodePlaceholders = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  let escaped = escapeHtml(withCodePlaceholders);

  // Images: ![alt](src)
  escaped = escaped.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
    return `<img src="${src}" alt="${alt}" loading="lazy">`;
  });

  // Links: [label](url)
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const external = /^https?:\/\//.test(url);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${url}"${attrs}>${label}</a>`;
  });

  // Bold and italic
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return escaped.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeTokens[Number(idx)]);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = line.match(/^```([\w-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] ? ` class="language-${escapeHtml(fenceMatch[1])}"` : '';
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code${lang}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<h${level}>${renderInline(headingMatch[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Pipe table
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map((h) => `<th>${renderInline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    // Unordered or ordered list
    const ulMatch = line.match(/^\s*[-*•]\s+(.+)$/);
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ulMatch || olMatch) {
      const isOrdered = Boolean(olMatch);
      const tag = isOrdered ? 'ol' : 'ul';
      const pattern = isOrdered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*•]\s+(.+)$/;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(pattern);
        if (!m) break;
        items.push(`<li>${renderInline(m[1].trim())}</li>`);
        i++;
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${renderInline(paraLines.join(' '))}</p>`);
  }

  return out.join('\n');
}
