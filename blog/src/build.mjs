// 静态站点构建脚本:读取 Markdown 内容 -> 生成静态 HTML
// 使用 gray-matter 解析 frontmatter, markdown-it 渲染内容
// 用法: node src/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import matter from 'gray-matter';
import { mdToHtml, escapeHtml, escapeXml } from './markdown.mjs';
import config from './config.mjs';
import { isValidCategory } from './filters.mjs';
import {
  filterGlossary,
  getTermNameMatchRank,
  groupGlossarySearchResults,
  matchesGlossaryRelatedContent,
  normalizeTermsFilterState,
  normalizeTermsText,
  TERMS_PER_PAGE,
} from './terms.mjs';
import {
  JOBS_PER_PAGE,
  STACK_PER_PAGE,
  jobsTotalPages,
  validateJobsData,
} from './jobs.mjs';
import { HomePageBody, renderPostCard, RelatedPosts, PostMeta } from './ui/index.mjs';
import { installNavigationGate } from './client/navigation-bootstrap.mjs';

export {
  filterGlossary,
  getTermNameMatchRank,
  groupGlossarySearchResults,
  matchesGlossaryRelatedContent,
  normalizeTermsFilterState,
  normalizeTermsText,
  TERMS_PER_PAGE,
  JOBS_PER_PAGE,
  STACK_PER_PAGE,
  jobsTotalPages,
  validateJobsData,
};

const siteName = config.site.seoName || config.site.title;
const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist-build');
const PUBLIC = path.join(ROOT, 'public');
const ASSETS_DIR = path.join(DIST, 'assets');

// ---------- Fontsource 字体文件路径 ----------
// 使用 @fontsource-variable 自托管字体，避免 Google Fonts 阻塞请求
// Fontsource v5 文件命名: {family}-{subset}-wght-{style}.woff2
// 注意: Node.js v24 不支持 .woff2?url 导入，使用 require.resolve 替代

function getFontSourcePath(fontPackage, filename) {
  try {
    // 尝试从 node_modules 解析实际文件路径
    const possiblePaths = [
      path.join(ROOT, 'node_modules', fontPackage, 'files', filename),
      path.join(ROOT, 'node_modules', fontPackage, filename),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    console.warn(`[warn] 字体文件未找到: ${fontPackage}/${filename}`);
    return null;
  } catch (e) {
    console.warn(`[warn] 解析字体路径失败:`, e.message);
    return null;
  }
}

// Lora 字体（衬线，用于标题）
const loraWoff2Path = getFontSourcePath(
  '@fontsource-variable/lora',
  'lora-latin-wght-normal.woff2'
);

// JetBrains Mono 字体（等宽，用于代码）
const jetbrainsWoff2Path = getFontSourcePath(
  '@fontsource-variable/jetbrains-mono',
  'jetbrains-mono-latin-wght-normal.woff2'
);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const resume = readJson(path.join(SRC, 'data', 'resume.json'));
const friends = readJson(path.join(SRC, 'data', 'friends.json'));
const glossary = readJson(path.join(SRC, 'data', 'glossary.json'));
const jobsData = readJson(path.join(SRC, 'data', 'jobs.json'));
validateJobsData(jobsData);
const siteOrigin = new URL(config.site.url).origin;

export function safeJsonForScript(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof json !== 'string') throw new Error('无法序列化内嵌 JSON');

  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function isSafeInternalPath(value) {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || /[\u0000-\u001F\u007F<>"'`\\]/.test(value)
  ) {
    return false;
  }

  try {
    const url = new URL(value, config.site.url);
    return url.origin === siteOrigin && url.pathname.startsWith('/');
  } catch {
    return false;
  }
}

// ---------- frontmatter 校验 ----------
function validateUrl(field, value, filename) {
  // 跳过非 URL 状态字段
  if (field.endsWith('Status') || field === 'status' || field === 'role') return;
  if (!value) return;
  if (/^https:\/\//.test(value)) return;
  if (/^mailto:/.test(value)) return;
  if (/^\//.test(value)) return;
  throw new Error(`[frontmatter] ${filename}: "${field}" 无效 URL "${value}"(只允许 https:, mailto: 或 / 开头的站内路径)`);
}

function validateDate(value, field, filename) {
  if (!value) throw new Error(`[frontmatter] ${filename}: 缺少必填字段 "${field}"`);
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new Error(`[frontmatter] ${filename}: "${field}" 无效日期 "${value}"`);
  return d.toISOString().slice(0, 10);
}

function parseFrontmatter(raw, filename) {
  const { data, content } = matter(raw);
  
  // 基本校验
  if (!data.title || typeof data.title !== 'string') {
    throw new Error(`[frontmatter] ${filename}: 缺少或无效的 title`);
  }
  if (!data.description || typeof data.description !== 'string') {
    throw new Error(`[frontmatter] ${filename}: 缺少或无效的 description`);
  }
  
  // URL 字段校验
  if (data.links && typeof data.links === 'object') {
    for (const [k, v] of Object.entries(data.links)) {
      if (v && typeof v === 'string') validateUrl(`links.${k}`, v, filename);
    }
  }
  
  return { data, body: content };
}

function loadCollection(dir) {
  const d = path.join(SRC, 'content', dir);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(d, f), 'utf8');
      const { data, body } = parseFrontmatter(raw, `${dir}/${f}`);
      const slug = f.replace(/\.md$/, '');
      
      // 博客文章额外校验
      if (dir === 'blog') {
        data.pubDate = validateDate(data.pubDate, 'pubDate', f);
        if (!data.category || !isValidCategory(data.category)) {
          console.warn(`[warn] ${f}: 未知分类 "${data.category}"，使用默认`);
        }
        if (!Array.isArray(data.tags)) {
          throw new Error(`[frontmatter] ${f}: tags 必须是字符串数组`);
        }
        if (typeof data.draft !== 'boolean') {
          data.draft = false;
        }
        // 阅读时长（参考 fuwari / morethan-log 的列表 meta）
        data.readingMinutes = estimateReadingMinutes(body);
      }
      
      // 项目额外校验
      if (dir === 'projects') {
        data.date = validateDate(data.date, 'date', f);
        if (!data.links || typeof data.links !== 'object') {
          throw new Error(`[frontmatter] ${f}: links 必须是对象`);
        }
      }
      
      return { slug, data, body, html: mdToHtml(body) };
    });
}

const posts = loadCollection('blog').filter((p) => !p.data.draft);
posts.sort((a, b) => new Date(b.data.pubDate) - new Date(a.data.pubDate));
const projects = loadCollection('projects').sort(
  (a, b) => new Date(b.data.date) - new Date(a.data.date)
);

const fmt = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

