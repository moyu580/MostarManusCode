import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { JSDOM } from 'jsdom';
import { mountBlog } from '../client/page-effects.mjs';
import { mdToHtml, escapeHtml, escapeXml } from '../markdown.mjs';
import {
  filterPosts,
  isValidCategory,
  matchesFilter,
  normalizeFilterState,
} from '../filters.mjs';
import { getCompactPaginationItems, parsePaginationJump } from '../pagination.mjs';
import {
  buildTermsUrl,
  filterGlossary,
  formatTermsCountText,
  getTermNameMatchRank,
  groupGlossarySearchResults,
  matchesGlossaryRelatedContent,
  normalizeTermsFilterState,
  parsePageParam,
  resolveHashTarget,
  termIdFromHash,
  termsTotalPages,
  TERMS_PER_PAGE,
} from '../terms.mjs';
import {
  buildJobsUrl,
  clampJobsPage,
  jobsTotalPages,
  JOBS_PER_PAGE,
  normalizeJobsTab,
  pageForIndex,
  readJobsUrlState,
  STACK_PER_PAGE,
  validateJobsData,
} from '../jobs.mjs';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist-build');

function readContent(dir, file) {
  return fs.readFileSync(path.join(SRC, 'content', dir, file), 'utf8');
}

function markdownBody(dir, file) {
  return matter(readContent(dir, file)).content;
}

function countMatches(value, expression) {
  return (value.match(expression) || []).length;
}

function extractCssBlock(source, preludePattern) {
  const match = source.match(preludePattern);
  if (!match || match.index === undefined) return null;

  const openIndex = source.indexOf('{', match.index + match[0].length);
  if (openIndex === -1) return null;

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) {
      return {
        body: source.slice(openIndex + 1, index),
        full: source.slice(match.index, index + 1),
      };
    }
  }

  return null;
}

function distMarker() {
  const index = path.join(DIST, 'index.html');
  return fs.existsSync(index) ? fs.statSync(index).mtimeMs : null;
}

function createTestBuildRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mostarmanus-build-'));
}

describe('Terms pagination helpers', () => {
  it('keeps the first pages, current page, ellipses, and dynamic last page compact', () => {
    assert.deepEqual(getCompactPaginationItems(1, 5), [1, 2, 'ellipsis', 5]);
    assert.deepEqual(getCompactPaginationItems(2, 5), [1, 2, 'ellipsis', 5]);
    assert.deepEqual(getCompactPaginationItems(3, 5), [1, 2, 3, 'ellipsis', 5]);
    assert.deepEqual(getCompactPaginationItems(4, 5), [1, 2, 'ellipsis', 4, 5]);
    assert.deepEqual(getCompactPaginationItems(5, 5), [1, 2, 'ellipsis', 5]);
    assert.deepEqual(getCompactPaginationItems(10, 20), [1, 2, 'ellipsis', 10, 'ellipsis', 20]);
    assert.deepEqual(getCompactPaginationItems(2, 4), [1, 2, 3, 4]);
  });

  it('never duplicates numeric pages and always exposes the current and last page', () => {
    for (const totalPages of [1, 2, 5, 20]) {
      for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
        const items = getCompactPaginationItems(currentPage, totalPages);
        const pages = items.filter((item) => typeof item === 'number');
        assert.equal(new Set(pages).size, pages.length);
        assert.ok(pages.includes(currentPage));
        assert.equal(pages.at(-1), totalPages);
        assert.ok(pages.every((page, index) => index === 0 || page > pages[index - 1]));
        assert.doesNotMatch(items.join(','), /ellipsis,ellipsis/);
      }
    }
  });

  it('strictly validates page-jump input without clamping invalid values', () => {
    assert.equal(parsePaginationJump('1', 5), 1);
    assert.equal(parsePaginationJump(' 5 ', 5), 5);
    for (const value of ['', ' ', '0', '-1', '01', '2.5', '1e2', 'abc', '6', '9007199254740992']) {
      assert.equal(parsePaginationJump(value, 5), null, `${JSON.stringify(value)} must be rejected`);
    }
  });
});

describe('Frontmatter', () => {
  it('keeps project links free of sample awards and source fields', () => {
    const { data } = matter(readContent('projects', 'robot-car.md'));
    assert.deepEqual(data.links, { demo: '' });
    assert.equal(Object.hasOwn(data, 'awards'), false);

    const resume = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'resume.json'), 'utf8'));
    assert.equal(Object.hasOwn(resume, 'awards'), false);
  });

  it('keeps any future published post metadata well-formed', () => {
    const blogDir = path.join(SRC, 'content', 'blog');
    const files = fs.readdirSync(blogDir).filter((file) => file.endsWith('.md'));
    for (const file of files) {
      const { data } = matter(fs.readFileSync(path.join(blogDir, file), 'utf8'));
      assert.ok(Array.isArray(data.tags), `${file}: tags must be an array`);
      assert.ok(data.tags.every((tag) => typeof tag === 'string'), `${file}: tags must be strings`);
      assert.ok(Number.isFinite(new Date(data.pubDate).getTime()), `${file}: pubDate must be valid`);
    }
  });
});

describe('Markdown renderer', () => {
  it('renders a markdown table through the production renderer', () => {
    const html = mdToHtml('| 模块 | 状态 |\n| --- | --- |\n| 控制器 | 已验证 |');
    assert.equal(countMatches(html, /<table/g), 1);
    assert.equal(countMatches(html, /class="table-scroll"/g), 1);
  });

  it('renders responsive system architecture fences safely', () => {
    const architecture = mdToHtml([
      '```architecture',
      '{',
      '  "layers": [',
      '    {"title": "用户交互层", "items": ["语音", "文字"]},',
      '    {"title": "执行模块", "modules": [',
      '      {"title": "底盘控制", "items": ["SLAM"]},',
      '      {"title": "机械臂控制", "items": ["MoveIt2"]},',
      '      {"title": "感知系统", "items": ["YOLOv8"]}',
      '    ]}',
      '  ]',
      '}',
      '```',
    ].join('\n'));
    assert.match(architecture, /<section class="architecture"/);
    assert.equal(countMatches(architecture, /class="architecture-module"/g), 3);
    assert.doesNotMatch(architecture, /<pre><code/);

    const unsafeArchitecture = mdToHtml([
      '```architecture',
      '{"layers": [{"title": "<script>", "items": ["<img>"]}]}',
      '```',
    ].join('\n'));
    assert.match(unsafeArchitecture, /&lt;script&gt;/);
    assert.doesNotMatch(unsafeArchitecture, /<script>/);

    const malformedArchitecture = mdToHtml('```architecture\nnot-json\n```');
    assert.match(malformedArchitecture, /class="language-architecture"/);
  });
  it('renders task lists, special language fences, and unclosed fences safely', () => {
    const tasks = mdToHtml('- [x] complete\n- [ ] open');
    assert.match(tasks, /type="checkbox"/);
    assert.match(tasks, /disabled/);

    const cpp = mdToHtml('```c++\nint main() {}\n```');
    const csharp = mdToHtml('```c#\nclass Program {}\n```');
    assert.match(cpp, /language-c\+\+/);
    assert.match(csharp, /language-c#/);

    const started = Date.now();
    const unclosed = mdToHtml('```python\nprint("unclosed")');
    assert.ok(Date.now() - started < 5000);
    assert.match(unclosed, /<pre><code/);
  });

  it('rejects raw HTML and unsafe URLs while preserving safe external links', () => {
    const rawHtml = mdToHtml('<script>alert(1)</script>');
    assert.ok(!rawHtml.includes('<script>'));
    assert.match(rawHtml, /&lt;script&gt;/);

    const unsafe = mdToHtml('[bad](javascript:alert(1)) [data](data:text/html,nope)');
    assert.ok(!unsafe.includes('href="javascript:'));
    assert.ok(!unsafe.includes('href="data:'));

    const safe = mdToHtml('[safe](https://example.com)');
    assert.match(safe, /href="https:\/\/example\.com"/);
    assert.match(safe, /rel="noopener noreferrer"/);
    assert.match(safe, /target="_blank"/);
  });
});

describe('Filter helpers', () => {
  const posts = [
    { slug: 'debug-pid', data: { category: 'debug', tags: ['PID', 'ROS2'] } },
    { slug: 'insight-llm', data: { category: 'insight', tags: ['LLM', 'Agent'] } },
    { slug: 'learn-pid', data: { category: 'learn', tags: ['PID', '控制理论'] } },
  ];

  it('filters by category and treats an empty category as all posts', () => {
    assert.deepEqual(filterPosts(posts, 'debug').map((post) => post.slug), ['debug-pid']);
    assert.deepEqual(filterPosts(posts, 'learn').map((post) => post.slug), ['learn-pid']);
    assert.deepEqual(filterPosts(posts, '').map((post) => post.slug), posts.map((post) => post.slug));
    assert.equal(matchesFilter(posts[0], ''), true);
  });

  it('normalizes unknown categories to the unfiltered state', () => {
    assert.equal(isValidCategory('debug'), true);
    assert.equal(isValidCategory('unknown'), false);
    assert.deepEqual(normalizeFilterState('unknown'), {
      category: '',
    });
  });
});

describe('Build module helpers', () => {
  it('can be imported without rebuilding dist-build', async () => {
    const before = distMarker();
    const build = await import('../build.mjs');
    const after = distMarker();
    assert.equal(after, before, 'importing build.mjs must not write dist-build');
    assert.equal(typeof build.buildSite, 'function');
  });

  it('never renders source repository links for commercial projects', async () => {
    const { projectLinksHtml } = await import('../build.mjs');
    const hiddenRepo = projectLinksHtml({ repo: 'https://github.com/example/repo', repoStatus: 'pending', demo: '' });
    assert.equal(hiddenRepo, '');

    const demo = projectLinksHtml({ demo: 'https://example.com/demo' });
    assert.match(demo, /href="https:\/\/example\.com\/demo"/);
    assert.doesNotMatch(demo, /github|源码仓库/i);
  });

  it('uses the generated sharing image for article metadata and JSON-LD', async () => {
    const { generateJsonLd, head } = await import('../build.mjs');
    const metadata = head('Example', 'Description', {
      type: 'article',
      pageUrl: '/blog/example/',
    });
    assert.match(metadata, /og-image\.png/);

    const jsonLd = JSON.parse(generateJsonLd('blogpost', {
      title: 'Example',
      description: 'Description',
      pubDate: '2026-08-03',
      url: 'https://mostarmanus.ink/blog/example/',
    }));
    assert.equal(jsonLd.image, 'https://mostarmanus.ink/og-image.png');
  });

  it('validates and serializes glossary data safely', async () => {
    const {
      isSafeInternalPath,
      safeJsonForScript,
      validateGlossary,
    } = await import('../build.mjs');
    const glossary = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'glossary.json'), 'utf8'));
    const categories = new Set(glossary.map((term) => term.category));

    assert.deepEqual(normalizeTermsFilterState(' AMCL ', 'unknown', categories), {
      query: 'AMCL',
      category: 'all',
    });
    assert.ok(filterGlossary(glossary, 'PID', '导航与运动安全', categories).every((term) => term.category === '导航与运动安全'));
    assert.equal(isSafeInternalPath('/blog/ros2-systematic-debugging/'), true);
    assert.equal(isSafeInternalPath('//example.com/'), false);
    assert.equal(isSafeInternalPath('/\\example.com/'), false);

    const escaped = safeJsonForScript({ value: '</script><script>alert(1)</script>&' });
    assert.doesNotMatch(escaped, /<\/script>/i);
    assert.match(escaped, /\\u003c\/script\\u003e/);

    assert.throws(() => validateGlossary([{
      id: 'unsafe id', term: 'x', category: 'x', summary: 'x',
    }]));
    assert.throws(() => validateGlossary([{
      id: 'safe', term: 'x', category: 'x', summary: 'x', related: ['missing'],
    }]));
    assert.throws(() => validateGlossary([{
      id: 'safe', term: 'x', category: 'x', summary: 'x', articleRefs: ['//example.com/'],
    }]));
  });
});

