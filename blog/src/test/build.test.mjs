import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { mdToHtml, escapeHtml, escapeXml } from '../markdown.mjs';
import {
  filterPosts,
  isValidCategory,
  matchesFilter,
  normalizeFilterState,
  tagMatchesExact,
} from '../filters.mjs';
import { getCompactPaginationItems, parsePaginationJump } from '../pagination.mjs';

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

  it('matches tags exactly and treats an empty filter as no tag filter', () => {
    assert.equal(tagMatchesExact(['PID', 'ROS2'], 'PI'), false);
    assert.equal(tagMatchesExact(['PID', 'ROS2'], 'PID'), true);
    assert.equal(tagMatchesExact([], 'PID'), false);
    assert.equal(tagMatchesExact(['PID', 'ROS2'], ''), true);
  });

  it('supports category and tag AND filtering', () => {
    assert.deepEqual(filterPosts(posts, 'debug', 'PID').map((post) => post.slug), ['debug-pid']);
    assert.deepEqual(filterPosts(posts, 'learn', 'PID').map((post) => post.slug), ['learn-pid']);
    assert.deepEqual(filterPosts(posts, 'debug', 'LLM'), []);
    assert.equal(matchesFilter(posts[0], '', ''), true);
  });

  it('normalizes unknown categories without discarding an unknown tag', () => {
    assert.equal(isValidCategory('debug'), true);
    assert.equal(isValidCategory('unknown'), false);
    assert.deepEqual(normalizeFilterState('unknown', 'not-a-real-tag'), {
      category: '',
      tag: 'not-a-real-tag',
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
      filterGlossary,
      isSafeInternalPath,
      normalizeTermsFilterState,
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

    const { buildSite, generateJsonLd, head } = await import('../build.mjs');
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

    const homeHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
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

  it('places direct term-name matches before related summary-only matches', async () => {
    const {
      getTermNameMatchRank,
      groupGlossarySearchResults,
      matchesGlossaryRelatedContent,
    } = await import('../build.mjs');
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

  it('treats English full names and aliases as term-name matches', async () => {
    const { groupGlossarySearchResults } = await import('../build.mjs');
    const fullNameGroups = groupGlossarySearchResults(glossaryData, 'Monte Carlo', 'all', categories);
    const aliasGroups = groupGlossarySearchResults(glossaryData, '语音活动检测', 'all', categories);

    assert.ok(fullNameGroups.strongest.some((term) => term.id === 'amcl'));
    assert.ok(aliasGroups.strongest.some((term) => term.id === 'vad'));
  });

  it('finds core extension terms through practical multiword aliases without polluting ROS summaries', async () => {
    const { groupGlossarySearchResults } = await import('../build.mjs');
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

  it('shows summary-only matches in the related-content group', async () => {
    const { groupGlossarySearchResults } = await import('../build.mjs');
    const groups = groupGlossarySearchResults(glossaryData, '粒子滤波', 'all', categories);

    assert.equal(groups.strongest.length, 0);
    assert.ok(groups.related.some((term) => term.id === 'amcl'));
  });

  it('keeps category filtering as an AND condition without searching category labels', async () => {
    const { groupGlossarySearchResults } = await import('../build.mjs');
    const groups = groupGlossarySearchResults(glossaryData, 'PID', '导航与运动安全', categories);

    assert.ok(groups.results.length > 0);
    assert.ok(groups.results.every((term) => term.category === '导航与运动安全'));
    assert.ok(groups.strongest.some((term) => term.id === 'pid'));
  });

  it('keeps the normal category list ungrouped and paginatable when no search is entered', async () => {
    const { filterGlossary, groupGlossarySearchResults } = await import('../build.mjs');
    const groups = groupGlossarySearchResults(glossaryData, '', '导航与运动安全', categories);

    assert.equal(groups.isSearch, false);
    assert.equal(groups.strongest.length, 0);
    assert.equal(groups.related.length, 0);
    assert.ok(groups.results.every((term) => term.category === '导航与运动安全'));
    assert.deepEqual(filterGlossary(glossaryData, '', '导航与运动安全', categories), groups.results);
  });

  it('returns no result for an unrelated query and safely falls back from unknown categories', async () => {
    const { groupGlossarySearchResults } = await import('../build.mjs');
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
    assert.match(html, /history\.pushState/, 'category and clear actions must create a history entry');
    assert.match(html, /history\.replaceState/, 'search input must replace the current history entry');
  });

  it('uses ten-item client pagination with accessible controls and stable URLs', () => {
    const termsHtml = fs.readFileSync(path.join(termsDist, 'terms', 'index.html'), 'utf8');
    const glossary = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'glossary.json'), 'utf8'));
    const pageSize = 10;
    const pageSizes = Array.from(
      { length: Math.ceil(glossary.length / pageSize) },
      (_, index) => glossary.slice(index * pageSize, (index + 1) * pageSize).length,
    );
    assert.ok(pageSizes.length >= 1, 'glossary must produce at least one page');
    assert.ok(pageSizes.every((size) => size > 0 && size <= pageSize), 'each page must contain no more than ten terms');
    assert.equal(pageSizes.reduce((total, size) => total + size, 0), glossary.length, 'pagination must retain every term');

    const scriptMatch = termsHtml.match(/<script>\n\s*\(function\(\)\{\n\s*var glossaryData[\s\S]*?\}\)\(\);\s*\n\s*<\/script>/);
    assert.ok(scriptMatch, 'must have complete glossary page script');
    const script = scriptMatch[0];
    assert.match(script, /var TERMS_PER_PAGE = 10;/, 'must use a single ten-item page size constant');
    assert.match(script, /function renderPagination\(totalPages\)/, 'must render pagination from the filtered result count');
    assert.match(script, /getCompactPaginationItems\(currentPage, totalPages\)/, 'must render a compact page-number sequence');
    assert.match(script, /appendPageJump\(\);\s*appendPageButton\(String\(lastPage\), lastPage/, 'page jump must appear before the dynamic last-page button');
    assert.match(script, /ariaLabel: '第 ' \+ lastPage \+ ' 页（最后一页）'/, 'the dynamic last page must be announced clearly');
    assert.match(script, /input\.inputMode = 'numeric'/, 'page input must request a numeric touch keyboard');
    assert.match(script, /input\.enterKeyHint = 'go'/, 'page input must expose an Enter-to-go hint');
    assert.match(script, /termsPagination\.addEventListener\('submit'/, 'page jump must work through form submit and Enter');
    assert.match(script, /parsePaginationJump\(input \? input\.value : '', totalPages\)/, 'page jump must use strict validation');
    assert.match(script, /announce\('请输入 1 到 ' \+ totalPages \+ ' 的整数页码'\)/, 'invalid page input must be announced');
    assert.match(script, /button\.setAttribute\('aria-controls', 'terms-results'\)/, 'page buttons must announce their controlled result area');
    assert.match(script, /button\.setAttribute\('aria-current', 'page'\)/, 'current page must be announced');
    assert.match(script, /button\.disabled = true/, 'current and boundary page controls must be disabled natively');
    assert.match(script, /if \(!currentResultGroup\.isSearch && currentPage > 1\) params\.set\('page', String\(currentPage\)\)/, 'only later non-search pages may add the page URL parameter');
    assert.match(script, /function parsePageParam\(rawPage\)/, 'page parameter must be parsed and normalized safely');
    assert.match(script, /applyFilters\(1\);\s*updateUrl\('replace'\)/, 'search must reset pagination to page one');
    assert.match(script, /applyFilters\(1\);\s*updateUrl\('push'\)/, 'category and clear changes must reset pagination to page one');
    assert.match(script, /function renderSearchSections\(resultGroup\)/, 'search mode must render the two relevance groups');
    assert.match(script, /renderPagination\(0\)/, 'search mode must not paginate grouped results');
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

  it('includes scrollToTermFromHash logic in terms page script', async () => {
    const termsHtml = fs.readFileSync(path.join(anchorDist, 'terms', 'index.html'), 'utf8');
    // Match the terms page script: <script> newline indent (function(){ newline indent var glossaryData ... })(); newline indent </script>
    const scriptMatch = termsHtml.match(/<script>\n\s*\(function\(\)\{\n\s+var glossaryData([\s\S]*?)\)\(\);\s*\n\s*<\/script>/);
    assert.ok(scriptMatch, 'must have terms page inline script with glossaryData');
    const script = scriptMatch[1];

    // Hash validation regex (check presence of regex literal in script)
    assert.ok(script.includes('/^[a-z0-9_-]+$/'), 'must validate hash format with regex');

    // scrollIntoView call (check substring presence)
    assert.ok(script.includes('scrollIntoView({') && script.includes('block:'), 'must call scrollIntoView with options');

    // pushState for link clicks
    assert.ok(script.includes('history.pushState'), 'must use pushState for navigation');
    assert.doesNotMatch(script, /history\.pushState\(null\s+['"]/, 'must emit valid pushState syntax');

    // hashchange listener
    assert.ok(script.includes("addEventListener('hashchange'"), 'must listen for hashchange');

    // popstate listener
    assert.ok(script.includes("addEventListener('popstate'"), 'must listen for popstate');
  });

  it('emits a browser-compilable terms page script', async () => {
    const termsHtml = fs.readFileSync(path.join(anchorDist, 'terms', 'index.html'), 'utf8');
    const scriptMatch = termsHtml.match(/<script>\n\s*\(function\(\)\{\n\s*var glossaryData[\s\S]*?\}\)\(\);\s*\n\s*<\/script>/);
    assert.ok(scriptMatch, 'must have complete glossary page script');
    const script = scriptMatch[0]
      .replace(/^<script>\s*/, '')
      .replace(/\s*<\/script>$/, '');
    assert.doesNotThrow(() => new Function(script), 'generated browser script must compile');
  });

  it('includes aria-live region for accessibility announcements', async () => {
    const termsHtml = fs.readFileSync(path.join(anchorDist, 'terms', 'index.html'), 'utf8');
    const scriptMatch = termsHtml.match(/<script>\n\s*\(function\(\)\{\n\s+var glossaryData([\s\S]*?)\)\(\);\s*\n\s*<\/script>/);
    assert.ok(scriptMatch, 'must have terms page inline script with glossaryData');
    const script = scriptMatch[1];
    assert.match(script, /aria-live.*polite/, 'must create aria-live region');
    assert.match(script, /已定位到术语/, 'must announce target term name');
  });

  it('handles edge cases: illegal hash, missing target, hidden target', async () => {
    const termsHtml = fs.readFileSync(path.join(anchorDist, 'terms', 'index.html'), 'utf8');
    const scriptMatch = termsHtml.match(/<script>\n\s*\(function\(\)\{\n\s+var glossaryData([\s\S]*?)\)\(\);\s*\n\s*<\/script>/);
    const script = scriptMatch[1];

    // Illegal hash returns false early
    assert.match(script, /return false/, 'must return false for invalid input');

    // Only an explicit related-link click may reveal an otherwise filter-hidden target.
    assert.match(script, /if \(!options\.revealHidden\)[\s\S]*?当前筛选已隐藏该术语/, 'direct hash navigation must announce instead of clearing filters');
    assert.match(script, /filteredTerms\.findIndex/, 'must distinguish filter-hidden terms from terms on another page');
    assert.match(script, /clearFiltersForTerm\(\);/, 'related-link navigation must reveal a filter-hidden target');
    assert.match(script, /var targetPage = currentResultGroup\.isSearch \? 1 : Math\.floor\(targetIndex \/ TERMS_PER_PAGE\) \+ 1/, 'hash navigation must skip pagination for grouped search results');
    assert.match(script, /if \(currentPage !== targetPage\) applyFilters\(targetPage\)/, 'hash navigation must show an otherwise matching target page');
    assert.match(script, /var url = '\/terms\/' \+ \(qs \? '\?' \+ qs : ''\) \+ hash/, 'filter URL builder must preserve a requested term hash');

    // Filter conflict announcement
    assert.match(script, /当前筛选已隐藏该术语/, 'must announce when filter hides target');
  });

  it('uses ResizeObserver with window.resize fallback for header detection', async () => {
    const termsHtml = fs.readFileSync(path.join(anchorDist, 'terms', 'index.html'), 'utf8');
    const scriptMatch = termsHtml.match(/<script>\n\s*\(function\(\)\{\n\s+var glossaryData([\s\S]*?)\)\(\);\s*\n\s*<\/script>/);
    const script = scriptMatch[1];
    assert.match(script, /ResizeObserver/, 'must use ResizeObserver');
    assert.match(script, /addEventListener\('resize'/, 'must have resize fallback');
    assert.match(script, /--header-height/, 'must update CSS variable dynamically');
  });

  it('ensures pulse animation auto-cleans up after playback', async () => {
    const termsHtml = fs.readFileSync(path.join(anchorDist, 'terms', 'index.html'), 'utf8');
    const scriptMatch = termsHtml.match(/<script>\n\s*\(function\(\)\{\n\s+var glossaryData([\s\S]*?)\)\(\);\s*\n\s*<\/script>/);
    const script = scriptMatch[1];
    // Timer-based cleanup
    assert.match(script, /setTimeout/, 'must use timer for cleanup');
    // animationend cleanup
    assert.match(script, /animationend/, 'must listen for animationend');
    // Class removal
    assert.match(script, /classList\.remove\(['"]term-card--hash-target['"],\s*['"]animate-pulse['"]\)/, 'must remove both classes on cleanup');
    assert.match(script, /var _pulseCard = null/, 'must track the previously highlighted card');
  });

  it('keeps static verification reports out of publish output', () => {
    const verifier = fs.readFileSync(path.join(SRC, 'test', 'anchor-verify.mjs'), 'utf8');
    assert.doesNotMatch(verifier, /path\.join\(DIST_DIR, 'anchor-verification-report\.html'\)/, 'verification reports must not be written into dist-build');
    assert.match(verifier, /path\.join\(PROJECT_ROOT, 'output', 'verification'\)/, 'verification reports must use a non-published output folder');
  });
});