/** 中英混排阅读时长估算：约 400 汉字/分 + 200 英文词/分 */
export function estimateReadingMinutes(markdown) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_\-|]/g, ' ');
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const latin = (text.match(/[A-Za-z][A-Za-z0-9+#.-]*/g) || []).length;
  return Math.max(1, Math.round(cjk / 400 + latin / 200));
}

// ---------- 资产哈希工具 ----------
function fileHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

// 全局资产映射: 原始文件名 -> 哈希文件名
// 在构建流程中填充
const assetMap = new Map();

const SEARCH_PAGE_DESCRIPTIONS = {
  '/': '具身智能、机器人项目与最新技术笔记',
  '/blog/': 'ROS 2、OpenClaw 与机器人系统排错记录',
  '/projects/': '机器人项目、系统架构与开发进度',
  '/about/': '个人履历、技能方向与获奖经历',
  '/friends/': '技术博客与机器人开发者友链',
  '/terms/': 'ROS 2、导航、控制与 AI Agent 专业术语',
  '/jobs/': '杭州机器人实习求职专栏：技术栈需求优先级与岗位 JD',
};

export function createSearchIndex() {
  const pages = config.nav.map((item) => ({
    type: 'page',
    title: item.label,
    description: SEARCH_PAGE_DESCRIPTIONS[item.href] || '',
    href: item.href,
    keywords: [item.label, SEARCH_PAGE_DESCRIPTIONS[item.href] || ''],
  }));
  const postItems = posts.map((post) => ({
    type: 'post',
    title: post.data.title,
    description: post.data.description || '',
    href: `/blog/${post.slug}/`,
    keywords: [
      config.categories[post.data.category]?.label || '',
      ...(post.data.tags || []),
    ],
  }));
  const projectItems = projects.map((project) => ({
    type: 'project',
    title: project.data.title,
    description: project.data.description || '',
    href: `/projects/${project.slug}/`,
    keywords: [project.data.status || '', ...(project.data.tags || [])],
  }));
  const termItems = glossary.map((term) => ({
    type: 'term',
    title: term.term,
    description: term.fullName ? `${term.fullName} · ${term.summary}` : term.summary,
    href: `/terms/#${term.id}`,
    keywords: [term.fullName || '', term.category || '', ...(term.aliases || [])],
  }));

  return [...pages, ...postItems, ...projectItems, ...termItems];
}

const CLIENT_ENTRIES = {
  navigation: path.join(SRC, 'client', 'navigation.mjs'),
  site: path.join(SRC, 'client', 'site.jsx'),
  terms: path.join(SRC, 'client', 'terms-explorer.jsx'),
  jobs: path.join(SRC, 'client', 'jobs-explorer.jsx'),
};
let modulePreloads = {};

function buildClientAssets(tmpDist) {
  const result = buildSync({
    entryPoints: CLIENT_ENTRIES,
    outdir: path.join(tmpDist, 'assets'),
    bundle: true,
    splitting: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    jsx: 'automatic',
    legalComments: 'none',
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    metafile: true,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  const entryKeys = new Map(
    Object.entries(CLIENT_ENTRIES).map(([key, entryPoint]) => [path.resolve(entryPoint), `${key}.js`]),
  );
  const built = [];
  for (const [outputPath, output] of Object.entries(result.metafile.outputs)) {
    const filename = path.basename(outputPath);
    built.push(filename);
    if (!output.entryPoint) continue;

    const assetKey = entryKeys.get(path.resolve(output.entryPoint));
    if (assetKey) assetMap.set(assetKey, filename);
  }

  for (const key of Object.keys(CLIENT_ENTRIES)) {
    if (!assetMap.has(`${key}.js`)) throw new Error(`客户端入口构建失败: ${key}`);
  }
  const outputs = new Map(Object.entries(result.metafile.outputs).map(([file, output]) => [path.resolve(file), output]));
  modulePreloads = {};
  for (const entry of ['terms.js', 'jobs.js']) {
    const files = new Set();
    const collect = (file) => {
      if (files.has(file)) return;
      for (const item of outputs.get(file)?.imports || []) {
        if (!item.external) collect(path.resolve(item.path));
      }
      files.add(file);
    };
    collect(path.resolve(tmpDist, 'assets', assetMap.get(entry)));
    modulePreloads[`/assets/${assetMap.get(entry)}`] = [...files].map((file) => `/assets/${path.basename(file)}`);
  }

  return built;
}

// ---------- 布局 ----------
const themeInit = `<script>(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();</script>`;
const themeBootstrapCss = `<style id="theme-bootstrap">html{background:#faf8f5;color-scheme:light}html.dark{background:#141210;color-scheme:dark}html,body{min-height:100%}</style>`;
let navigationVersion = '';
const sectionPaths = config.nav.map((item) => item.href);

function navigationManifest() {
  return {
    version: navigationVersion,
    preloads: modulePreloads,
    routes: Object.fromEntries(sectionPaths.map((route) => [
      route,
      route === '/terms/' ? [`/assets/${assetMap.get('terms.js')}`]
        : route === '/jobs/' ? [`/assets/${assetMap.get('jobs.js')}`] : [],
    ])),
  };
}

// 字体 @font-face 声明(在构建时注入实际路径)
let fontFaceCss = '';

function jsonLdScripts(jsonLd) {
  const entries = (Array.isArray(jsonLd) ? jsonLd : [jsonLd]).filter(Boolean);

  return entries
    .map((entry) => {
      const safeValue = safeJsonForScript(entry);
      return `<script type="application/ld+json">${safeValue}</script>`;
    })
    .join('\n');
}

export function head(title, description, options = {}) {
  const isArticle = options.type === 'article';
  const pageUrl = options.pageUrl || '';
  const imageUrl = options.imageUrl || `${config.site.url}/og-image.png`;
  
  let pageTitle;
  if (title) {
    pageTitle = `${title} | ${siteName}`;
  } else {
    pageTitle = `${siteName} | 具身智能与机器人技术博客`;
  }
  const desc = description || config.site.description;

  // canonical URL
  const canonical = options.canonical || `${config.site.url}${pageUrl}`;

  // 使用哈希后的 CSS 路径(如果存在),否则回退到固定路径
  const cssHref = assetMap.get('global.css') ? `/assets/${assetMap.get('global.css')}` : '/styles/global.css';

  return `<!doctype html><html lang="${config.site.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${themeInit}${themeBootstrapCss}<meta name="color-scheme" content="light dark"><link rel="icon" type="image/png" href="/logo.png"><link rel="icon" type="image/png" sizes="32x32" href="/logo.png"><title>${escapeHtml(pageTitle)}</title>
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:type" content="${isArticle ? 'article' : 'website'}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="MostarManus 博客分享图">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(pageTitle)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(imageUrl)}">
<script id="site-navigation-data" type="application/json">${safeJsonForScript(navigationManifest())}</script>
<script>(${installNavigationGate.toString()})(${safeJsonForScript(sectionPaths)});</script>
${fontFaceCss}
<link rel="stylesheet" href="${cssHref}">
${jsonLdScripts(options.jsonLd)}
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(siteName)}" href="/rss.xml"></head>`;
}

function header(active) {
  const nav = config.nav
    .map((n) => {
      const isActive = active === n.href;
      return `<a class="${isActive ? 'active' : ''}" href="${n.href}"${isActive ? ' aria-current="page"' : ''}>${escapeHtml(n.label)}</a>`;
    })
    .join('');
    
  const toggleBtn = `<button class="theme-toggle" id="theme-toggle" aria-label="切换到深色主题" title="切换深色/浅色" type="button" aria-pressed="false"><svg class="i-sun" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></svg><svg class="i-moon" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button>`;
    
  const mobileToggle = `<button class="nav-toggle" id="nav-toggle" aria-label="打开菜单" aria-controls="main-nav" aria-expanded="false">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
  </button>`;
  
  return `<header class="site-header" id="site-header"><div class="inner container"><a class="brand" href="/"><img src="/logo.png" alt="logo"><span>${escapeHtml(siteName)}</span></a><nav class="nav" id="main-nav">${nav}</nav><div id="global-search-root" class="global-search-root"></div>${toggleBtn}${mobileToggle}</div></header>`;
}

function footer() {
  const year = new Date().getFullYear();
  const navLinks = config.nav.map((n) => `<a href="${n.href}">${escapeHtml(n.label)}</a>`).join(' · ');
  return `<footer class="site-footer"><div class="inner container"><div>&copy; ${year} ${escapeHtml(siteName)} &middot; 静态构建</div><div>${navLinks} &middot; <a href="/rss.xml">RSS</a></div></div></footer>`;
}

function layout(opts) {
  const { title, description, active, body, jsonLd, type, pageUrl, imageUrl, canonical } = opts;
  const headOpts = { type, pageUrl, imageUrl, canonical, jsonLd };
  const clientScript = ['navigation.js', 'site.js']
    .map((key) => (assetMap.get(key) ? `<script type="module" src="/assets/${assetMap.get(key)}"></script>` : ''))
    .filter(Boolean)
    .join('\n');

  return `${head(title, description, headOpts)}
<body>
<a href="#main-content" class="skip-link">跳到正文</a>
${header(active)}
<main class="container" id="main-content" data-page-path="${escapeHtml(pageUrl || '/')}">${body}</main>
${footer()}
<div id="navigation-status" class="navigation-status" role="status" aria-live="polite" hidden><span data-nav-message></span><button type="button" data-nav-retry hidden>重试</button><button type="button" data-nav-refresh hidden>刷新页面</button></div>
<script>
document.addEventListener('DOMContentLoaded',function(){
  /* Theme toggle via event delegation */
  var themeSwitchFrame=0;
  var toggle=function(){
    var root=document.documentElement;
    root.classList.add('theme-switching');
    var isDark=root.classList.toggle('dark');
    var switchFrame=++themeSwitchFrame;
    localStorage.setItem('theme',isDark?'dark':'light');
    var btn=document.getElementById('theme-toggle');
    if(btn){
      btn.setAttribute('aria-pressed',String(isDark));
      btn.setAttribute('aria-label',isDark?'切换到浅色主题':'切换到深色主题');
    }
    var clearSwitch=function(){if(switchFrame===themeSwitchFrame){root.classList.remove('theme-switching');}};
    if(window.requestAnimationFrame){
      requestAnimationFrame(function(){requestAnimationFrame(clearSwitch);});
    }else{
      setTimeout(clearSwitch,0);
    }
    setTimeout(clearSwitch,120);
  };
  document.addEventListener('click',function(e){if(e.target.closest('#theme-toggle')){e.preventDefault();toggle();}});
  /* Header scroll shadow */
  var hd=document.getElementById('site-header');if(hd)window.addEventListener('scroll',function(){hd.classList.toggle('scrolled',window.scrollY>10);},{passive:true});
  /* Mobile nav: keyboard dismissal and focus restoration */
  var nt=document.getElementById('nav-toggle'),nv=document.getElementById('main-nav');
  if(nt&&nv){
    function setNavOpen(open,restoreFocus){
      nv.classList.toggle('open',open);
      nt.setAttribute('aria-expanded',String(open));
      nt.setAttribute('aria-label',open?'关闭菜单':'打开菜单');
      if(!open&&restoreFocus){nt.focus();}
    }
    nt.addEventListener('click',function(){setNavOpen(!nv.classList.contains('open'),false);});
    nv.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){setNavOpen(false,false);});});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&nv.classList.contains('open')){e.preventDefault();setNavOpen(false,true);}});
    document.addEventListener('click',function(e){if(nv.classList.contains('open')&&!nv.contains(e.target)&&!nt.contains(e.target)){setNavOpen(false,true);}});
  }
  /* Initialize theme button ARIA state */
  (function(){var btn=document.getElementById('theme-toggle');if(btn){btn.setAttribute('aria-pressed',String(document.documentElement.classList.contains('dark')));btn.setAttribute('aria-label',document.documentElement.classList.contains('dark')?'切换到浅色主题':'切换到深色主题');}})();
});
</script>
${clientScript}
<script src="/agent-widget.js" defer></script>
</body></html>`;
}

// ---------- JSON-LD 生成 ----------
export function generateJsonLd(type, data) {
  switch (type) {
    case 'website':
      return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteName,
        url: config.site.url,
        description: config.site.description,
        author: { '@type': 'Person', name: config.site.author }
      });
    case 'person':
      return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: resume.name,
        jobTitle: resume.title,
        description: resume.summary,
        url: config.site.url,
        sameAs: [config.social.email ? `mailto:${config.social.email}` : null].filter(Boolean)
      });
    case 'blogpost':
      return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: data.title,
        description: data.description,
        author: { '@type': 'Person', name: config.site.author },
        datePublished: data.pubDate,
        dateModified: data.updatedDate || data.pubDate,
        url: data.url,
        image: `${config.site.url}/og-image.png`,
        publisher: { '@type': 'Organization', name: 'MostarManus' },
        mainEntityOfPage: { '@type': 'WebPage', '@id': data.url }
      });
    case 'breadcrumb':
      return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: data.items.map((item, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          name: item.name,
          item: item.url
        }))
      });
    case 'creativework':
      return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        headline: data.title,
        description: data.description,
        author: { '@type': 'Person', name: config.site.author },
        datePublished: data.date,
        url: data.url
      });
    default:
      return '';
  }
}