describe('Escaping helpers', () => {
  it('escapes HTML and RSS XML exactly once', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    assert.equal(escapeHtml('"quotes"'), '&quot;quotes&quot;');
    assert.equal(escapeXml('R&D "quoted"'), 'R&amp;D &quot;quoted&quot;');
  });
});
describe('Generated output and deployment configuration', () => {
  it('rebuilds clean output with valid JSON-LD and only hashed CSS', async (t) => {
    const testRoot = createTestBuildRoot();
    const DIST = path.join(testRoot, 'dist-build');
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
    const staleFile = path.join(DIST, 'legacy-stale-page.html');
    fs.mkdirSync(DIST, { recursive: true });
    fs.writeFileSync(staleFile, 'stale output', 'utf8');

    const { buildSite, createSearchIndex, generateJsonLd, head } = await import('../build.mjs');
    const metadata = head('Example', 'Description', {
      type: 'article',
      pageUrl: '/blog/example/',
      jsonLd: [
        generateJsonLd('blogpost', {
          title: 'Example',
          description: 'Description',
          pubDate: '2026-08-03',
          url: 'https://mostarmanus.ink/blog/example/',
        }),
        generateJsonLd('breadcrumb', {
          items: [{ name: 'Example', url: 'https://mostarmanus.ink/blog/example/' }],
        }),
      ],
    });
    const metadataBlocks = [...metadata.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.equal(metadataBlocks.length, 2);
    assert.equal(JSON.parse(metadataBlocks[0][1])['@type'], 'BlogPosting');
    assert.equal(JSON.parse(metadataBlocks[1][1])['@type'], 'BreadcrumbList');

    buildSite({ distDir: DIST, tmpRoot: testRoot });

    assert.equal(fs.existsSync(staleFile), false, 'old output must not survive a build');
    assert.equal(fs.existsSync(path.join(DIST, 'styles', 'global.css')), false);
    const hashedCss = fs.readdirSync(path.join(DIST, 'assets')).filter((name) => /^global-[a-f0-9]{12}\.css$/.test(name));
    assert.equal(hashedCss.length, 1, 'only the current hashed stylesheet may be published');
    const clientAssets = fs.readdirSync(path.join(DIST, 'assets')).filter((name) => /^site-[A-Za-z0-9]+\.js$/.test(name));
    assert.equal(clientAssets.length, 1, 'one hashed React client bundle must be published');
    const termsAssets = fs.readdirSync(path.join(DIST, 'assets')).filter((name) => /^terms-[A-Za-z0-9]+\.js$/.test(name));
    assert.equal(termsAssets.length, 1, 'one hashed terms explorer bundle must be published');
    const sharedChunks = fs.readdirSync(path.join(DIST, 'assets')).filter((name) => /^chunk-[A-Za-z0-9]+\.js$/.test(name));
    assert.ok(sharedChunks.length >= 1, 'React client entries must share common runtime chunks');
    const siteBundle = fs.readFileSync(path.join(DIST, 'assets', clientAssets[0]), 'utf8');
    const termsBundle = fs.readFileSync(path.join(DIST, 'assets', termsAssets[0]), 'utf8');
    assert.ok(sharedChunks.some((chunk) => siteBundle.includes(`./${chunk}`) && termsBundle.includes(`./${chunk}`)),
      'site and terms must import the same shared runtime chunk');
    const searchIndex = JSON.parse(fs.readFileSync(path.join(DIST, 'search-index.json'), 'utf8'));
    assert.ok(searchIndex.some((item) => item.type === 'post' && item.href === '/blog/voice-link-constrained-motion/'));
    assert.ok(searchIndex.some((item) => item.type === 'term' && item.href === '/terms/#ros2'));
    assert.deepEqual(createSearchIndex(), searchIndex, 'published search index must match build data');

    const pages = [
      path.join(DIST, 'index.html'),
      ...fs.readdirSync(path.join(DIST, 'blog')).filter((entry) => entry !== 'index.html').map((slug) => path.join(DIST, 'blog', slug, 'index.html')),
      path.join(DIST, 'projects', 'robot-car', 'index.html'),
    ];
    for (const page of pages) {
      const blocks = [...fs.readFileSync(page, 'utf8').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      assert.ok(blocks.length >= 2, `${page} must include structured data`);
      for (const block of blocks) {
        assert.equal(JSON.parse(block[1])['@context'], 'https://schema.org');
      }
    }

    for (const file of ['rss.xml', 'sitemap.xml', 'robots.txt', 'og-image.png']) {
      assert.ok(fs.existsSync(path.join(DIST, file)), `${file} must be generated`);
    }

    const expectedPostSlugs = fs
      .readdirSync(path.join(SRC, 'content', 'blog'))
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => path.parse(entry).name)
      .sort();
    const blogEntries = fs.readdirSync(path.join(DIST, 'blog')).sort();
    assert.deepEqual(blogEntries, ['index.html', ...expectedPostSlugs].sort());

    const blogIndexHtml = fs.readFileSync(path.join(DIST, 'blog', 'index.html'), 'utf8');
    if (expectedPostSlugs.length) {
      assert.doesNotMatch(blogIndexHtml, /暂无公开笔记/);
      for (const slug of expectedPostSlugs) {
        assert.ok(fs.existsSync(path.join(DIST, 'blog', slug, 'index.html')));
      }
    } else {
      assert.match(blogIndexHtml, /暂无公开笔记/);
    }
    assert.deepEqual(
      [...blogIndexHtml.matchAll(/data-filter="([^"]+)"/g)].map((match) => match[1]),
      ['debug', 'learn', 'insight'],
      '博客页只应提供三个分类筛选按钮',
    );
    assert.doesNotMatch(blogIndexHtml, /data-filter="(?:all|clear)"/);
    assert.doesNotMatch(blogIndexHtml, /rx-tag-filter|data-tags?=|\/blog\/\?tag=/);
    assert.match(blogIndexHtml, /<details class="rx-filter-more">/);
    assert.match(blogIndexHtml, /<p>暂无更多筛选<\/p>/);

    const homeHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    assert.match(homeHtml, /<script src="\/agent-widget\.js" defer><\/script>/);
    assert.ok(fs.existsSync(path.join(DIST, 'agent-widget.js')), 'AI assistant widget must be published');
    assert.ok(fs.existsSync(path.join(DIST, 'agent-avatar.png')), 'AI assistant avatar must be published');
    for (const category of ['debug', 'learn', 'insight']) {
      assert.match(
        homeHtml,
        new RegExp('href="/blog/\\?cat=' + category + '"'),
        '首页应显示 ' + category + ' 分类入口',
      );
    }

    const projectArchitectureHtml = fs.readFileSync(path.join(DIST, 'projects', 'robot-car', 'index.html'), 'utf8');
    assert.match(projectArchitectureHtml, /class="architecture"/);
    assert.doesNotMatch(projectArchitectureHtml, /class="language-architecture"/);
    const articleHtml = fs.readFileSync(path.join(DIST, 'blog', 'voice-link-constrained-motion', 'index.html'), 'utf8');
    assert.match(articleHtml, /id="article-navigator-root"/);
    assert.match(articleHtml, /class="code-block"/);
    assert.match(articleHtml, /data-copy-code/);
    assert.match(articleHtml, /<h2 id="1-记录目的"/);
    assert.match(articleHtml, /<span class="tag">#[^<]+<\/span>/);
    assert.doesNotMatch(articleHtml, /<a class="tag" href="\/blog\/\?tag=/);
    for (const page of [
      path.join(DIST, 'index.html'),
      path.join(DIST, 'about', 'index.html'),
      path.join(DIST, 'friends', 'index.html'),
      path.join(DIST, 'projects', 'robot-car', 'index.html'),
    ]) {
      const html = fs.readFileSync(page, 'utf8');
      assert.doesNotMatch(html, /github\.com\/MostarManus|GitHub 整理中|源码仓库/);
      assert.doesNotMatch(html, /<div class="socials"><\/div>/);
      assert.doesNotMatch(html, /排错记录:具身智能机器人的|技术洞察:当大模型有了身体|从 PID 到具身智能|全国大学生智能汽车竞赛|某机器人创新设计大赛|AI Agent 应用挑战赛/);
    }
  });

  it('targets the Caddy container mount and keeps custom 404 responses real', () => {
    const caddyfile = fs.readFileSync(path.join(ROOT, 'Caddyfile.new'), 'utf8');
    assert.match(caddyfile, /root \* \/srv/);
    assert.match(fs.readFileSync(path.join(ROOT, 'src', 'config.mjs'), 'utf8'), /seoName: 'MostarManus'/);
    assert.match(caddyfile, /@html path_regexp html/);
    assert.match(caddyfile, /blog\|projects/);
    assert.match(caddyfile, /@not_found expression \{err\.status_code\} == 404/);
    assert.match(caddyfile, /rewrite @not_found \/404\.html/);
    assert.match(caddyfile, /handle_errors \{[\s\S]*?Strict-Transport-Security[\s\S]*?Permissions-Policy/);
    assert.doesNotMatch(caddyfile, /respond \* "Not Found" 404/);
  });

  it('uses an accessible foreground for the dark primary button', () => {
    const css = fs.readFileSync(path.join(ROOT, 'public', 'styles', 'global.css'), 'utf8');
    assert.match(css, /html\.dark \.btn-primary\s*\{[\s\S]*?color: var\(--text-inverse\) !important;/);
  });

  it('applies the saved theme before CSS and keeps the browser canvas theme-safe', async () => {
    const { head } = await import('../build.mjs');
    const html = head('Theme test', 'Theme test', { pageUrl: '/' });
    const css = fs.readFileSync(path.join(ROOT, 'public', 'styles', 'global.css'), 'utf8');
    const themeScriptIndex = html.indexOf("localStorage.getItem('theme')");
    const bootstrapStyleIndex = html.indexOf('id="theme-bootstrap"');
    const stylesheetIndex = html.indexOf('<link rel="stylesheet"');

    assert.match(html, /<meta name="color-scheme" content="light dark">/);
    assert.ok(themeScriptIndex >= 0, 'theme bootstrap script must exist');
    assert.ok(bootstrapStyleIndex > themeScriptIndex, 'critical canvas colors must follow the resolved theme class');
    assert.ok(stylesheetIndex > bootstrapStyleIndex, 'theme bootstrap must run before the main stylesheet');
    assert.doesNotMatch(html, /document\.documentElement\.style\.colorScheme/);
    assert.match(html, /html\{background:#faf8f5;color-scheme:light\}html\.dark\{background:#141210;color-scheme:dark\}/);
    assert.match(css, /html\s*\{[\s\S]*?background:\s*var\(--bg\);[\s\S]*?color-scheme:\s*light;/);
    assert.match(css, /html\.dark\s*\{[\s\S]*?background:\s*var\(--bg\);[\s\S]*?color-scheme:\s*dark;/);
    assert.match(css, /body\s*\{[\s\S]*?min-height:\s*100dvh;/);
  });

  it('keeps cross-document navigation opaque over a themed canvas', () => {
    const css = fs.readFileSync(path.join(ROOT, 'public', 'styles', 'global.css'), 'utf8');
    assert.match(css, /@view-transition\s*\{\s*navigation:\s*auto;/);
    assert.match(css, /::view-transition\s*\{\s*background:\s*var\(--bg\);/);
    assert.match(css, /::view-transition-old\(root\)\s*\{\s*animation:\s*none;/);
    assert.match(css, /::view-transition-new\(root\)[\s\S]*?page-navigation-enter var\(--duration-normal\) var\(--ease-out-expo\) backwards;/);
    assert.match(css, /@keyframes page-navigation-enter\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?translateY\(12px\);[\s\S]*?opacity:\s*1;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?::view-transition-old\(root\),[\s\S]*?::view-transition-new\(root\)[\s\S]*?animation:\s*none;/);
  });

  it('ships an early navigation gate and compatible module manifest for all seven sections', async (t) => {
    const testRoot = createTestBuildRoot();
    const DIST = path.join(testRoot, 'dist-build');
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
    const { buildSite } = await import('../build.mjs');
    buildSite({ distDir: DIST, tmpRoot: testRoot });
    const routes = ['/', '/blog/', '/projects/', '/about/', '/friends/', '/terms/', '/jobs/'];
    let version;
    for (const route of routes) {
      const html = fs.readFileSync(path.join(DIST, route.slice(1), 'index.html'), 'utf8');
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const manifest = JSON.parse(doc.getElementById('site-navigation-data').textContent);
      version ||= manifest.version;
      assert.match(version, /^[a-f0-9]{16}$/);
      assert.equal(manifest.version, version);
      assert.deepEqual(Object.keys(manifest.routes).sort(), [...routes].sort());
      for (const modules of Object.values(manifest.routes)) {
        for (const module of modules) {
          assert.match(module, /^\/assets\/(?:terms|jobs)-[A-Z0-9]+\.js$/);
          assert.ok(fs.existsSync(path.join(DIST, module.slice(1))));
          assert.ok(manifest.preloads[module].includes(module));
          for (const dependency of manifest.preloads[module]) {
            assert.match(dependency, /^\/assets\/(?:terms|jobs|chunk)-[A-Z0-9]+\.js$/);
            assert.ok(fs.existsSync(path.join(DIST, dependency.slice(1))));
          }
        }
      }
      assert.ok(html.indexOf('function installNavigationGate') < html.indexOf('<link rel="stylesheet"'));
      assert.equal(doc.querySelector('main').dataset.pagePath, route);
      assert.equal(doc.querySelectorAll('main script:not([type="application/json"])').length, 0);
      assert.match(html, /src="\/assets\/navigation-[A-Z0-9]+\.js"/);
      dom.window.close();
    }
    const css = fs.readFileSync(path.join(ROOT, 'public/styles/global.css'), 'utf8');
    assert.match(css, /\.page-content-enter\s*\{\s*animation: page-navigation-enter var\(--duration-normal\) var\(--ease-out-expo\) backwards;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.page-content-enter \{ animation: none;/);
  });

  it('guards theme switching from animating the whole page', () => {
    const buildSource = fs.readFileSync(path.join(ROOT, 'src', 'build.mjs'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'public', 'styles', 'global.css'), 'utf8');
    assert.match(buildSource, /classList\.add\('theme-switching'\)/);
    assert.match(buildSource, /requestAnimationFrame\(function\(\)\{requestAnimationFrame\(/);
    assert.match(buildSource, /classList\.remove\('theme-switching'\)/);
    assert.match(css, /html\.theme-switching \.card,[\s\S]*?html\.theme-switching \.rx-cat\s*\{[\s\S]*?transition:\s*none\s*!important;/);
    assert.doesNotMatch(css, /html\.theme-switching \*\s*\{/);
    assert.match(css, /html\.theme-switching \.rx-hero-aura,[\s\S]*?html\.theme-switching \.btn-primary\s*\{[\s\S]*?animation-play-state:\s*paused\s*!important;/);
    assert.doesNotMatch(css, /html\.theme-switching body::before[\s\S]*?display:\s*none/);
  });

  it('keeps theme-sensitive interactions on explicit CSS transitions', () => {
    const css = fs.readFileSync(path.join(ROOT, 'public', 'styles', 'global.css'), 'utf8');
    const cardBlock = css.match(/\.card\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const termsCategoriesBlock = css.match(/\.terms-cats button\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    assert.doesNotMatch(cardBlock, /transition:\s*all\b/);
    assert.doesNotMatch(termsCategoriesBlock, /transition:\s*all\b/);
    assert.match(cardBlock, /transition:\s*transform/);
    assert.match(termsCategoriesBlock, /transition:\s*background-color/);
  });

  it('keeps the mobile blog filter from covering post cards', () => {
    const css = fs.readFileSync(path.join(ROOT, 'public', 'styles', 'global.css'), 'utf8');
    const filterBlock = [...css.matchAll(/@media\s*\(max-width:\s*768px\)/g)]
      .map((match) => extractCssBlock(css.slice(match.index), /^@media\s*\(max-width:\s*768px\)/)?.body.match(/\.rx-filter-bar\s*\{([^}]*)\}/)?.[1])
      .find(Boolean) ?? '';
    assert.ok(filterBlock, 'mobile filter CSS block must exist');
    assert.match(filterBlock, /position:\s*static/, 'mobile filter must stay in normal document flow');
    assert.match(filterBlock, /z-index:\s*auto/, 'mobile filter must not stack above post cards');
    assert.match(filterBlock, /backdrop-filter:\s*none/, 'mobile filter must not create an opaque overlay');
  });
});

describe('Blog filter interaction', () => {
  let testRoot;
  let blogHtml;

  before(async () => {
    testRoot = createTestBuildRoot();
    const { buildSite } = await import('../build.mjs');
    buildSite({ distDir: path.join(testRoot, 'dist-build'), tmpRoot: testRoot });
    blogHtml = fs.readFileSync(path.join(testRoot, 'dist-build', 'blog', 'index.html'), 'utf8');
  });

  after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

  function createBlogDom(search = '') {
    const dom = new JSDOM(blogHtml, {
      url: `https://mostarmanus.ink/blog/${search}`,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.console.warn = () => {};
        window.matchMedia = () => ({
          matches: false,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
        });
        window.IntersectionObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
      },
    });
    mountBlog(dom.window.document.querySelector('main'), dom.window);
    return dom;
  }

  function visibleCards(dom) {
    return [...dom.window.document.querySelectorAll('#post-grid .card')]
      .filter((card) => card.style.display !== 'none');
  }

  function categoryCards(dom, category) {
    return visibleCards(dom).filter((card) => card.getAttribute('data-cat') === category);
  }

  function waitForPopState(dom) {
    return new Promise((resolve) => dom.window.addEventListener('popstate', resolve, { once: true }));
  }

  it('shows all posts initially, filters by category, and clears a selected category on repeat click', () => {
    const dom = createBlogDom();
    const { document, location } = dom.window;
    const debugButton = document.querySelector('[data-filter="debug"]');
    const total = visibleCards(dom).length;

    assert.equal(total, document.querySelectorAll('#post-grid .card').length);
    assert.ok([...document.querySelectorAll('#filters button')].every((button) => button.getAttribute('aria-pressed') === 'false'));

    debugButton.click();
    assert.equal(location.search, '?cat=debug');
    assert.equal(visibleCards(dom).length, categoryCards(dom, 'debug').length);
    assert.equal(debugButton.getAttribute('aria-pressed'), 'true');

    debugButton.click();
    assert.equal(location.pathname + location.search, '/blog/');
    assert.equal(visibleCards(dom).length, total);
    assert.equal(debugButton.getAttribute('aria-pressed'), 'false');
  });

  it('normalizes legacy tags and invalid categories while retaining a valid category', () => {
    const validCategoryDom = createBlogDom('?cat=debug&tag=PID');
    assert.equal(validCategoryDom.window.location.search, '?cat=debug');
    assert.equal(visibleCards(validCategoryDom).length, categoryCards(validCategoryDom, 'debug').length);

    const invalidCategoryDom = createBlogDom('?cat=unknown&tag=PID');
    assert.equal(invalidCategoryDom.window.location.pathname + invalidCategoryDom.window.location.search, '/blog/');
    assert.equal(visibleCards(invalidCategoryDom).length, invalidCategoryDom.window.document.querySelectorAll('#post-grid .card').length);

    const tagOnlyDom = createBlogDom('?tag=PID');
    assert.equal(tagOnlyDom.window.location.pathname + tagOnlyDom.window.location.search, '/blog/');
  });

  it('restores category state after browser back, forward, and popstate navigation', async () => {
    const dom = createBlogDom();
    const { document, history, location } = dom.window;
    document.querySelector('[data-filter="debug"]').click();
    document.querySelector('[data-filter="learn"]').click();

    const back = waitForPopState(dom);
    history.back();
    await back;
    assert.equal(location.search, '?cat=debug');
    assert.equal(visibleCards(dom).length, categoryCards(dom, 'debug').length);

    const forward = waitForPopState(dom);
    history.forward();
    await forward;
    assert.equal(location.search, '?cat=learn');
    assert.equal(visibleCards(dom).length, categoryCards(dom, 'learn').length);

    history.pushState({}, '', '/blog/?cat=insight&tag=legacy');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    assert.equal(location.search, '?cat=insight');
    assert.equal(visibleCards(dom).length, categoryCards(dom, 'insight').length);
  });

  it('keeps the native more control collapsed until opened', () => {
    const dom = createBlogDom();
    const more = dom.window.document.querySelector('details.rx-filter-more');

    assert.equal(more.open, false);
    assert.equal(more.querySelector('.rx-filter-more-open').textContent, '展开');
    assert.equal(more.querySelector('.rx-filter-more-close').textContent, '收起');
    assert.equal(more.querySelector('p').textContent, '暂无更多筛选');

    more.open = true;
    assert.equal(more.open, true);
  });
});

describe('Glossary data validation', () => {
  let glossaryData;

  it('loads and validates glossary.json structure', () => {
    const glossaryPath = path.join(SRC, 'data', 'glossary.json');
    assert.ok(fs.existsSync(glossaryPath), 'glossary.json must exist');
    glossaryData = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
    assert.ok(Array.isArray(glossaryData), 'glossary.json must be an array');
    assert.ok(glossaryData.length >= 24, `must have at least 24 terms, got ${glossaryData.length}`);
  });

  it('validates all required fields and unique IDs', () => {
    const ids = new Set();
    for (const term of glossaryData) {
      // Required fields
      assert.ok(term.id && typeof term.id === 'string', `${term.id || '?'}: id must be a non-empty string`);
      assert.ok(term.term && typeof term.term === 'string', `${term.id}: term is required`);
      assert.ok(term.category && typeof term.category === 'string', `${term.id}: category is required`);
      assert.ok(term.summary && typeof term.summary === 'string', `${term.id}: summary is required`);

      // ID uniqueness
      assert.ok(!ids.has(term.id), `duplicate id: ${term.id}`);
      ids.add(term.id);

      // URL-safe ID
      assert.match(term.id, /^[a-z0-9_-]+$/, `${term.id}: id must be URL-safe`);

      // No U+FFFD replacement characters
      assert.doesNotMatch(JSON.stringify(term), /\uFFFD/, `${term.id}: contains replacement character U+FFFD`);
    }
  });

  it('validates related references point to existing IDs', () => {
    const validIds = new Set(glossaryData.map(t => t.id));
    for (const term of glossaryData) {
      if (Array.isArray(term.related)) {
        for (const ref of term.related) {
          assert.ok(validIds.has(ref), `${term.id}: references unknown related id "${ref}"`);
        }
      }
    }
  });

  it('validates articleRefs contain only safe relative paths', () => {
    for (const term of glossaryData) {
      if (Array.isArray(term.articleRefs)) {
        for (const ref of term.articleRefs) {
          assert.match(ref, /^\//, `${term.id}: articleRef "${ref}" must start with /`);
          assert.doesNotMatch(ref, /^\/\//, `${term.id}: articleRef "${ref}" must not be protocol-relative`);
          assert.doesNotMatch(ref, /[<>"]/, `${term.id}: articleRef "${ref}" contains unsafe chars`);
        }
      }
    }
  });

  it('covers all required categories', () => {
    const categories = [...new Set(glossaryData.map(t => t.category))];
    const requiredCategories = ['ROS 2 基础', '坐标、定位与建图', '导航与运动安全', '语音与智能体', '开发与配置'];
    for (const reqCat of requiredCategories) {
      assert.ok(categories.includes(reqCat), `missing required category: ${reqCat}`);
    }
  });

  it('has balanced distribution across categories', () => {
    const catCounts = {};
    for (const term of glossaryData) {
      catCounts[term.category] = (catCounts[term.category] || 0) + 1;
    }
    // Each category should have at least 2 terms
    for (const [cat, count] of Object.entries(catCounts)) {
      assert.ok(count >= 2, `category "${cat}" has only ${count} term(s), need at least 2`);
    }
  });

  it('includes the core autonomy and agent-safety term extension', () => {
    const expectedTerms = new Map([
      ['qos', 'ROS 2 基础'],
      ['lifecycle_node', 'ROS 2 基础'],
      ['pose', '坐标、定位与建图'],
      ['imu', '坐标、定位与建图'],
      ['encoder', '坐标、定位与建图'],
      ['occupancy_grid', '坐标、定位与建图'],
      ['map_server', '导航与运动安全'],
      ['controller_server', '导航与运动安全'],
      ['waypoint_follower', '导航与运动安全'],
      ['navigate_to_pose', '导航与运动安全'],
      ['velocity_safety', '导航与运动安全'],
      ['planning_dry_run', '导航与运动安全'],
      ['wake_word', '语音与智能体'],
      ['conversation_state_machine', '语音与智能体'],
      ['action_allowlist', '语音与智能体'],
      ['function_calling', '语音与智能体'],
    ]);
    const glossaryById = new Map(glossaryData.map((term) => [term.id, term]));

    assert.equal(glossaryData.length, 46, 'the first core extension should add sixteen terms');
    for (const [id, category] of expectedTerms) {
      const term = glossaryById.get(id);
      assert.ok(term, `missing core glossary term: ${id}`);
      assert.equal(term.category, category, `${id}: unexpected category`);
      assert.ok(term.aliases.length > 0, `${id}: must provide searchable aliases`);
      assert.ok(term.details.length >= 3, `${id}: must provide useful details`);
      assert.ok(term.related.length > 0, `${id}: must link to related terms`);
    }
  });
});

describe('Glossary search and filter logic', () => {
  const glossaryData = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'glossary.json'), 'utf8'));
  const categories = new Set(glossaryData.map((term) => term.category));

  it('places direct term-name matches before related summary-only matches', () => {
    const groups = groupGlossarySearchResults(glossaryData, 'ROS', 'all', categories);

    assert.equal(groups.isSearch, true);
    assert.equal(groups.strongest[0]?.id, 'ros2', 'exact ROS 2 term must rank first');
    assert.ok(groups.strongest.length > 0, 'ROS should have direct name matches');
    assert.ok(groups.related.length > 0, 'ROS should also have summary-only related content');
    assert.ok(groups.strongest.every((term) => Number.isFinite(getTermNameMatchRank(term, 'ROS'))));
    assert.ok(groups.related.every((term) => matchesGlossaryRelatedContent(term, 'ROS')));
    assert.ok(groups.related.every((term) => !groups.strongest.some((strongest) => strongest.id === term.id)));
    assert.ok(groups.related.some((term) => term.id === 'yaml'), 'summary-only ROS content must move after direct matches');
  });

  it('treats English full names and aliases as term-name matches', () => {
    const fullNameGroups = groupGlossarySearchResults(glossaryData, 'Monte Carlo', 'all', categories);
    const aliasGroups = groupGlossarySearchResults(glossaryData, '语音活动检测', 'all', categories);

    assert.ok(fullNameGroups.strongest.some((term) => term.id === 'amcl'));
    assert.ok(aliasGroups.strongest.some((term) => term.id === 'vad'));
  });

  it('finds core extension terms through practical multiword aliases without polluting ROS summaries', () => {
    const expectedMatches = [
      ['Quality of Service', 'qos'],
      ['map server', 'map_server'],
      ['Navigate To Pose', 'navigate_to_pose'],
      ['twist_mux', 'velocity_safety'],
      ['dry run', 'planning_dry_run'],
      ['Function Calling', 'function_calling'],
    ];

    for (const [query, id] of expectedMatches) {
      const groups = groupGlossarySearchResults(glossaryData, query, 'all', categories);
      assert.ok(groups.strongest.some((term) => term.id === id), `${query} should directly find ${id}`);
    }

    const rosGroups = groupGlossarySearchResults(glossaryData, 'ROS', 'all', categories);
    assert.equal(rosGroups.strongest[0]?.id, 'ros2');
    assert.ok(!rosGroups.related.some((term) => term.id === 'qos' || term.id === 'lifecycle_node'), 'generic ROS summaries should not flood related content');
  });

  it('shows summary-only matches in the related-content group', () => {
    const groups = groupGlossarySearchResults(glossaryData, '粒子滤波', 'all', categories);

    assert.equal(groups.strongest.length, 0);
    assert.ok(groups.related.some((term) => term.id === 'amcl'));
  });

  it('keeps category filtering as an AND condition without searching category labels', () => {
    const groups = groupGlossarySearchResults(glossaryData, 'PID', '导航与运动安全', categories);

    assert.ok(groups.results.length > 0);
    assert.ok(groups.results.every((term) => term.category === '导航与运动安全'));
    assert.ok(groups.strongest.some((term) => term.id === 'pid'));
  });

  it('keeps the normal category list ungrouped and paginatable when no search is entered', () => {
    const groups = groupGlossarySearchResults(glossaryData, '', '导航与运动安全', categories);

    assert.equal(groups.isSearch, false);
    assert.equal(groups.strongest.length, 0);
    assert.equal(groups.related.length, 0);
    assert.ok(groups.results.every((term) => term.category === '导航与运动安全'));
    assert.deepEqual(filterGlossary(glossaryData, '', '导航与运动安全', categories), groups.results);
  });

  it('returns no result for an unrelated query and safely falls back from unknown categories', () => {
    const noResults = groupGlossarySearchResults(glossaryData, 'zzz_nonexistent_term_xyz', 'all', categories);
    const fallback = groupGlossarySearchResults(glossaryData, '', 'nonexistent_category', categories);

    assert.equal(noResults.results.length, 0);
    assert.equal(fallback.state.category, 'all');
    assert.equal(fallback.results.length, glossaryData.length);
  });
});

describe('Terms page build output', () => {
  let termsBuildRoot;
  let termsDist;

  before(async () => {
    termsBuildRoot = createTestBuildRoot();
    termsDist = path.join(termsBuildRoot, 'dist-build');
    const { buildSite } = await import('../build.mjs');
    buildSite({ distDir: termsDist, tmpRoot: termsBuildRoot });
  });

  after(() => fs.rmSync(termsBuildRoot, { recursive: true, force: true }));

  it('generates terms/index.html with valid structure', async () => {
    const termsPath = path.join(termsDist, 'terms', 'index.html');
    assert.ok(fs.existsSync(termsPath), 'terms/index.html must exist');

    const html = fs.readFileSync(termsPath, 'utf8');

    // Page title and heading
    assert.match(html, /专业术语/);
    assert.match(html, /<h1[^>]*>专业术语<\/h1>/);

    // Search input
    assert.match(html, /id="terms-search"/);
    assert.match(html, /type="search"/);
    assert.match(html, /for="terms-search"/);
    assert.match(html, /class="terms-search-label"/);

    // Category buttons
    assert.match(html, /id="terms-categories"/);
    assert.match(html, /aria-label="按分类筛选"/);
    assert.match(html, /data-category="all"/);
    assert.match(html, /aria-pressed/);
    assert.match(html, /aria-controls="terms-results"/);

    // ARIA live region
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /id="terms-count"/);

    // Empty state
    assert.match(html, /id="terms-empty"/);
    assert.match(html, /id="terms-clear-btn"/);

    // Search result groups retain one stable card set while clarifying relevance.
    assert.match(html, /id="terms-results"/);
    assert.match(html, /id="terms-primary-section"/);
    assert.match(html, /最强相关术语/);
    assert.match(html, /id="terms-related-section"/);
    assert.match(html, /相关内容/);
    assert.match(html, /id="terms-search-hint"/);

    // Pagination navigation
    assert.match(html, /id="terms-pagination"/);
    assert.match(html, /aria-label="术语分页"/);

    // Term cards
    assert.match(html, /class="term-card"/);
    assert.match(html, /<article/);
    assert.match(html, /<h2 class="term-name">/);

    // Details/summary for expandable content
    assert.match(html, /<details class="term-details">/);

    // No U+FFFD characters
    assert.doesNotMatch(html, /\uFFFD/, 'output must not contain replacement character');

    // Island contracts: JSON data island + module entry, no executable glossary IIFE
    assert.match(html, /id="terms-data"\s+type="application\/json"/, 'must expose terms data as JSON');
    assert.doesNotMatch(html, /var glossaryData\s*=/, 'must not embed glossary as executable JS');
    assert.doesNotMatch(html, /getCompactPaginationItems\.toString/, 'must not weave pagination helpers into the page');
    const termsDataMatch = html.match(/<script id="terms-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(termsDataMatch, 'terms-data payload must exist');
    const termsData = JSON.parse(termsDataMatch[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));
    assert.ok(Array.isArray(termsData.terms) && termsData.terms.length > 0);
    assert.ok(Array.isArray(termsData.categories) && termsData.categories.length > 0);
    assert.equal(termsData.perPage, TERMS_PER_PAGE);
    assert.match(html, /id="terms-explorer-root"/);
    assert.match(html, /"\/terms\/":\["\/assets\/terms-[A-Za-z0-9]+\.js"\]/, 'manifest must load the hashed terms island bundle');
  });

  it('uses ten-item client pagination with accessible controls and stable URLs', () => {
    const termsHtml = fs.readFileSync(path.join(termsDist, 'terms', 'index.html'), 'utf8');
    const glossary = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'glossary.json'), 'utf8'));
    const pageSize = TERMS_PER_PAGE;
    const pageSizes = Array.from(
      { length: Math.ceil(glossary.length / pageSize) },
      (_, index) => glossary.slice(index * pageSize, (index + 1) * pageSize).length,
    );
    assert.ok(pageSizes.length >= 1, 'glossary must produce at least one page');
    assert.ok(pageSizes.every((size) => size > 0 && size <= pageSize), 'each page must contain no more than ten terms');
    assert.equal(pageSizes.reduce((total, size) => total + size, 0), glossary.length, 'pagination must retain every term');

    // Structural shell remains for no-JS and for the island to take over.
    assert.match(termsHtml, /id="terms-pagination"/);
    assert.match(termsHtml, /aria-label="术语分页"/);
    assert.match(termsHtml, /id="terms-results"/);
    assert.doesNotMatch(termsHtml, /function renderPagination\(totalPages\)/, 'pagination must not live in an inline IIFE');

    // URL and pagination contracts on pure helpers used by the island.
    assert.equal(TERMS_PER_PAGE, 10);
    assert.deepEqual(parsePageParam(null), { page: 1, normalized: false });
    assert.deepEqual(parsePageParam('1'), { page: 1, normalized: true });
    assert.deepEqual(parsePageParam('3'), { page: 3, normalized: false });
    assert.deepEqual(parsePageParam('abc'), { page: 1, normalized: true });
    assert.equal(termsTotalPages(0, 10), 1);
    assert.equal(termsTotalPages(10, 10), 1);
    assert.equal(termsTotalPages(11, 10), 2);
    assert.equal(buildTermsUrl({ query: '', category: 'all', page: 1, isSearch: false }), '/terms/');
    assert.equal(buildTermsUrl({ query: 'ROS', category: 'all', page: 1, isSearch: true }), '/terms/?q=ROS');
    assert.equal(buildTermsUrl({ query: '', category: '导航与运动安全', page: 2, isSearch: false }), '/terms/?category=%E5%AF%BC%E8%88%AA%E4%B8%8E%E8%BF%90%E5%8A%A8%E5%AE%89%E5%85%A8&page=2');
    assert.equal(buildTermsUrl({ query: '', category: 'all', page: 1, isSearch: false, termId: 'ros2' }), '/terms/#ros2');
    assert.equal(buildTermsUrl({ query: 'PID', category: 'all', page: 1, isSearch: true, termId: 'pid' }), '/terms/?q=PID#pid');

    // Compact pagination keeps last page dynamic for the jump control.
    const items = getCompactPaginationItems(10, 20);
    assert.equal(items[items.length - 1], 20);
    assert.equal(parsePaginationJump('0', 5), null);
    assert.equal(parsePaginationJump('6', 5), null);
    assert.equal(parsePaginationJump('3', 5), 3);

    // Search mode never paginates grouped results (totalPages 0 → hidden pager).
    assert.equal(formatTermsCountText({ isSearch: true, strongest: [1], related: [2], results: [1, 2] }), '找到 2 个结果：1 个术语名匹配，1 个相关内容');
    assert.equal(formatTermsCountText({ isSearch: true, strongest: [], related: [], results: [] }), '无匹配结果');
    assert.equal(
      formatTermsCountText({ isSearch: false, results: Array.from({ length: 12 }, (_, i) => i), page: 99, totalPages: 2, perPage: 10 }),
      '显示 11–12 / 共 12 个术语，第 2 / 2 页',
    );
  });

  it('styles pagination for touch, themes, and narrow screens', () => {
    const assetsDir = path.join(termsDist, 'assets');
    const cssFiles = fs.readdirSync(assetsDir).filter((name) => /^global-[a-f0-9]+\.css$/.test(name));
    assert.equal(cssFiles.length, 1);
    const css = fs.readFileSync(path.join(assetsDir, cssFiles[0]), 'utf8');
    const paginationBlock = css.match(/\.terms-pagination\s*\{([^}]*)\}/)?.[1] ?? '';
    const buttonBlock = css.match(/\.terms-page-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    const jumpBlock = css.match(/\.terms-page-jump\s*\{([^}]*)\}/)?.[1] ?? '';
    const jumpInputBlock = css.match(/\.terms-page-jump-input\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(paginationBlock, /flex-wrap:\s*wrap/, 'pagination must wrap rather than overflow on narrow screens');
    assert.match(paginationBlock, /gap:\s*8px/, 'pagination touch targets need safe spacing');
    assert.match(paginationBlock, /max-width:\s*100%/, 'pagination must not exceed its container');
    assert.match(buttonBlock, /min-width:\s*44px/, 'page buttons must meet the 44px touch target width');
    assert.match(buttonBlock, /min-height:\s*44px/, 'page buttons must meet the 44px touch target height');
    assert.match(css, /\.terms-page-ellipsis\s*\{[^}]*min-height:\s*44px/, 'ellipsis must align with the page controls');
    assert.match(jumpBlock, /display:\s*inline-flex/, 'page jump controls must remain grouped while the outer pager wraps');
    assert.match(jumpBlock, /max-width:\s*100%/, 'page jump group must stay inside narrow viewports');
    assert.match(jumpInputBlock, /min-width:\s*52px/, 'page input must remain comfortably touchable');
    assert.match(jumpInputBlock, /min-height:\s*44px/, 'page input must meet the 44px touch target height');
    assert.match(css, /\.terms-page-jump-input:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/, 'page input must have a visible keyboard focus state');
    assert.match(css, /\.terms-page-jump-input\[aria-invalid="true"\]\s*\{[^}]*border-color:\s*var\(--accent\)/, 'invalid page input must receive a visible state');
    assert.match(css, /@media\s*\(max-width:\s*400px\)[\s\S]*?\.terms-pagination\s*\{[^}]*gap:\s*6px/, 'narrow pagination must compact spacing without hiding overflow');
    assert.match(css, /\.terms-page-btn\[aria-current="page"\]\s*\{[^}]*color:\s*var\(--text-inverse\)/, 'current page must use the semantic inverse text color');
    assert.match(css, /\.terms-grid\s*\{[^}]*scroll-margin-top:\s*var\(--scroll-offset/, 'page changes must keep the list below the sticky header');
    assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/, 'HTML hidden state must override component display styles');
    assert.match(css, /\.terms-search-hint\s*\{[^}]*color:\s*var\(--text-mute\)/, 'search priority guidance must use semantic muted text');
    assert.match(css, /\.terms-search-section \+ \.terms-search-section\s*\{[^}]*border-top:\s*1px solid var\(--border\)/, 'related content must be visually separated after direct matches');
    assert.match(css, /\.terms-search-section-title\s*\{[^}]*font-family:\s*var\(--font-serif\)/, 'result group headings must follow the established editorial hierarchy');
  });

  it('includes terms page in navigation with aria-current', async () => {
    const termsHtml = fs.readFileSync(path.join(termsDist, 'terms', 'index.html'), 'utf8');
    assert.match(termsHtml, /href="\/terms\/"[^>]*aria-current="page"/, 'terms link must have aria-current="page"');
  });

  it('keeps primary theme control touch-friendly', async () => {
    const assetsDir = path.join(termsDist, 'assets');
    const cssFiles = fs.readdirSync(assetsDir).filter((name) => /^global-[a-f0-9]+\.css$/.test(name));
    assert.equal(cssFiles.length, 1, 'build must contain one hashed global stylesheet');
    const css = fs.readFileSync(path.join(assetsDir, cssFiles[0]), 'utf8');
    const themeBlock = css.match(/\.theme-toggle\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    assert.match(themeBlock, /width:\s*44px/, 'theme toggle width must meet the 44px touch target');
    assert.match(themeBlock, /height:\s*44px/, 'theme toggle height must meet the 44px touch target');
    assert.match(themeBlock, /touch-action:\s*manipulation/, 'theme toggle must use touch-action: manipulation');
  });

  it('prevents sticky theme hover transforms on touch devices', async () => {
    const assetsDir = path.join(termsDist, 'assets');
    const cssFiles = fs.readdirSync(assetsDir).filter((name) => /^global-[a-f0-9]+\.css$/.test(name));
    assert.equal(cssFiles.length, 1, 'build must contain one hashed global stylesheet');
    const css = fs.readFileSync(path.join(assetsDir, cssFiles[0]), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const finePointerBlock = extractCssBlock(
      css,
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/,
    );
    const reducedMotionBlock = extractCssBlock(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);

    assert.ok(finePointerBlock, 'theme hover effects must be scoped to hover-capable fine pointers');
    assert.match(
      finePointerBlock.body,
      /\.theme-toggle:hover\s*\{[^}]*transform:\s*rotate\(15deg\)\s*scale\(1\.05\)/,
      'desktop hover motion must be preserved',
    );
    assert.ok(reducedMotionBlock, 'reduced-motion media query must exist');
    assert.match(
      reducedMotionBlock.body,
      /\.theme-toggle:hover\s*,\s*\.theme-toggle:active\s*\{[^}]*transform:\s*none/,
      'reduced-motion mode must disable theme hover and active transforms',
    );

    const cssWithoutAllowedThemeHover = css
      .replace(finePointerBlock.full, '')
      .replace(reducedMotionBlock.full, '');
    assert.doesNotMatch(
      cssWithoutAllowedThemeHover,
      /\.theme-toggle:hover\b/,
      'theme hover styling must not exist outside the allowed media queries',
    );

    const activeBlock = css.match(/\.theme-toggle:active\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(activeBlock, /transform:\s*scale\(0\.96\)/, 'touch press feedback must use a subtle scale');
    assert.doesNotMatch(activeBlock, /rotate\(/, 'touch press feedback must not rotate');
  });

  it('includes DefinedTermSet and BreadcrumbList JSON-LD', async () => {
    const termsHtml = fs.readFileSync(path.join(termsDist, 'terms', 'index.html'), 'utf8');
    const jsonLdBlocks = [...termsHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(jsonLdBlocks.length >= 2, 'must have at least 2 JSON-LD blocks');

    const types = jsonLdBlocks.map(b => JSON.parse(b[1])['@type']);
    assert.ok(types.includes('DefinedTermSet'), 'must include DefinedTermSet');
    assert.ok(types.includes('BreadcrumbList'), 'must include BreadcrumbList');

    // Validate all JSON-LD is parseable
    for (const block of jsonLdBlocks) {
      assert.doesNotThrow(() => JSON.parse(block[1]), 'each JSON-LD block must be valid JSON');
    }
  });

  it('includes /terms/ in sitemap', async () => {
    const sitemapXml = fs.readFileSync(path.join(termsDist, 'sitemap.xml'), 'utf8');
    assert.match(sitemapXml, /mostarmanus\.ink\/terms\//, 'sitemap must include /terms/');
  });

  it('includes /terms/ in Caddy HTML cache rule', () => {
    const caddyfile = fs.readFileSync(path.join(ROOT, 'Caddyfile.new'), 'utf8');
    assert.match(caddyfile, /terms/, 'Caddy HTML regex must include terms');
  });

  it('escapes user data in output HTML', async () => {
    const termsHtml = fs.readFileSync(path.join(termsDist, 'terms', 'index.html'), 'utf8');
    // Check no raw </script> in the inline script content (the filter script)
    const scriptMatch = termsHtml.match(/<script>\(function\(\)([\s\S]*)\)\(\);<\/script>/);
    if (scriptMatch) {
      assert.doesNotMatch(scriptMatch[1], /<\/script>/, 'inline script must not contain closing script tag');
    }
  });

  it('does not break existing pages after adding terms', async () => {
    // Verify existing pages still generate correctly
    for (const page of ['index.html', 'blog/index.html', 'projects/index.html', 'about/index.html', 'friends/index.html']) {
      assert.ok(fs.existsSync(path.join(termsDist, page)), `${page} must still exist`);
      const html = fs.readFileSync(path.join(termsDist, page), 'utf8');
      // Each page should have proper structure
      assert.match(html, /<html/, `${page} must be valid HTML`);
      assert.match(html, /<\/html>/, `${page} must close properly`);
    }
  });
});

describe('Anchor offset and hash target highlight', () => {
  let anchorBuildRoot;
  let anchorDist;

  before(async () => {
    anchorBuildRoot = createTestBuildRoot();
    anchorDist = path.join(anchorBuildRoot, 'dist-build');
    const { buildSite } = await import('../build.mjs');
    buildSite({ distDir: anchorDist, tmpRoot: anchorBuildRoot });
  });

  after(() => fs.rmSync(anchorBuildRoot, { recursive: true, force: true }));

  it('defines CSS custom properties for header height and scroll offset', async () => {
    const cssPath = path.join(anchorDist, 'assets');
    const cssFiles = fs.readdirSync(cssPath).filter((name) => /^global-[a-f0-9]+\.css$/.test(name));
    assert.equal(cssFiles.length, 1);
    const css = fs.readFileSync(path.join(cssPath, cssFiles[0]), 'utf8');
    assert.match(css, /--header-height:\s*65px/, 'must define --header-height default');
    assert.match(css, /--scroll-offset:\s*calc\(var\(--header-height\)\s*\+\s*8px\)/, 'must define --scroll-offset with gap');
  });

  it('sets scroll-margin-top on .term-card using CSS variable', async () => {
    const cssPath = path.join(anchorDist, 'assets');
    const cssFiles = fs.readdirSync(cssPath).filter((name) => /^global-[a-f0-9]+\.css$/.test(name));
    const css = fs.readFileSync(path.join(cssPath, cssFiles[0]), 'utf8');
    assert.match(css, /\.term-card\s*\{[^}]*scroll-margin-top:\s*var\(--scroll-offset/, '.term-card must use scroll-margin-top with variable');
  });

  it('uses only term-card scroll margin to avoid double anchor offsets', async () => {
    const cssPath = path.join(anchorDist, 'assets');
    const cssFiles = fs.readdirSync(cssPath).filter((name) => /^global-[a-f0-9]+\.css$/.test(name));
    const css = fs.readFileSync(path.join(cssPath, cssFiles[0]), 'utf8');
    assert.doesNotMatch(css, /scroll-padding-top:\s*var\(--scroll-offset/, 'must not combine root padding with card margin');
  });

  it('generates term cards with valid URL-safe IDs', async () => {
    const termsHtml = fs.readFileSync(path.join(anchorDist, 'terms', 'index.html'), 'utf8');
    const cardIds = [...termsHtml.matchAll(/<article class="term-card" id="([^"]+)"/g)];
    assert.ok(cardIds.length >= 24, `must have at least 24 term cards, got ${cardIds.length}`);
    for (const [, id] of cardIds) {
      assert.match(id, /^[a-z0-9_-]+$/, `term card id "${id}" must be URL-safe`);
    }
  });

  it('generates related links with #id format pointing to valid term IDs', async () => {
    const termsHtml = fs.readFileSync(path.join(anchorDist, 'terms', 'index.html'), 'utf8');
    const glossary = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'glossary.json'), 'utf8'));
    const validIds = new Set(glossary.map(t => t.id));

    const relatedLinks = [...termsHtml.matchAll(/<a href="#([^"]+)" class="term-link"/g)];
    assert.ok(relatedLinks.length > 0, 'must have at least one related link');

    for (const [, hash] of relatedLinks) {
      assert.ok(validIds.has(hash), `related link targets unknown id "${hash}"`);
    }
  });

  it('includes hash target highlight CSS classes and animation', async () => {
    const cssPath = path.join(anchorDist, 'assets');
    const cssFiles = fs.readdirSync(cssPath).filter((name) => /^global-[a-f0-9]+\.css$/.test(name));
    const css = fs.readFileSync(path.join(cssPath, cssFiles[0]), 'utf8');

    // Target class
    assert.match(css, /\.term-card--hash-target/, 'must define hash target class');

    // Animation keyframes
    assert.match(css, /@keyframes termHashPulse/, 'must define pulse animation');

    // Animation class
    assert.match(css, /\.term-card--hash-target\.animate-pulse/, 'must define animated pulse class');
    assert.match(css, /animation:\s*termHashPulse\s+1\.2s\s+ease-in-out\s+1\s*;/, 'pulse must finish within one 1.2s animation');

    // The single animation contains exactly two visible emphasis beats.
    const pulseFrames = css.match(/@keyframes termHashPulse\s*\{([\s\S]*?)\n\}\n\n\.term-card--hash-target\.animate-pulse/)?.[1] ?? '';
    const highlightedFrameSelectors = pulseFrames.match(/(?:^|\n)\s*([0-9.,%\s]+)\{\s*outline-color:\s*var\(--accent\)/)?.[1] ?? '';
    assert.equal((highlightedFrameSelectors.match(/%/g) ?? []).length, 2, 'pulse must have exactly two emphasis beats');

    // Uses outline/box-shadow only (no border-width/padding/transform changes)
    const targetBlock = css.match(/\.term-card--hash-target\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.doesNotMatch(targetBlock, /border-width|padding|transform/, 'highlight must not cause layout shift');
  });

  it('provides reduced-motion fallback for highlight animation', async () => {
    const cssPath = path.join(anchorDist, 'assets');
    const cssFiles = fs.readdirSync(cssPath).filter((name) => /^global-[a-f0-9]+\.css$/.test(name));
    const css = fs.readFileSync(path.join(cssPath, cssFiles[0]), 'utf8');
    assert.match(css, /@media.*prefers-reduced-motion:\s*reduce[\s\S]*?\.term-card--hash-target\.animate-pulse/, 'must handle reduced motion');
  });

  it('includes hash navigation contracts for the terms island', () => {
    const glossary = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'glossary.json'), 'utf8'));
    const categories = new Set(glossary.map((term) => term.category));
    const allGroups = groupGlossarySearchResults(glossary, '', 'all', categories);

    // Illegal / missing hashes
    assert.equal(termIdFromHash(''), '');
    assert.equal(termIdFromHash('#'), '');
    assert.equal(termIdFromHash('#%%%'), '');
    assert.equal(termIdFromHash('#Not Valid'), '');
    assert.equal(termIdFromHash('#ros2'), 'ros2');
    assert.equal(resolveHashTarget({ terms: glossary, filteredTerms: allGroups.results, termId: '#nope' }).status, 'missing');
    assert.equal(resolveHashTarget({ terms: glossary, filteredTerms: allGroups.results, termId: '' }).status, 'invalid');

    // Cross-page target resolves to the correct page
    const late = glossary[glossary.length - 1];
    const lateResolved = resolveHashTarget({
      terms: glossary,
      filteredTerms: allGroups.results,
      termId: late.id,
      isSearch: false,
      perPage: TERMS_PER_PAGE,
    });
    assert.equal(lateResolved.status, 'ok');
    assert.equal(lateResolved.targetPage, Math.floor(lateResolved.targetIndex / TERMS_PER_PAGE) + 1);

    // Filter-hidden target is distinguished from another-page target
    const filtered = groupGlossarySearchResults(glossary, 'zzz_unlikely', 'all', categories);
    const hidden = resolveHashTarget({
      terms: glossary,
      filteredTerms: filtered.results,
      termId: 'ros2',
      isSearch: false,
      perPage: TERMS_PER_PAGE,
    });
    assert.equal(hidden.status, 'hidden');

    // Search mode never paginates
    const searchGroups = groupGlossarySearchResults(glossary, 'ROS', 'all', categories);
    const searchHit = searchGroups.results[0];
    const searchResolved = resolveHashTarget({
      terms: glossary,
      filteredTerms: searchGroups.results,
      termId: searchHit.id,
      isSearch: true,
      perPage: TERMS_PER_PAGE,
    });
    assert.equal(searchResolved.status, 'ok');
    assert.equal(searchResolved.targetPage, 1);

    // URL builder preserves hash
    assert.equal(
      buildTermsUrl({ query: '', category: 'all', page: 1, isSearch: false, termId: 'ros2' }),
      '/terms/#ros2',
    );
  });

  it('loads the terms island only on the terms page', () => {
    const termsHtml = fs.readFileSync(path.join(anchorDist, 'terms', 'index.html'), 'utf8');
    const homeHtml = fs.readFileSync(path.join(anchorDist, 'index.html'), 'utf8');
    const blogHtml = fs.readFileSync(path.join(anchorDist, 'blog', 'index.html'), 'utf8');

    assert.match(termsHtml, /"\/terms\/":\["\/assets\/terms-[A-Za-z0-9]+\.js"\]/, 'manifest must load the terms island');
    assert.match(termsHtml, /src="\/assets\/site-[A-Za-z0-9]+\.js"/, 'terms page still loads global search');
    assert.doesNotMatch(homeHtml, /src="\/assets\/terms-/, 'home must not load terms island');
    assert.doesNotMatch(blogHtml, /src="\/assets\/terms-/, 'blog index must not load terms island');

    // Single history-writer URL contract: explicit term hash is preserved when filters change.
    assert.equal(
      buildTermsUrl({ query: 'PID', category: 'all', page: 1, isSearch: true, termId: 'pid' }),
      '/terms/?q=PID#pid',
    );
    assert.equal(
      buildTermsUrl({ query: '', category: 'all', page: 2, isSearch: false, termId: 'ros2' }),
      '/terms/?page=2#ros2',
    );

    // Pulse/highlight classes remain part of the CSS contract used by the island.
    const cssFiles = fs.readdirSync(path.join(anchorDist, 'assets')).filter((name) => /^global-[a-f0-9]+\.css$/.test(name));
    const css = fs.readFileSync(path.join(anchorDist, 'assets', cssFiles[0]), 'utf8');
    assert.match(css, /\.term-card--hash-target/);
    assert.match(css, /animate-pulse/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
  });

});

describe('Jobs data validation and URL helpers', () => {
  const fixture = () => ({
    dataAsOf: '2026-09-25',
    techStack: [
      { id: 'ros-ros2', rank: 1, name: 'ROS/ROS2', category: '机器人框架/库', count: 10, percent: 67, summary: '中间件。', related: ['cpp'] },
      { id: 'cpp', rank: 2, name: 'C++', category: '编程语言', count: 9, percent: 60, summary: '语言。', related: [] },
    ],
    positions: [
      {
        id: 'job-a', title: '岗位A', company: '公司A', salary: '100-200元/天', location: '杭州',
        degree: '本科', scale: '20-99人', tier: '强推', matchScore: 42,
        stack: ['Python'], jd: '职责摘要。', url: 'https://www.zhipin.com/job_detail/a.html',
      },
    ],
  });

  it('accepts a well-formed payload and returns id sets', () => {
    const { stackIds, positionIds } = validateJobsData(fixture());
    assert.ok(stackIds.has('ros-ros2') && stackIds.has('cpp'));
    assert.ok(positionIds.has('job-a'));
  });

  it('rejects bad payloads: dataAsOf, rank gaps, duplicate ids, dangling related, bad percent, http urls', () => {
    assert.throws(() => validateJobsData({ ...fixture(), dataAsOf: '2026/09/25' }), /dataAsOf/);
    assert.throws(() => {
      const d = fixture();
      d.techStack[1].rank = 3;
      validateJobsData(d);
    }, /rank/);
    assert.throws(() => {
      const d = fixture();
      d.techStack[1].id = 'ros-ros2';
      validateJobsData(d);
    }, /duplicate/);
    assert.throws(() => {
      const d = fixture();
      d.techStack[0].related = ['nope'];
      validateJobsData(d);
    }, /unknown related/);
    assert.throws(() => {
      const d = fixture();
      d.techStack[0].percent = 101;
      validateJobsData(d);
    }, /percent/);
    assert.throws(() => {
      const d = fixture();
      d.positions[0].url = 'http://www.zhipin.com/job_detail/a.html';
      validateJobsData(d);
    }, /https/);
  });

  it('normalizes tabs, clamps pages and builds clean URLs', () => {
    assert.equal(normalizeJobsTab('jobs'), 'jobs');
    assert.equal(normalizeJobsTab('bogus'), 'stack');
    assert.equal(jobsTotalPages(0, STACK_PER_PAGE), 1);
    assert.equal(jobsTotalPages(26, STACK_PER_PAGE), 6);
    assert.equal(jobsTotalPages(15, JOBS_PER_PAGE), 4);
    assert.equal(clampJobsPage(99, 5), 5);
    assert.equal(clampJobsPage('abc', 5), 1);
    assert.equal(buildJobsUrl({}), '/jobs/');
    assert.equal(buildJobsUrl({ tab: 'stack', page: 1 }), '/jobs/');
    assert.equal(buildJobsUrl({ tab: 'stack', page: 2 }), '/jobs/?page=2');
    assert.equal(buildJobsUrl({ tab: 'jobs', page: 1 }), '/jobs/?tab=jobs');
    assert.equal(buildJobsUrl({ tab: 'jobs', page: 3 }), '/jobs/?tab=jobs&page=3');
    assert.equal(pageForIndex(0, 5), 1);
    assert.equal(pageForIndex(4, 5), 1);
    assert.equal(pageForIndex(5, 5), 2);
  });

  it('parses URL state per tab and flags values that need cleanup', () => {
    assert.deepEqual(readJobsUrlState('', { stackCount: 26, jobsCount: 20 }), { tab: 'stack', page: 1, normalized: false });
    assert.deepEqual(readJobsUrlState('?tab=jobs', { stackCount: 26, jobsCount: 20 }), { tab: 'jobs', page: 1, normalized: false });
    assert.deepEqual(readJobsUrlState('?tab=jobs&page=4', { stackCount: 26, jobsCount: 20 }), { tab: 'jobs', page: 4, normalized: false });
    assert.deepEqual(readJobsUrlState('?tab=jobs&page=9', { stackCount: 26, jobsCount: 20 }), { tab: 'jobs', page: 5, normalized: true });
    assert.deepEqual(readJobsUrlState('?tab=stack', { stackCount: 26, jobsCount: 20 }), { tab: 'stack', page: 1, normalized: true });
    assert.deepEqual(readJobsUrlState('?tab=bogus', { stackCount: 26, jobsCount: 20 }), { tab: 'stack', page: 1, normalized: true });
    assert.deepEqual(readJobsUrlState('?page=abc', { stackCount: 26, jobsCount: 20 }), { tab: 'stack', page: 1, normalized: true });
  });
});

describe('Jobs page build output', () => {
  let jobsBuildRoot;
  let jobsDist;

  before(async () => {
    jobsBuildRoot = createTestBuildRoot();
    jobsDist = path.join(jobsBuildRoot, 'dist-build');
    const { buildSite } = await import('../build.mjs');
    buildSite({ distDir: jobsDist, tmpRoot: jobsBuildRoot });
  });

  after(() => fs.rmSync(jobsBuildRoot, { recursive: true, force: true }));

  it('generates jobs/index.html with switch, panels, cards and island contracts', () => {
    const jobsPath = path.join(jobsDist, 'jobs', 'index.html');
    assert.ok(fs.existsSync(jobsPath), 'jobs/index.html must exist');
    const html = fs.readFileSync(jobsPath, 'utf8');

    assert.match(html, /<h1 class="terms-title">求职专栏<\/h1>/);
    assert.match(html, /数据截止 2026-09-30/, 'both tab pages must carry the data cutoff badge');

    // 板块切换：经典拨杆开关 + 两个板块标签（SSR 默认技术栈板块）
    assert.match(html, /role="switch"/);
    assert.match(html, /aria-checked="false"/);
    assert.match(html, /data-tab="stack"/);
    assert.match(html, /data-tab="jobs"/);
    assert.match(html, /aria-pressed="true"/);

    // SSR 全量降级：24 张技术栈卡 + 15 张岗位卡（岗位面板默认 hidden）
    assert.equal(countMatches(html, /class="term-card tech-card"/g), 26, 'must server-render all 26 stack cards');
    assert.equal(countMatches(html, /class="term-card job-card"/g), 20, 'must server-render all 20 job cards');
    assert.doesNotMatch(html, /低频需求/, 'low-frequency stack note must not be rendered');
    assert.match(html, /id="jobs-jobs-panel"[^>]*\shidden/);
    assert.match(html, /<noscript>/, 'no-JS fallback must reveal the jobs panel');
    assert.equal(countMatches(html, /查看原始岗位页/g), 20, 'every job card must link to its original page');
    for (const match of html.matchAll(/<a href="(https:\/\/www\.zhipin\.com\/[^"]+)" target="_blank" rel="noopener noreferrer">查看原始岗位页/g)) {
      assert.match(match[1], /^https:\/\/www\.zhipin\.com\/job_detail\//);
    }

    // 分页由 island 接管：SSR 仅保留隐藏壳
    assert.match(html, /id="jobs-pagination"[^>]*hidden/);
    assert.doesNotMatch(html, /terms-page-btn[^>]*data-page/, 'pagination buttons must not be prerendered');

    // Island 载荷与 bundle
    const payloadMatch = html.match(/<script id="jobs-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(payloadMatch, 'jobs-data JSON island must exist');
    const payload = JSON.parse(payloadMatch[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));
    assert.equal(payload.techStack.length, 26);
    assert.equal(payload.positions.length, 20);
    assert.equal(payload.dataAsOf, '2026-09-30');
    assert.ok(payload.positions.some((p) => p.title === '测试开发工程师实习生（智能工程机器人）'), 'CJK punctuation must survive JSON escaping');
    assert.match(html, /"\/jobs\/":\["\/assets\/jobs-[A-Za-z0-9]+\.js"\]/, 'manifest must load the hashed jobs island bundle');
    assert.doesNotMatch(html, /\uFFFD/);
  });

  it('keeps pagination math at five stacks and four jobs per page', () => {
    const data = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'jobs.json'), 'utf8'));
    assert.equal(data.techStack.length, 26, 'tech stack must rank exactly 26 items');
    assert.equal(data.positions.length, 20, 'job list must contain exactly 20 positions');

    const stackPages = Array.from(
      { length: jobsTotalPages(data.techStack.length, STACK_PER_PAGE) },
      (_, index) => data.techStack.slice(index * STACK_PER_PAGE, (index + 1) * STACK_PER_PAGE).length,
    );
    assert.deepEqual(stackPages, [5, 5, 5, 5, 5, 1], 'stack pagination must show 5 per page');
    const jobPages = Array.from(
      { length: jobsTotalPages(data.positions.length, JOBS_PER_PAGE) },
      (_, index) => data.positions.slice(index * JOBS_PER_PAGE, (index + 1) * JOBS_PER_PAGE).length,
    );
    assert.deepEqual(jobPages, [4, 4, 4, 4, 4], 'job pagination must show 4 per page');

    // 关联标签必须全部指向有效技术栈条目
    const ids = new Set(data.techStack.map((item) => item.id));
    for (const item of data.techStack) {
      for (const ref of item.related) {
        assert.ok(ids.has(ref), `related tag "${ref}" on ${item.id} must resolve`);
      }
    }
    // 岗位与公司一一对应：每条岗位都有公司、JD 摘要、技术栈与原始链接
    for (const position of data.positions) {
      assert.ok(position.company && position.jd && position.url.startsWith('https://'), `${position.id} must be complete`);
      assert.ok(Array.isArray(position.stack) && position.stack.length > 0, `${position.id} must list required stacks`);
    }
  });

  it('registers /jobs/ in nav, sitemap, search index and ships the hashed island bundle', () => {
    const indexHtml = fs.readFileSync(path.join(jobsDist, 'index.html'), 'utf8');
    assert.match(indexHtml, /href="\/jobs\/"[^>]*>求职专栏<\/a>/, 'header nav must link the jobs column');
    assert.match(indexHtml, /href="\/jobs\/">求职专栏<\/a>/, 'footer nav must link the jobs column');

    const sitemap = fs.readFileSync(path.join(jobsDist, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/mostarmanus\.ink\/jobs\/<\/loc>/);

    const searchIndex = JSON.parse(fs.readFileSync(path.join(jobsDist, 'search-index.json'), 'utf8'));
    const jobsEntry = searchIndex.find((item) => item.href === '/jobs/');
    assert.ok(jobsEntry, 'search index must contain the jobs page');
    assert.equal(jobsEntry.title, '求职专栏');

    const jobsBundles = fs.readdirSync(path.join(jobsDist, 'assets')).filter((name) => /^jobs-[A-Za-z0-9]+\.js$/.test(name));
    assert.equal(jobsBundles.length, 1, 'one hashed jobs explorer bundle must be published');
    const sharedChunks = fs.readdirSync(path.join(jobsDist, 'assets')).filter((name) => /^chunk-[A-Za-z0-9]+\.js$/.test(name));
    assert.ok(sharedChunks.length >= 1, 'jobs island must share the React runtime chunk');
  });

  it('styles the rocker switch and keeps it responsive without breaking reduced motion', () => {
    const css = fs.readFileSync(path.join(ROOT, 'public', 'styles', 'global.css'), 'utf8');
    const toggle = extractCssBlock(css, /\.jobs-toggle\s/);
    assert.ok(toggle, '.jobs-toggle block must exist');
    assert.match(toggle.body, /border-radius:\s*999px/);
    const knob = extractCssBlock(css, /\.jobs-toggle-knob\s/);
    assert.ok(knob, '.jobs-toggle-knob block must exist');
    assert.match(knob.body, /border-radius:\s*50%/);
    assert.match(css, /\.jobs-toggle\.is-on \{/, 'switch on-state must be styled');
    assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*?\.jobs-head[\s\S]*?\}/, 'head must stack on mobile');
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.jobs-toggle[\s\S]*?\}/);
  });
});
