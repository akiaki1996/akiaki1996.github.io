import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, parseFrontmatter, renderMarkdown } from './markdown.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONTENT_DIR = path.join(ROOT, 'content');
const SRC_DIR = path.join(ROOT, 'src');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function loadMarkdownCollection(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.md')).sort();
  return files
    .map((file) => {
      const raw = fs.readFileSync(path.join(dirPath, file), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const id = meta.id || file.replace(/\.md$/, '');
      const tags = (meta.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      return {
        id,
        index: meta.index || '',
        title: meta.title || id,
        date: meta.date || '',
        category: meta.category || '随笔',
        tags,
        summary: meta.summary || '',
        pinned: meta.pinned === 'true',
        image: meta.image || '',
        html: renderMarkdown(body)
      };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function renderSpecRow(label, value, { href, accent } = {}) {
  const valClass = accent ? 'aki-spec-value is-accent' : 'aki-spec-value';
  if (href) {
    const ext = /^https?:\/\//.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(href)}"${ext} class="aki-spec-row aki-spec-row-link">
      <span class="aki-spec-label">${escapeHtml(label)}</span>
      <span class="${valClass}">${escapeHtml(value)}</span>
    </a>`;
  }
  return `<div class="aki-spec-row">
    <span class="aki-spec-label">${escapeHtml(label)}</span>
    <span class="${valClass}">${escapeHtml(value)}</span>
  </div>`;
}

function renderLayout({ title, description, activeNav, resume, content }) {
  const navItems = [
    { id: 'home', href: '/', label: '首页' },
    { id: 'resume', href: '/resume/', label: '个人简历' },
    { id: 'notes', href: '/notes/', label: '开发 Notes' },
    { id: 'life', href: '/life/', label: '生活与眼镜档案' }
  ];

  const navHtml = navItems
    .map((item) => {
      const cls = item.id === activeNav ? 'nav-link is-active' : 'nav-link';
      return `<a href="${item.href}" class="${cls}">${item.label}</a>`;
    })
    .join('\n          ');

  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="icon" type="image/svg+xml" href="/assets/aki-monogram.svg">
  <script>
    (function(){
      try {
        var saved = localStorage.getItem('aki-theme');
        var theme = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
      } catch (e) {}
    })();
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500&amp;family=Noto+Sans+SC:wght@400;500;600&amp;display=swap">
  <link rel="stylesheet" href="/styles/tokens.css">
  <link rel="stylesheet" href="/styles/site.css">
</head>
<body>
  <div class="site-shell">
    <header class="site-header">
      <a href="/" class="brand">
        <img src="/assets/aki-monogram.svg" alt="Aki Swiss monogram">
        <span class="brand-name">akiaki1996.github.io</span>
      </a>
      <nav class="site-nav" aria-label="主导航">
          ${navHtml}
        <button type="button" class="theme-toggle" data-theme-toggle aria-label="切换明暗主题">DARK</button>
      </nav>
    </header>

    <main>
      ${content}
    </main>

    <footer class="site-footer">
      <span>© 2026 ${escapeHtml(resume.name)} (${escapeHtml(resume.handle)}) · akiaki1996.github.io</span>
      <div class="footer-links">
        <a href="${escapeHtml(resume.github)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
        <a href="${escapeHtml(resume.projectUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(resume.projectDomain)} ↗</a>
        <a href="mailto:${escapeHtml(resume.email)}">${escapeHtml(resume.email)}</a>
      </div>
    </footer>
  </div>
  <script src="/scripts/site.js" defer></script>
</body>
</html>
`;
}

function buildHomePage(resume, notes) {
  const noteLinks = notes
    .slice(0, 3)
    .map(
      (n) => `<a href="/notes/#${escapeHtml(n.id)}" class="note-preview-item">
        <span style="font-size: 14px; font-weight: 500; color: var(--ink);">${escapeHtml(n.title)}</span>
        <span style="font-family: var(--font-mono); font-size: 12px; color: var(--ink-muted);">${escapeHtml(n.index ? `${n.index} · ` : '')}${escapeHtml(n.category)} · ${escapeHtml(n.date)}</span>
      </a>`
    )
    .join('\n          ');

  const content = `
    <section class="hero-grid">
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="kicker">00 / PERSONAL INDEX · ${escapeHtml(resume.location)} · AI FULL-STACK &amp; AGENT</div>
        <h1 class="hero-title">${escapeHtml(resume.name)} / ${escapeHtml(resume.handle)}</h1>
        <p class="lead" style="max-width: 580px;">${escapeHtml(resume.title)}。专注在数据密集与强可追溯场景中把 LLM 能力落成可验证的生产级系统（EthoInsight、KOX、${escapeHtml(resume.projectDomain)}），这里收纳我的个人简历、Agent 开发手记与生活档案。</p>
      </div>
      <div class="card" style="gap: 8px;">
        <div style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.05em; color: var(--ink-muted);">PROFILE &amp; LINKS</div>
        ${renderSpecRow('当前职位', 'AI Agent 开发工程师 · 诺达思')}
        ${renderSpecRow('教育背景', 'CU Boulder · 计算机科学硕士')}
        ${renderSpecRow('常驻 / 邮箱', `${resume.location} · ${resume.email}`, { href: `mailto:${resume.email}` })}
        ${renderSpecRow('独立项目', `${resume.projectDomain} ↗`, { href: resume.projectUrl, accent: true })}
        ${renderSpecRow('GitHub', `${resume.githubHandle} ↗`, { href: resume.github, accent: true })}
        <div class="btn-row">
          <a href="/resume/" class="aki-btn aki-btn-primary">查看完整简历</a>
          <a href="/notes/" class="aki-btn">阅读 Agent Notes</a>
          <a href="${escapeHtml(resume.projectUrl)}" target="_blank" rel="noopener noreferrer" class="aki-btn">访问 ${escapeHtml(resume.projectDomain)}</a>
        </div>
      </div>
    </section>

    <section class="hub-grid" style="margin-top: 40px;">
      <article class="card card-top-strong card-between">
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span class="kicker">01 / RESUME</span>
            <span class="aki-tag">CV · 2026</span>
          </div>
          <h2 style="margin: 0; font-size: 20px; line-height: 1.35;">个人简历与技术履历</h2>
          <p style="margin: 0; font-size: 14px; color: var(--ink-secondary);">涵盖诺达思 EthoInsight、蓝色光标 KOX 多智能体管线、哈斯科铁路实时数据平台、Inovonics 及独立项目 ${escapeHtml(resume.projectDomain)}。</p>
          <div class="tag-row">
            <span class="aki-tag">LangGraph</span>
            <span class="aki-tag">Python</span>
            <span class="aki-tag">TypeScript</span>
            <span class="aki-tag">FastAPI</span>
          </div>
        </div>
        <div class="card-foot">
          <span style="color: var(--ink-muted);">5 段工程履历 · 2 个生产平台</span>
          <a href="/resume/" style="color: var(--accent);">进入简历 →</a>
        </div>
      </article>

      <article class="card card-top-strong card-between">
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span class="kicker">02 / DEV NOTES</span>
            <span class="aki-tag aki-tag-accent">AGENT DEV</span>
          </div>
          <h2 style="margin: 0; font-size: 20px; line-height: 1.35;">Agent 开发工程手记与备忘</h2>
          <div class="note-preview-list">
            ${noteLinks}
          </div>
        </div>
        <div class="card-foot">
          <span style="color: var(--ink-muted);">共 ${notes.length} 篇工程笔记</span>
          <a href="/notes/" style="color: var(--accent);">全部 Notes →</a>
        </div>
      </article>

      <article class="card card-top-accent card-between">
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span class="kicker">03 / LIFE ARCHIVE</span>
            <span class="aki-tag aki-tag-accent">PINNED</span>
          </div>
          <h2 style="margin: 0; font-size: 20px; line-height: 1.35;">2023 眼镜度数与生活切片</h2>
          <p style="margin: 0; font-size: 14px; color: var(--ink-secondary);">保留自 2023-05-12 的验光参数，方便日后配镜随时查阅，同时收纳日常演出与生活记录。</p>
          <div style="background: var(--surface-subtle); padding: 12px 16px;">
            ${renderSpecRow('右眼 OD', '-7.25 / -1.25 × 5')}
            ${renderSpecRow('左眼 OS (优势眼)', '-6.75 / -1.25 × 130')}
            ${renderSpecRow('瞳距 PD', '66 mm (右32.5 / 左33.5)')}
          </div>
        </div>
        <div class="card-foot">
          <span style="color: var(--ink-muted);">验光单原图已归档</span>
          <a href="/life/#glasses" style="color: var(--accent);">查看原图与生活 →</a>
        </div>
      </article>
    </section>
  `;

  return renderLayout({
    title: `${resume.name} (${resume.handle}) · 个人主页`,
    description: `${resume.name} (${resume.handle}) — ${resume.title}，个人简历、Agent 开发 Notes 与生活档案。`,
    activeNav: 'home',
    resume,
    content
  });
}

function buildResumePage(resume) {
  const summaryHtml = resume.summary.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

  const expHtml = resume.experiences
    .map((exp) => {
      const highlightsHtml = exp.highlights.length
        ? `<ul class="cv-bullets">${exp.highlights
            .map((h) => `<li><strong>${escapeHtml(h.title)}</strong>：${escapeHtml(h.detail)}</li>`)
            .join('')}</ul>`
        : '';
      const tagsHtml = exp.tags.length
        ? `<div class="tag-row">${exp.tags.map((t) => `<span class="aki-tag">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';
      return `<article class="cv-entry${exp.featured ? ' is-featured' : ''}">
        <div class="cv-meta">
          <span class="cv-period">${escapeHtml(exp.period)}</span>
          <strong style="font-size: 17px;">${escapeHtml(exp.company)}</strong>
          <span style="font-size: 13px; color: var(--ink-muted);">${escapeHtml(exp.role)} · ${escapeHtml(exp.location)}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="font-size: 14px; font-weight: 500;">职责：${escapeHtml(exp.duty)}</div>
          ${highlightsHtml}
          ${tagsHtml}
        </div>
      </article>`;
    })
    .join('\n');

  const projectsHtml = resume.personalProjects
    .map(
      (proj) => `<div class="card card-left-accent" style="gap: 8px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px;">
          <strong style="font-size: 16px;">${escapeHtml(proj.name)}</strong>
          <span style="font-family: var(--font-mono); font-size: 12px; color: var(--accent); flex-shrink: 0;">${escapeHtml(proj.period)}</span>
        </div>
        <a href="${escapeHtml(proj.url)}" target="_blank" rel="noopener noreferrer" style="font-family: var(--font-mono); font-size: 12px; color: var(--accent);">${escapeHtml(proj.domain)} ↗</a>
        <p style="margin: 0; font-size: 14px; color: var(--ink-secondary);">${escapeHtml(proj.description)}</p>
      </div>`
    )
    .join('\n');

  const eduHtml = resume.education
    .map((e) => renderSpecRow(`${e.school} · ${e.degree} (${e.location})`, e.period))
    .join('');

  const skillsHtml = resume.skills.map((s) => renderSpecRow(s.label, s.value)).join('');

  const content = `
    <section class="hero-grid" style="align-items: start; padding-bottom: 32px;">
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div class="kicker">01 / CURRICULUM VITAE · 2026</div>
        <h1 class="page-title">${escapeHtml(resume.name)}（${escapeHtml(resume.handle)}）</h1>
        <p style="margin: 0; font-size: 16px; font-weight: 600;">${escapeHtml(resume.title)}</p>
        <ul class="cv-bullets" style="margin-top: 4px;">${summaryHtml}</ul>
        <div class="btn-row no-print">
          <button type="button" class="aki-btn aki-btn-primary" data-print-resume>打印 / 导出 PDF</button>
          <a href="mailto:${escapeHtml(resume.email)}" class="aki-btn">邮件联系</a>
          <a href="${escapeHtml(resume.github)}" target="_blank" rel="noopener noreferrer" class="aki-btn">GitHub ↗</a>
        </div>
      </div>
      <div class="card" style="padding: 18px 24px; gap: 0;">
        ${renderSpecRow('邮箱', resume.email, { href: `mailto:${resume.email}` })}
        ${renderSpecRow('电话', resume.phone)}
        ${renderSpecRow('所在地', resume.location)}
        ${renderSpecRow('GitHub', `${resume.githubHandle} ↗`, { href: resume.github, accent: true })}
        ${renderSpecRow('独立项目', `${resume.projectDomain} ↗`, { href: resume.projectUrl, accent: true })}
      </div>
    </section>

    <section style="display: flex; flex-direction: column; gap: 16px; margin-top: 36px;">
      <div class="section-head">
        <h2>工作经历</h2>
        <span class="section-head-en">WORK EXPERIENCE</span>
      </div>
      <div class="cv-list">${expHtml}</div>
    </section>

    <section class="two-col-grid" style="margin-top: 36px;">
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="section-head">
          <h2>个人项目与教育背景</h2>
          <span class="section-head-en">PROJECT &amp; EDU</span>
        </div>
        ${projectsHtml}
        <div class="card" style="padding: 18px 24px; gap: 0;">${eduHtml}</div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="section-head">
          <h2>专业技能</h2>
          <span class="section-head-en">SKILLS</span>
        </div>
        <div class="card" style="padding: 18px 24px; gap: 0;">${skillsHtml}</div>
      </div>
    </section>
  `;

  return renderLayout({
    title: `${resume.name} (${resume.handle}) · 个人简历`,
    description: `${resume.name} 2026 个人简历 — ${resume.title}`,
    activeNav: 'resume',
    resume,
    content
  });
}

function buildNotesPage(resume, notes) {
  const categories = ['全部', ...Array.from(new Set(notes.map((n) => n.category)))];

  const filterHtml = categories
    .map(
      (cat, idx) =>
        `<button type="button" class="filter-btn${idx === 0 ? ' is-active' : ''}" data-cat-filter="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
    )
    .join('\n        ');

  const indexHtml = notes
    .map(
      (n, idx) => `<button type="button" class="note-index-btn${idx === 0 ? ' is-selected' : ''}" data-note-target="${escapeHtml(n.id)}" data-note-cat="${escapeHtml(n.category)}">
        <div style="display: flex; justify-content: space-between; gap: 12px; font-family: var(--font-mono); font-size: 11px;">
          <span style="color: var(--accent);">${escapeHtml(n.index ? `${n.index} · ` : '')}${escapeHtml(n.category)}</span>
          <span style="color: var(--ink-muted);">${escapeHtml(n.date)}</span>
        </div>
        <strong style="font-size: 15px; line-height: 1.4;">${escapeHtml(n.title)}</strong>
        <span style="font-size: 13px; color: var(--ink-secondary);">${escapeHtml(n.summary)}</span>
      </button>`
    )
    .join('\n        ');

  const articlesHtml = notes
    .map(
      (n, idx) => `<article class="note-article" data-note-article="${escapeHtml(n.id)}"${idx === 0 ? '' : ' hidden'}>
        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; font-family: var(--font-mono); font-size: 12px; margin-bottom: 12px;">
          <span style="color: var(--accent);">${escapeHtml(n.index ? `${n.index} / ` : '')}${escapeHtml(n.category)}</span>
          <span style="color: var(--ink-muted);">${escapeHtml(n.date)}</span>
        </div>
        <h2 style="margin: 0 0 14px; font-size: 26px; line-height: 1.3;">${escapeHtml(n.title)}</h2>
        <div class="tag-row" style="margin-bottom: 24px;">
          ${n.tags.map((t, ti) => `<span class="aki-tag${ti === 0 ? ' aki-tag-accent' : ''}">${escapeHtml(t)}</span>`).join('')}
        </div>
        <div class="md-body">${n.html}</div>
      </article>`
    )
    .join('\n        ');

  const content = `
    <section class="notes-toolbar">
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div class="kicker">02 / ENGINEERING NOTES</div>
        <h1 class="page-title">开发 Notes 与技术手记</h1>
        <p style="margin: 0; font-size: 15px; color: var(--ink-secondary);">记录 Agent 工程化实践、LangGraph 运行时机制与开发排坑备忘。</p>
      </div>
      <div class="filter-group" role="tablist" aria-label="笔记分类筛选">
        ${filterHtml}
      </div>
    </section>

    <section class="notes-layout" style="margin-top: 32px;">
      <aside class="notes-index" aria-label="笔记索引">
        ${indexHtml}
      </aside>
      <div class="note-reader">
        ${articlesHtml}
      </div>
    </section>
  `;

  return renderLayout({
    title: `${resume.name} (${resume.handle}) · 开发 Notes`,
    description: `${resume.name} 的开发 Notes 与 Agent 工程手记`,
    activeNav: 'notes',
    resume,
    content
  });
}

function buildLifePage(resume, lifePosts) {
  const otherPosts = lifePosts.filter((p) => p.id !== 'glasses-2023');

  const otherHtml = otherPosts
    .map(
      (p) => `<article class="card card-top-strong">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="kicker">${escapeHtml(p.category)}</span>
          <span style="font-family: var(--font-mono); font-size: 12px; color: var(--ink-muted);">${escapeHtml(p.date)}</span>
        </div>
        <h3 style="margin: 0; font-size: 18px;">${escapeHtml(p.title)}</h3>
        <div class="md-body">${p.html}</div>
      </article>`
    )
    .join('\n      ');

  const content = `
    <section style="display: flex; flex-direction: column; gap: 10px; padding-bottom: 24px; border-bottom: 1px solid var(--line);">
      <div class="kicker">03 / LIFE &amp; PERSONAL ARCHIVE</div>
      <h1 class="page-title">个人生活与长期备忘档案</h1>
      <p style="margin: 0; font-size: 15px; color: var(--ink-secondary); max-width: 680px;">存放脱离工作代码之外的个人备忘、日常碎片与长期参考数据。首条完整保留原仓库的 2023 年验光度数记录。</p>
    </section>

    <section id="glasses" class="card card-top-accent" style="padding: 32px; gap: 24px; margin-top: 32px;">
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px;">
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="aki-tag aki-tag-accent">PERMANENT RECORD</span>
            <span style="font-family: var(--font-mono); font-size: 12px; color: var(--ink-muted);">2023-05-12 · 类别：日常</span>
          </div>
          <h2 style="margin: 0; font-size: 24px;">2023 验光度数记录</h2>
        </div>
        <button type="button" class="theme-toggle" style="margin-left: 0;" data-toggle-photo>收起验光原单</button>
      </div>

      <p style="margin: 0; font-size: 14px; color: var(--ink-secondary);">2023 年初做的验光，记录以下，留作以后配镜使用。</p>

      <div class="glasses-grid">
        <div style="background: var(--surface-subtle); padding: 20px 24px; border: 1px solid var(--line);">
          <div style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.05em; color: var(--ink-muted); padding-bottom: 8px; border-bottom: 1px solid var(--line);">OPTOMETRY SPECIFICATION</div>
          ${renderSpecRow('优势眼 (Dominant)', '左眼 (OS)')}
          ${renderSpecRow('右眼 (R / OD)', '-7.25  -1.25 × 5')}
          ${renderSpecRow('左眼 (L / OS)', '-6.75  -1.25 × 130')}
          ${renderSpecRow('单眼瞳距 (PD)', '右 32.5 mm · 左 33.5 mm')}
          ${renderSpecRow('总瞳距 (Total PD)', '66 mm')}
        </div>

        <div data-photo-wrap style="display: flex; flex-direction: column; gap: 10px;">
          <div class="glasses-photo-box">
            <img src="/assets/2023glasses.jpg" alt="2023 年手写验光度数原单：优左，R -7.25 -1.25x5，L -6.75 -1.25x130，PD 右32.5 左33.5 总66">
          </div>
          <span style="font-family: var(--font-mono); font-size: 11px; color: var(--ink-muted);">原件附件：2023glasses.jpg（手写验光单）</span>
        </div>
      </div>
    </section>

    <section class="two-col-grid" style="margin-top: 32px;">
      ${otherHtml}
    </section>
  `;

  return renderLayout({
    title: `${resume.name} (${resume.handle}) · 生活与眼镜档案`,
    description: `${resume.name} 的个人生活档案与 2023 验光度数记录`,
    activeNav: 'life',
    resume,
    content
  });
}

function build404Page(resume) {
  const content = `
    <section class="card card-top-accent" style="max-width: 640px; padding: 36px;">
      <div class="kicker">404 / NOT FOUND</div>
      <h1 class="page-title">页面未找到</h1>
      <p style="margin: 0; color: var(--ink-secondary);">该地址可能来自旧站点归档并已清理。你可以返回首页，或直接访问个人简历、开发 Notes 与 2023 眼镜度数档案。</p>
      <div class="btn-row">
        <a href="/" class="aki-btn aki-btn-primary">返回首页</a>
        <a href="/life/#glasses" class="aki-btn">2023 眼镜度数</a>
      </div>
    </section>
  `;
  return renderLayout({
    title: `404 · ${resume.name} (${resume.handle})`,
    description: '页面未找到',
    activeNav: '',
    resume,
    content
  });
}

export function buildSite() {
  const resume = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'resume.json'), 'utf8'));
  const notes = loadMarkdownCollection(path.join(CONTENT_DIR, 'notes'));
  const lifePosts = loadMarkdownCollection(path.join(CONTENT_DIR, 'life'));

  fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
  ensureDir(PUBLIC_DIR);

  copyDir(path.join(SRC_DIR, 'styles'), path.join(PUBLIC_DIR, 'styles'));
  copyDir(path.join(SRC_DIR, 'scripts'), path.join(PUBLIC_DIR, 'scripts'));
  copyDir(path.join(SRC_DIR, 'assets'), path.join(PUBLIC_DIR, 'assets'));

  fs.writeFileSync(path.join(PUBLIC_DIR, '.nojekyll'), '');
  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), buildHomePage(resume, notes));

  ensureDir(path.join(PUBLIC_DIR, 'resume'));
  fs.writeFileSync(path.join(PUBLIC_DIR, 'resume', 'index.html'), buildResumePage(resume));

  ensureDir(path.join(PUBLIC_DIR, 'notes'));
  fs.writeFileSync(path.join(PUBLIC_DIR, 'notes', 'index.html'), buildNotesPage(resume, notes));

  ensureDir(path.join(PUBLIC_DIR, 'life'));
  fs.writeFileSync(path.join(PUBLIC_DIR, 'life', 'index.html'), buildLifePage(resume, lifePosts));

  fs.writeFileSync(path.join(PUBLIC_DIR, '404.html'), build404Page(resume));

  return { notesCount: notes.length, lifeCount: lifePosts.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = buildSite();
  console.log(`Built akiaki1996.github.io -> public/ (notes: ${result.notesCount}, life: ${result.lifeCount})`);
}