// ---------- 小组件（React SSR 已接管首页/卡片，保留兼容导出） ----------
function socialLinks() {
  const s = config.social;
  const out = [];

  if (s.email) out.push(`<a href="mailto:${s.email}">Email</a>`);
  if (s.bilibili) out.push(`<a href="${s.bilibili}" target="_blank" rel="noopener">Bilibili</a>`);
  if (s.weibo) out.push(`<a href="${s.weibo}" target="_blank" rel="noopener">微博</a>`);
  return out.join('');
}

function socialLinksHtml() {
  const links = socialLinks();
  return links ? `<div class="socials">${links}</div>` : '';
}

function awardItem(a) {
  return `<div class="tl-item"><div class="date">${escapeHtml(a.date)}</div><div>${
    a.link
      ? `<a class="name" href="${a.link}" target="_blank" rel="noopener">${escapeHtml(a.name)}</a>`
      : `<span class="name">${escapeHtml(a.name)}</span>`
  }${a.level ? `<span class="lvl">${escapeHtml(a.level)}</span>` : ''}</div>${
    a.desc ? `<div style="color:var(--text-soft);font-size:14px">${escapeHtml(a.desc)}</div>` : ''
  }</div>`;
}

function projectCard(p) {
  const d = p.data;
  const awards = (d.awards || []).length
    ? `<span class="tag" style="background:var(--accent-soft);color:var(--warn)">🏆 ${(d.awards || []).length} 项荣誉</span>`
    : '';
  const tags = (d.tags || [])
    .slice(0, 4)
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join('');
  return `<a class="card" href="/projects/${p.slug}/"><div class="meta"><span class="tag">${escapeHtml(d.status || '')}</span>${awards}<span>${fmt(d.date)}</span></div><h2>${escapeHtml(d.title)}</h2><p class="desc">${escapeHtml(d.description || '')}</p>${
    tags ? `<div class="meta">${tags}</div>` : ''
  }</a>`;
}

// 项目链接渲染:支持 pending 状态
function projectLink(url, label, status) {
  if (url && url.startsWith('https://')) {
    return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
  }
  if (status === 'pending') {
    return `<span class="link-pending">${label}</span>`;
  }
  return '';
}

function shareHtml(title, pageUrl) {
  const u = encodeURIComponent(pageUrl);
  const t = encodeURIComponent(title);
  return `<div class="share"><a href="https://service.weibo.com/share/share.php?url=${u}&title=${t}" target="_blank" rel="noopener">微博</a><a href="https://twitter.com/intent/tweet?url=${u}&text=${t}" target="_blank" rel="noopener">X / Twitter</a><button id="copy-link" data-url="${escapeHtml(pageUrl)}">复制链接</button></div><script>(function(){var b=document.getElementById('copy-link');if(b){b.addEventListener('click',function(){navigator.clipboard.writeText(b.getAttribute('data-url')).then(function(){b.textContent='已复制 ✓';setTimeout(function(){b.textContent='复制链接';},1500);}).catch(function(){b.textContent='复制失败';});});}})();</script>`;
}

function commentHtml() {
  return `<div class="notice" style="margin-top:30px">留言功能暂未开放</div>`;
}

// ---------- 各页面 ----------
function home() {
  const latest = posts.slice(0, 4);
  const featured = projects[0];
  const awards = (resume.awards || []).slice(0, 4);
  const stats = [
    posts.length ? { value: posts.length, label: '篇笔记' } : null,
    projects.length ? { value: projects.length, label: '个项目' } : null,
    awards.length ? { value: awards.length, label: '项荣誉' } : null,
  ].filter(Boolean);
  const topSkills = (resume.skills || []).flatMap((s) => s.items).slice(0, 6);
  const cats = Object.entries(config.categories);

  const jsonLd = [
    generateJsonLd('website'),
    generateJsonLd('person')
  ].filter(Boolean);

  const body = HomePageBody({
    resume,
    stats,
    skills: topSkills,
    featured,
    posts: latest,
    awards,
    categories: cats,
  });

  return layout({
    title: '',
    description: '',
    active: '/',
    body,
    jsonLd,
    canonical: config.site.url + '/'
  });
}

function about() {
  const edu = (resume.education || [])
    .map(
      (e) =>
        `<div class="card" style="margin-top:12px"><div class="meta"><span>${escapeHtml(e.period)}</span></div><h3>${escapeHtml(e.school)} · ${escapeHtml(e.major)}</h3><p class="desc">${escapeHtml(e.degree)}</p></div>`
    )
    .join('');
  const skills = (resume.skills || [])
    .map(
      (s) =>
        `<div class="skill-group"><div class="g">${escapeHtml(s.group)}</div><div class="skill-tags">${s.items
          .map((i) => `<span>${escapeHtml(i)}</span>`)
          .join('')}</div></div>`
    )
    .join('');
  const awards = (resume.awards || [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(awardItem)
    .join('');
  const exp = (resume.experience || [])
    .map(
      (x) =>
        `<div class="tl-item"><div class="date">${escapeHtml(x.date)}</div><div><span class="name">${escapeHtml(x.org)}</span> · ${escapeHtml(x.role)}</div>${
          x.desc ? `<div style="color:var(--text-soft);font-size:14px">${escapeHtml(x.desc)}</div>` : ''
        }</div>`
    )
    .join('');
    
  const jsonLd = generateJsonLd('person');
  
  const body = `
  <section class="hero"><div class="row"><img class="avatar" src="${resume.avatar}" alt="${escapeHtml(resume.name)}"><div><h1>${escapeHtml(resume.name)}</h1><p class="lead">${escapeHtml(resume.title || '')}</p><p style="color:var(--text-soft);max-width:620px">${escapeHtml(resume.summary || '')}</p>${socialLinksHtml()}</div></div></section>
  <section class="section"><h2>🎓 教育背景</h2>${edu}</section>
  <section class="section"><h2>🛠 技能栈</h2><div class="card" style="margin-top:12px">${skills}</div></section>
  ${awards ? `<section class="section"><h2>🏆 获奖荣誉</h2><div class="timeline" style="margin-top:14px">${awards}</div></section>` : ''}
  ${exp ? `<section class="section"><h2>💼 经历</h2><div class="timeline" style="margin-top:14px">${exp}</div></section>` : ''}`;
  
  return layout({ 
    title: '关于 / 履历', 
    description: `${resume.name} 的履历:教育、技能与经历`, 
    active: '/about/', 
    body, 
    jsonLd,
    pageUrl: '/about/'
  });
}

function blogIndex() {
  if (!posts.length) {
    const body = `
    <section style="margin-top:28px"><h1 style="font-size:26px;margin:0 0 4px">学习笔记</h1><p style="color:var(--text-mute);margin:0 0 18px">技术文章将在整理完成后发布。</p><div class="notice" style="margin-top:24px">暂无公开笔记</div></section>`;
    return layout({
      title: '学习笔记',
      description: 'MostarManus 的技术笔记',
      active: '/blog/',
      body,
      pageUrl: '/blog/',
      canonical: config.site.url + '/blog/'
    });
  }


  const body = `
  <section class="rx-blog-index" style="margin-top:28px"><h1 style="font-size:26px;margin:0 0 4px">学习笔记</h1><p style="color:var(--text-mute);margin:0 0 16px">bug 是怎么解决的、技术是怎么学起来的 —— 都记在这里。</p>
  <div class="rx-filter-bar">
  <div id="filters" role="group" aria-label="筛选选项">
    ${Object.entries(config.categories)
      .map(([k, v]) => `<button data-filter="${k}" role="button" aria-pressed="false">${escapeHtml(v.label)}</button>`)
      .join('')}
  </div>
  <details class="rx-filter-more"><summary><span class="rx-filter-more-open">展开</span><span class="rx-filter-more-close">收起</span></summary><p>暂无更多筛选</p></details>
  <div role="status" aria-live="polite" id="filter-result" class="rx-filter-count">共 ${posts.length} 篇笔记</div>
  </div>
  <div class="grid rx-grid" id="post-grid" style="margin-top:18px">${posts.map((p) => renderPostCard(p)).join('')}</div>
  <div id="empty-state" style="display:none;text-align:center;padding:40px 20px;color:var(--text-mute);"><p>没有找到符合条件的文章</p></div></section>`;

  return layout({
    title: '学习笔记',
    description: '机器人小车的排错记录与学习途径',
    active: '/blog/',
    body,
    pageUrl: '/blog/',
    canonical: config.site.url + '/blog/'
  });
}

function postPage(p, prev, next) {
  const d = p.data;
  const cat = config.categories[d.category] || config.categories.note;
  const pageUrl = `${config.site.url}/blog/${p.slug}/`;
  const tags = (d.tags || [])
    .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
    .join('');

  const breadcrumbJsonLd = generateJsonLd('breadcrumb', {
    items: [
      { name: '首页', url: config.site.url + '/' },
      { name: '学习笔记', url: config.site.url + '/blog/' },
      { name: d.title, url: pageUrl }
    ]
  });

  const blogPostJsonLd = generateJsonLd('blogpost', {
    ...d,
    url: pageUrl
  });

  const jsonLd = [blogPostJsonLd, breadcrumbJsonLd].filter(Boolean);
  const metaHtml = PostMeta({ post: p });
  const relatedHtml = RelatedPosts({ currentSlug: p.slug, posts, limit: 3 });
  const hasToc = (p.html.match(/<h[23]\b/g) || []).length >= 2;

  const body = `
  <div class="article-layout${hasToc ? ' article-layout--with-toc' : ''}"><article class="rx-article" style="margin-top:24px"><div class="post-head">${metaHtml}<h1>${escapeHtml(d.title)}</h1><p style="color:var(--text-soft);margin:6px 0 0">${escapeHtml(d.description || '')}</p>${
    tags ? `<div class="post-meta" style="margin-top:10px">${tags}</div>` : ''
  }</div><div class="prose">${p.html}</div>${shareHtml(d.title, pageUrl)}<nav class="pager">${
    prev
      ? `<a href="/blog/${prev.slug}/"><div class="label">← 上一篇</div><div class="ttl">${escapeHtml(prev.data.title)}</div></a>`
      : '<span></span>'
  }${
    next
      ? `<a href="/blog/${next.slug}/" style="text-align:right"><div class="label">下一篇 →</div><div class="ttl">${escapeHtml(next.data.title)}</div></a>`
      : '<span></span>'
  }</nav>${relatedHtml}${commentHtml()}</article>${hasToc ? '<aside id="article-navigator-root" class="article-navigator-root"></aside>' : ''}</div>`;

  return layout({
    title: d.title,
    description: d.description,
    active: '/blog/',
    body,
    jsonLd,
    type: 'article',
    pageUrl: `/blog/${p.slug}/`,
    imageUrl: `${config.site.url}/og-image.png`
  });
}

function projectsIndex() {
  const body = `
  <section style="margin-top:28px"><h1 style="font-size:26px;margin:0 0 4px">项目</h1><p style="color:var(--text-mute);margin:0 0 18px">从一台会动的小车,到拿奖的作品。</p><div class="grid">${projects
    .map(projectCard)
    .join('')}</div></section>`;
    
  return layout({ 
    title: '项目', 
    description: '机器人小车项目与获奖情况', 
    active: '/projects/', 
    body,
    pageUrl: '/projects/'
  });
}

export function projectLinksHtml(links = {}) {
  const hasDemo = typeof links.demo === 'string' && links.demo.startsWith('https://');

  const parts = [];

  if (hasDemo) parts.push(`<a href="${links.demo}" target="_blank" rel="noopener">▶ 在线演示</a>`);


  return parts.length ? `<div class="share">${parts.join('')}</div>` : '';
}

function projectPage(p) {
  const d = p.data;
  const pageUrl = `${config.site.url}/projects/${p.slug}/`;
  const linksHtml = projectLinksHtml(d.links || {});
  
  const awards = (d.awards || []).length
    ? `<div class="notice">🏆 相关荣誉:${escapeHtml((d.awards || []).join('、'))}</div>`
    : '';
    
  const breadcrumbJsonLd = generateJsonLd('breadcrumb', {
    items: [
      { name: '首页', url: config.site.url + '/' },
      { name: '项目', url: config.site.url + '/projects/' },
      { name: d.title, url: pageUrl }
    ]
  });
  
  const workJsonLd = generateJsonLd('creativework', {
    ...d,
    url: pageUrl
  });
  
  const jsonLd = [workJsonLd, breadcrumbJsonLd].filter(Boolean);
  const hasToc = (p.html.match(/<h[23]\b/g) || []).length >= 2;

  const body = `
  <div class="article-layout${hasToc ? ' article-layout--with-toc' : ''}"><article class="rx-article" style="margin-top:24px"><div class="post-head"><div class="post-meta"><span class="tag">${escapeHtml(
    d.status || ''
  )}</span><span>${fmt(d.date)}</span>${d.role ? `<span>角色:${escapeHtml(d.role)}</span>` : ''}</div><h1>${escapeHtml(
    d.title
  )}</h1><p style="color:var(--text-soft);margin:6px 0 0">${escapeHtml(d.description || '')}</p>${
    (d.tags || []).length
      ? `<div class="post-meta" style="margin-top:10px">${(d.tags || [])
          .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
          .join('')}</div>`
      : ''
  }</div>${awards}${linksHtml}<div class="prose">${p.html}</div>${shareHtml(d.title, pageUrl)}${commentHtml()}</article>${hasToc ? '<aside id="article-navigator-root" class="article-navigator-root"></aside>' : ''}</div>`;
  
  return layout({ 
    title: d.title, 
    description: d.description, 
    active: '/projects/', 
    body, 
    jsonLd,
    type: 'article',
    pageUrl: `/projects/${p.slug}/`
  });
}

function friendsPage() {
  const body = `
  <section style="margin-top:28px"><h1 style="font-size:26px;margin:0 0 4px">友链</h1><p style="color:var(--text-mute);margin:0 0 18px">一起折腾硬件、写技术博客的朋友们。</p><div class="grid">${friends
    .map(
      (f) =>
        `<a class="card" href="${f.url}" target="_blank" rel="noopener"><h3>${escapeHtml(
          f.name
        )}</h3>${f.desc ? `<p class="desc">${escapeHtml(f.desc)}</p>` : ''}<div class="meta"><span>${escapeHtml(
          f.url
        )}</span></div></a>`
    )
    .join('')}</div><div class="notice" style="margin-top:24px">友链整理中，欢迎来信交流</div></section>`;

  return layout({
    title: '友链',
    description: '志同道合的朋友与博客',
    active: '/friends/',
    body,
    pageUrl: '/friends/'
  });
}

// ---------- 术语表页面 ----------
function requireGlossaryString(value, field, id) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`glossary ${id}: missing/invalid ${field}`);
  }
}

function requireGlossaryStringArray(value, field, id) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`glossary ${id}: ${field} must be an array of non-empty strings`);
  }
}

export function validateGlossary(data) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('glossary.json must be a non-empty array');
  }

  const ids = new Set();
  const categories = new Set();
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('glossary: every entry must be an object');
    }
    if (typeof item.id !== 'string' || !/^[a-z0-9_-]+$/.test(item.id)) {
      throw new Error('glossary: missing/invalid id');
    }
    if (ids.has(item.id)) throw new Error(`glossary: duplicate id "${item.id}"`);
    ids.add(item.id);

    requireGlossaryString(item.term, 'term', item.id);
    requireGlossaryString(item.category, 'category', item.id);
    requireGlossaryString(item.summary, 'summary', item.id);
    if (item.fullName !== undefined) requireGlossaryString(item.fullName, 'fullName', item.id);
    requireGlossaryStringArray(item.aliases, 'aliases', item.id);
    requireGlossaryStringArray(item.details, 'details', item.id);
    requireGlossaryStringArray(item.related, 'related', item.id);

    if (item.articleRefs !== undefined) {
      requireGlossaryStringArray(item.articleRefs, 'articleRefs', item.id);
      for (const ref of item.articleRefs) {
        if (!isSafeInternalPath(ref)) {
          throw new Error(`glossary ${item.id}: unsafe articleRef "${ref}"`);
        }
      }
    }

    categories.add(item.category);
  }

  for (const item of data) {
    for (const ref of item.related || []) {
      if (!ids.has(ref)) {
        throw new Error(`glossary ${item.id}: references unknown related id "${ref}"`);
      }
    }
  }

  return { ids, categories };
}

function termsPage() {
  const { categories: validCategories } = validateGlossary(glossary);
  const categoryList = [...validCategories].sort();
  const glossaryById = new Map(glossary.map((item) => [item.id, item]));

  // DefinedTermSet JSON-LD
  const definedTermSetJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    name: '专业术语',
    description: '机器人、ROS 2、导航、语音交互与具身智能领域专业术语参考',
    url: config.site.url + '/terms/',
    inLanguage: config.site.lang,
    hasDefinedTerm: glossary.map((t) => ({
      '@type': 'DefinedTerm',
      name: t.term,
      description: t.summary,
      alternateName: t.fullName || undefined,
    }))
  });

  // BreadcrumbList JSON-LD
  const breadcrumbJsonLd = generateJsonLd('breadcrumb', {
    items: [
      { name: '首页', url: config.site.url + '/' },
      { name: '专业术语', url: config.site.url + '/terms/' }
    ]
  });

  const jsonLd = [definedTermSetJsonLd, breadcrumbJsonLd].filter(Boolean);

  // Build term cards HTML with safe escaping (no-JS readable fallback)
  const termCards = glossary.map((t) => {
    const detailsHtml = (t.details && t.details.length)
      ? `<details class="term-details"><summary>详细解释</summary><ul>${t.details.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul></details>`
      : '';

    const relatedHtml = (t.related && t.related.length)
      ? `<div class="term-related"><span class="term-label">关联:</span> ${t.related.map(r => {
          const target = glossaryById.get(r);
          return target ? `<a href="#${escapeHtml(r)}" class="term-link">${escapeHtml(target.term)}</a>` : escapeHtml(r);
        }).join(', ')}</div>`
      : '';

    const articleRefHtml = (t.articleRefs && t.articleRefs.length)
      ? `<div class="term-refs"><span class="term-label">相关文章:</span> ${t.articleRefs.map(ref => `<a href="${escapeHtml(ref)}">查看</a>`).join(' ')}</div>`
      : '';

    const aliasesHtml = (t.aliases && t.aliases.length)
      ? `<span class="term-aliases">(${t.aliases.map(a => escapeHtml(a)).join('、')})</span>`
      : '';

    return `<article class="term-card" id="${escapeHtml(t.id)}">
      <header class="term-header">
        <h2 class="term-name">${escapeHtml(t.term)}</h2>
        ${aliasesHtml}
        ${t.fullName ? `<span class="term-fullname">${escapeHtml(t.fullName)}</span>` : ''}
      </header>
      <div class="term-body">
        <span class="term-cat badge-cat badge-note">${escapeHtml(t.category)}</span>
        <p class="term-summary">${escapeHtml(t.summary)}</p>
        ${detailsHtml}
        ${relatedHtml}
        ${articleRefHtml}
      </div>
    </article>`;
  }).join('');

  const termsDataPayload = {
    terms: glossary,
    categories: categoryList,
    perPage: TERMS_PER_PAGE,
  };

  const body = `
  <section class="terms-page" id="terms-explorer-root">
    <h1 class="terms-title">专业术语</h1>
    <p class="terms-intro">面向机器人、ROS 2、导航、语音交互与具身智能学习者的可查询术语参考。</p>

    <!-- 搜索框 -->
    <div class="terms-search-wrap">
      <label for="terms-search" class="terms-search-label">搜索术语</label>
      <p id="terms-search-hint" class="terms-search-hint">优先匹配术语名、英文全称和别名；摘要中的命中会显示为“相关内容”。</p>
      <input type="search" id="terms-search" class="terms-search" placeholder="优先搜索术语名、英文名或别名" autocomplete="off" aria-describedby="terms-search-hint terms-count">
    </div>

    <!-- 分类筛选 -->
    <div id="terms-categories" role="group" aria-label="按分类筛选" class="terms-cats">
      <button type="button" data-category="all" class="active" aria-pressed="true" aria-controls="terms-results">全部</button>
      ${categoryList.map(c => `<button type="button" data-category="${escapeHtml(c)}" aria-pressed="false" aria-controls="terms-results">${escapeHtml(c)}</button>`).join('')}
    </div>

    <!-- 结果计数 -->
    <div role="status" aria-live="polite" id="terms-count" class="terms-count">共 ${glossary.length} 个术语</div>

    <!-- 无结果状态 -->
    <div id="terms-empty" class="terms-empty" hidden>
      <p>未找到匹配术语</p>
      <button type="button" id="terms-clear-btn" class="btn btn-outline">清除筛选</button>
    </div>

    <!-- 术语结果：常规分页列表与搜索分区共用同一批卡片，避免重复 ID。 -->
    <div id="terms-results" class="terms-results">
      <div id="terms-list" class="terms-grid">${termCards}</div>

      <section id="terms-primary-section" class="terms-search-section" aria-labelledby="terms-primary-title" hidden>
        <div class="terms-search-section-head">
          <h2 id="terms-primary-title" class="terms-search-section-title">最强相关术语</h2>
          <p id="terms-primary-copy" class="terms-search-section-copy">按术语名匹配</p>
        </div>
        <div id="terms-primary-list" class="terms-grid"></div>
      </section>

      <section id="terms-related-section" class="terms-search-section terms-related-results" aria-labelledby="terms-related-title" hidden>
        <div class="terms-search-section-head">
          <h2 id="terms-related-title" class="terms-search-section-title">相关内容</h2>
          <p id="terms-related-copy" class="terms-search-section-copy">术语摘要中的相关匹配</p>
        </div>
        <div id="terms-related-list" class="terms-grid"></div>
      </section>
    </div>

    <!-- 分页导航（由脚本根据当前筛选结果渲染） -->
    <nav id="terms-pagination" class="terms-pagination" aria-label="术语分页" hidden></nav>
  </section>
  <script id="terms-data" type="application/json">${safeJsonForScript(termsDataPayload)}</script>`;

  return layout({
    title: '专业术语',
    description: '机器人、ROS 2、导航、语音交互与具身智能领域专业术语参考',
    active: '/terms/',
    body,
    jsonLd,
    pageUrl: '/terms/',
  });
}

// ---------- 求职专栏页面 ----------
function jobsPage() {
  const { techStack, positions, dataAsOf } = jobsData;
  const stackById = new Map(techStack.map((item) => [item.id, item]));

  const breadcrumbJsonLd = generateJsonLd('breadcrumb', {
    items: [
      { name: '首页', url: config.site.url + '/' },
      { name: '求职专栏', url: config.site.url + '/jobs/' }
    ]
  });

  // no-JS 可读降级:板块面板全量渲染(岗位面板默认 hidden,noscript 时展开)。
  const stackCards = techStack.map((item) => {
    const relatedHtml = (item.related || []).length
      ? `<div class="term-related"><span class="term-label">关联:</span> ${item.related.map((ref) => {
          const target = stackById.get(ref);
          return target ? `<a href="#${escapeHtml(ref)}" class="term-link">${escapeHtml(target.name)}</a>` : escapeHtml(ref);
        }).join(' <span class="jobs-tag-sep">·</span> ')}</div>`
      : '';

    return `<article class="term-card tech-card" id="${escapeHtml(item.id)}">
      <header class="term-header">
        <span class="tech-rank" aria-hidden="true">${item.rank}</span>
        <h2 class="term-name">${escapeHtml(item.name)}</h2>
        <span class="term-fullname">${escapeHtml(item.category)}</span>
      </header>
      <div class="term-body">
        <div class="tech-demand" aria-label="要求该技术栈的岗位 ${item.count} / 15，占比 ${item.percent}%">
          <div class="tech-demand-track" aria-hidden="true"><div class="tech-demand-fill" style="width:${item.percent}%"></div></div>
          <span class="tech-demand-text">${item.count} / 15 · ${item.percent}%</span>
        </div>
        <p class="term-summary">${escapeHtml(item.summary)}</p>
        ${relatedHtml}
      </div>
    </article>`;
  }).join('');

  const jobCards = positions.map((p) => `<article class="term-card job-card" id="${escapeHtml(p.id)}">
      <header class="term-header">
        <h2 class="term-name">${escapeHtml(p.title)}</h2>
        <span class="job-tier job-tier--${p.tier === '强推' ? 'strong' : 'ok'}">${escapeHtml(p.tier)}</span>
      </header>
      <div class="term-body">
        <div class="job-company">
          <span class="job-company-name">${escapeHtml(p.company)}</span>
          <span class="job-score" aria-label="匹配分 ${p.matchScore}">匹配分 ${p.matchScore}</span>
        </div>
        <div class="job-meta"><span>💰 ${escapeHtml(p.salary)}</span><span>📍 ${escapeHtml(p.location)}</span><span>🎓 ${escapeHtml(p.degree)}</span>${p.scale ? `<span>🏢 ${escapeHtml(p.scale)}</span>` : ''}</div>
        <p class="term-summary job-jd">${escapeHtml(p.jd)}</p>
        ${(p.stack || []).length ? `<div class="term-related job-stack-tags">${p.stack.map((name) => `<span class="tag">${escapeHtml(name)}</span>`).join('')}</div>` : ''}
        <div class="term-refs"><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">查看原始岗位页 ↗</a></div>
      </div>
    </article>`).join('');

  const jobsDataPayload = {
    techStack,
    positions,
    dataAsOf,
  };

  const body = `
  <noscript><style>#jobs-jobs-panel[hidden]{display:block !important}.jobs-switch-row{display:none !important}</style></noscript>
  <section class="jobs-page" id="jobs-explorer-root">
    <div class="jobs-head">
      <div class="jobs-head-copy">
        <h1 class="terms-title">求职专栏</h1>
        <p class="terms-intro">杭州机器人实习求职市场速览：技术栈需求优先级与本科可投岗位 JD 一一对应。</p>
      </div>
      <span class="jobs-asof" role="note" aria-label="数据截止 ${escapeHtml(dataAsOf)}"><span class="jobs-asof-dot" aria-hidden="true"></span>数据截止 ${escapeHtml(dataAsOf)}</span>
    </div>
    <div class="jobs-switch-row" role="group" aria-label="求职专栏板块切换">
      <button type="button" class="jobs-tab-label active" data-tab="stack" aria-pressed="true">技术栈需求</button>
      <button type="button" class="jobs-toggle" role="switch" aria-checked="false" aria-label="切换到岗位 JD 板块"><span class="jobs-toggle-knob" aria-hidden="true"></span></button>
      <button type="button" class="jobs-tab-label" data-tab="jobs" aria-pressed="false">岗位 JD</button>
    </div>
    <div role="status" aria-live="polite" id="jobs-count" class="terms-count">显示 1–${Math.min(STACK_PER_PAGE, techStack.length)} / 共 ${techStack.length} 项技术栈，第 1 / ${jobsTotalPages(techStack.length, STACK_PER_PAGE)} 页</div>
    <div id="jobs-results">
      <section id="jobs-stack-panel" class="jobs-panel" role="tabpanel" aria-labelledby="jobs-stack-panel-title">
        <h2 id="jobs-stack-panel-title" class="jobs-panel-title">技术栈需求优先级 <small>按要求的岗位数量排序</small></h2>
        <div class="terms-grid jobs-grid">${stackCards}</div>
      </section>
      <section id="jobs-jobs-panel" class="jobs-panel" role="tabpanel" aria-labelledby="jobs-jobs-panel-title" hidden>
        <h2 id="jobs-jobs-panel-title" class="jobs-panel-title">在招岗位 JD <small>第一梯队（强推）在前，与公司一一对应</small></h2>
        <div class="terms-grid jobs-grid">${jobCards}</div>
      </section>
    </div>
    <nav id="jobs-pagination" class="terms-pagination" aria-label="求职专栏分页" hidden></nav>
  </section>
  <script id="jobs-data" type="application/json">${safeJsonForScript(jobsDataPayload)}</script>`;

  return layout({
    title: '求职专栏',
    description: '杭州机器人实习求职专栏：技术栈需求优先级排名与本科可投岗位 JD 详情',
    active: '/jobs/',
    body,
    jsonLd: [breadcrumbJsonLd],
    pageUrl: '/jobs/',
  });
}

function rss() {
  const items = [
    ...posts.map((p) => ({
      title: p.data.title,
      description: p.data.description || '',
      pubDate: p.data.pubDate,
      link: `/blog/${p.slug}/`,
      cats: [p.data.category, ...(p.data.tags || [])],
    })),
    ...projects.map((p) => ({
      title: `[项目] ${p.data.title}`,
      description: p.data.description || '',
      pubDate: p.data.date,
      link: `/projects/${p.slug}/`,
      cats: p.data.tags || [],
    })),
  ];
  
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeXml(config.site.title)}</title>
  <link>${config.site.url}</link>
  <description>${escapeXml(config.site.description)}</description>
  <atom:link href="${config.site.url}/rss.xml" rel="self" type="application/rss+xml"/>
  ${items
    .map(
      (it) =>
        `<item><title>${escapeXml(it.title)}</title><link>${config.site.url}${it.link}</link><guid isPermaLink="true">${config.site.url}${it.link}</guid><description>${escapeXml(it.description)}</description><pubDate>${new Date(it.pubDate).toUTCString()}</pubDate>${it.cats
          .map((c) => `<category>${escapeXml(c)}</category>`)
          .join('')}</item>`
    )
    .join('')}
</channel></rss>`;
  return xml;
}

function notFound() {
  const body = `<section style="text-align:center;padding:80px 0"><h1 style="font-size:48px;margin:0">404</h1><p style="color:var(--text-mute)">这台小车迷路了 🤖</p><a class="btn" href="/">回到首页</a></section>`;
  return layout({ title: '页面未找到', body });
}

// ---------- sitemap ----------
function sitemap() {
  const now = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: config.site.url + '/', priority: '1.0', changefreq: 'weekly' },
    { loc: config.site.url + '/blog/', priority: '0.9', changefreq: 'weekly' },
    { loc: config.site.url + '/projects/', priority: '0.8', changefreq: 'monthly' },
    { loc: config.site.url + '/about/', priority: '0.7', changefreq: 'monthly' },
    { loc: config.site.url + '/friends/', priority: '0.5', changefreq: 'monthly' },
    { loc: config.site.url + '/terms/', priority: '0.6', changefreq: 'monthly' },
    { loc: config.site.url + '/jobs/', priority: '0.6', changefreq: 'weekly' },
    ...posts.map((p) => ({
      loc: `${config.site.url}/blog/${p.slug}/`,
      lastmod: p.data.pubDate,
      priority: '0.8',
      changefreq: 'monthly'
    })),
    ...projects.map((p) => ({
      loc: `${config.site.url}/projects/${p.slug}/`,
      lastmod: p.data.date,
      priority: '0.7',
      changefreq: 'monthly'
    }))
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority><changefreq>${u.changefreq}</changefreq></url>`).join('\n')}
</urlset>`;
}

function robots() {
  return `User-agent: *
Allow: /
Sitemap: ${config.site.url}/sitemap.xml`;
}

// ---------- 写出 ----------
function atomicWrite(full, content) {
  let lastErr;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      fs.writeFileSync(full, content, 'utf8');
      return;
    } catch (e) {
      lastErr = e;
      if (['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        const end = Date.now() + 60 + attempt * 40;
        while (Date.now() < end) {}
      } else {
        throw e;
      }
    }
  }
  throw lastErr;
}

function write(distDir, file, content) {
  const full = path.join(distDir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  atomicWrite(full, content);
}

// 过滤版本的 public 复制(排除残留文件)
const EXCLUDE_FROM_PUBLIC = new Set([
  'logo.b64.txt',           // 编辑者残留
  'global.warm-backup.css', // 备份文件
  'styles/global.css',      // 已写入 /assets/ 的哈希 CSS
]);

function shouldExcludePublicPath(publicPath) {
  return EXCLUDE_FROM_PUBLIC.has(publicPath)
    || /^assets\/global-[a-f0-9]{12}\.css$/.test(publicPath);
}

function copyPublicFiltered(distDir) {
  if (!fs.existsSync(PUBLIC)) return;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // 跳过排除文件
      const publicPath = path.join(rel, entry.name).replaceAll(path.sep, '/');
      if (!entry.isDirectory() && shouldExcludePublicPath(publicPath)) {
        console.log(`[build] 排除残留文件: ${publicPath}`);
        continue;
      }
      const src = path.join(dir, entry.name);
      const dest = path.join(distDir, rel, entry.name);
      if (entry.isDirectory()) {
        walk(src, path.join(rel, entry.name));
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        let lastErr;
        for (let attempt = 0; attempt < 15; attempt++) {
          try {
            fs.copyFileSync(src, dest);
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
              const end = Date.now() + 60 + attempt * 40;
              while (Date.now() < end) {}
            } else {
              throw e;
            }
          }
        }
        if (lastErr) throw lastErr;
      }
    }
  };
  walk(PUBLIC, '');
}

function copyHashedFont(tmpDist, sourcePath, assetPrefix, packageName) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`字体文件未找到: ${packageName}`);
  }

  const content = fs.readFileSync(sourcePath);
  const filename = `${assetPrefix}-${fileHash(content)}.woff2`;
  const fontDest = path.join(tmpDist, 'assets', filename);
  fs.copyFileSync(sourcePath, fontDest);

  const licenseSource = path.join(ROOT, 'node_modules', packageName, 'LICENSE');
  if (!fs.existsSync(licenseSource)) {
    throw new Error(`字体许可证未找到: ${packageName}/LICENSE`);
  }
  const licenseDest = path.join(tmpDist, 'assets', 'licenses', `${assetPrefix}-LICENSE.txt`);
  fs.mkdirSync(path.dirname(licenseDest), { recursive: true });
  fs.copyFileSync(licenseSource, licenseDest);

  return filename;
}

function renameWithRetry(source, destination) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt === 19) break;
      const waitUntil = Date.now() + 100 + attempt * 25;
      while (Date.now() < waitUntil) {}
    }
  }
  throw lastError;
}

function publishBuild(tmpDist, buildId, distDir = DIST) {
  const previousDist = path.join(path.dirname(distDir), `${path.basename(distDir)}.previous-${buildId}`);
  let movedCurrent = false;

  try {
    if (fs.existsSync(distDir)) {
      renameWithRetry(distDir, previousDist);
      movedCurrent = true;
    }
    renameWithRetry(tmpDist, distDir);
  } catch (error) {
    if (movedCurrent && !fs.existsSync(distDir) && fs.existsSync(previousDist)) {
      try {
        renameWithRetry(previousDist, distDir);
      } catch (restoreError) {
        console.error('[error] 无法恢复上一版 dist-build:', restoreError.message);
      }
    }
    throw error;
  }

  if (movedCurrent) {
    try {
      fs.rmSync(previousDist, { recursive: true, force: true });
    } catch (error) {
      console.warn('[warn] 已发布新产物，但无法清理上一版构建目录:', error.message);
    }
  }
}

export function buildSite({ distDir = DIST, tmpRoot = path.dirname(distDir) } = {}) {
  const buildId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const tmpDist = path.join(tmpRoot, `${path.basename(distDir)}.tmp-${buildId}`);

  if (fs.existsSync(tmpDist)) {
    throw new Error(`本次构建临时目录已存在: ${path.basename(tmpDist)}`);
  }

  assetMap.clear();
  fontFaceCss = '';
  fs.mkdirSync(tmpRoot, { recursive: true });
  fs.mkdirSync(tmpDist, { recursive: false });
  console.log(`构建中...临时目录: ${path.basename(tmpDist)}`);

  try {
    console.log('[build] 处理 CSS 资产哈希...');
    const cssSrcPath = path.join(PUBLIC, 'styles', 'global.css');
    if (!fs.existsSync(cssSrcPath)) throw new Error('缺少 public/styles/global.css');
    const cssContent = fs.readFileSync(cssSrcPath, 'utf8');
    const cssHashedName = `global-${fileHash(cssContent)}.css`;
    assetMap.set('global.css', cssHashedName);
    fs.mkdirSync(path.join(tmpDist, 'assets'), { recursive: true });
    atomicWrite(path.join(tmpDist, 'assets', cssHashedName), cssContent);

    console.log('[build] 处理自托管字体...');
    const loraFilename = copyHashedFont(
      tmpDist,
      loraWoff2Path,
      'lora-variable',
      '@fontsource-variable/lora'
    );
    const jetbrainsFilename = copyHashedFont(
      tmpDist,
      jetbrainsWoff2Path,
      'jetbrains-mono-variable',
      '@fontsource-variable/jetbrains-mono'
    );
    fontFaceCss = `<style>
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/assets/${loraFilename}') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 100 800;
  font-display: swap;
  src: url('/assets/${jetbrainsFilename}') format('woff2');
}
</style>`;

    console.log('[build] 打包 React 客户端组件...');
    const clientFilenames = buildClientAssets(tmpDist);
    const versionHash = createHash('sha256');
    for (const dir of [SRC, PUBLIC]) {
      const hashDirectory = (directory) => {
        for (const name of fs.readdirSync(directory).sort()) {
          const file = path.join(directory, name);
          if (fs.statSync(file).isDirectory()) hashDirectory(file);
          else versionHash.update(path.relative(ROOT, file)).update(fs.readFileSync(file));
        }
      };
      hashDirectory(dir);
    }
    navigationVersion = versionHash.update(clientFilenames.sort().join(',')).digest('hex').slice(0, 16);

    console.log('[build] 生成页面 HTML...');
    write(tmpDist, 'index.html', home());
    write(tmpDist, 'about/index.html', about());
    write(tmpDist, 'blog/index.html', blogIndex());
    posts.forEach((p, idx) => {
      const prev = idx < posts.length - 1 ? posts[idx + 1] : undefined;
      const next = idx > 0 ? posts[idx - 1] : undefined;
      write(tmpDist, `blog/${p.slug}/index.html`, postPage(p, prev, next));
    });
    write(tmpDist, 'projects/index.html', projectsIndex());
    projects.forEach((p) => write(tmpDist, `projects/${p.slug}/index.html`, projectPage(p)));
    write(tmpDist, 'friends/index.html', friendsPage());
    write(tmpDist, 'terms/index.html', termsPage());
    write(tmpDist, 'jobs/index.html', jobsPage());
    write(tmpDist, 'rss.xml', rss());
    write(tmpDist, 'sitemap.xml', sitemap());
    write(tmpDist, 'robots.txt', robots());
    write(tmpDist, 'search-index.json', JSON.stringify(createSearchIndex()));
    write(tmpDist, '404.html', notFound());

    console.log('[build] 复制 public 资源...');
    copyPublicFiltered(tmpDist);

    const criticalResources = [
      'index.html',
      `assets/${cssHashedName}`,
      `assets/${loraFilename}`,
      `assets/${jetbrainsFilename}`,
      ...clientFilenames.map((name) => `assets/${name}`),
      'assets/licenses/lora-variable-LICENSE.txt',
      'assets/licenses/jetbrains-mono-variable-LICENSE.txt',
      'favicon.svg',
      'avatar.svg',
      'og-image.png',
      'search-index.json',
      '404.html',
    ];
    for (const resource of criticalResources) {
      if (!fs.existsSync(path.join(tmpDist, resource))) {
        throw new Error(`关键资源缺失: ${resource}`);
      }
    }

    console.log('[build] 发布验证后的构建产物...');
    publishBuild(tmpDist, buildId, distDir);
    console.log(`✅ 构建完成:${posts.length} 篇笔记,${projects.length} 个项目 -> ${path.basename(distDir)} (${config.site.title})`);
  } catch (error) {
    if (fs.existsSync(tmpDist)) {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
    throw error;
  }
}

const currentModulePath = fileURLToPath(import.meta.url);
const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === currentModulePath;
if (isDirectExecution) {
  try {
    buildSite();
  } catch (error) {
    console.error(`[error] 构建失败: ${error.message}`);
    process.exitCode = 1;
  }
}
