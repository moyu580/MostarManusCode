// 静态站点构建脚本:读取 Markdown 内容 -> 生成静态 HTML
// 使用 gray-matter 解析 frontmatter, markdown-it 渲染内容
// 用法: node src/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { mdToHtml, escapeHtml, escapeXml } from './markdown.mjs';
import config from './config.mjs';
import { isValidCategory } from './filters.mjs';
import { getCompactPaginationItems, parsePaginationJump } from './pagination.mjs';

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

export function normalizeTermsText(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeTermsFilterState(query, category, validCategories) {
  const categories = validCategories instanceof Set ? validCategories : new Set(validCategories || []);
  const normalizedCategory = typeof category === 'string' && categories.has(category) ? category : 'all';

  return {
    query: typeof query === 'string' ? query.trim() : '',
    category: normalizedCategory,
  };
}

export function getTermNameMatchRank(term, query) {
  const search = normalizeTermsText(query);
  if (!search) return Number.POSITIVE_INFINITY;

  const fieldRank = (value, offset) => {
    const field = normalizeTermsText(value);
    if (!field) return Number.POSITIVE_INFINITY;
    if (field === search) return offset;
    if (field.startsWith(search)) return offset + 1;
    return field.includes(search) ? offset + 2 : Number.POSITIVE_INFINITY;
  };

  return Math.min(
    fieldRank(term?.term, 0),
    fieldRank(term?.fullName, 3),
    ...(term?.aliases || []).map((alias) => fieldRank(alias, 6)),
  );
}

export function matchesGlossaryRelatedContent(term, query) {
  const search = normalizeTermsText(query);
  if (!search) return false;

  const fields = [term?.summary];
  return fields.some((field) => typeof field === 'string' && normalizeTermsText(field).includes(search));
}

export function groupGlossarySearchResults(entries, query, category, validCategories) {
  const state = normalizeTermsFilterState(query, category, validCategories);
  const search = normalizeTermsText(state.query);
  const scopedEntries = entries.filter((term) => state.category === 'all' || term.category === state.category);

  if (!search) {
    return {
      state,
      isSearch: false,
      strongest: [],
      related: [],
      results: scopedEntries,
    };
  }

  const rankedEntries = scopedEntries.map((term, index) => ({
    term,
    index,
    rank: getTermNameMatchRank(term, search),
  }));
  const strongest = rankedEntries
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ term }) => term);
  const strongestIds = new Set(strongest.map((term) => term.id));
  const related = rankedEntries
    .filter(({ term }) => !strongestIds.has(term.id) && matchesGlossaryRelatedContent(term, search))
    .map(({ term }) => term);

  return {
    state,
    isSearch: true,
    strongest,
    related,
    results: [...strongest, ...related],
  };
}

export function filterGlossary(entries, query, category, validCategories) {
  return groupGlossarySearchResults(entries, query, category, validCategories).results;
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

// ---------- 资产哈希工具 ----------
function fileHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

// 全局资产映射: 原始文件名 -> 哈希文件名
// 在构建流程中填充
const assetMap = new Map();

// ---------- 布局 ----------
const themeInit = `<script>(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();</script>`;

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

  return `<!doctype html><html lang="${config.site.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" href="/logo.png"><link rel="icon" type="image/png" sizes="32x32" href="/logo.png"><title>${escapeHtml(pageTitle)}</title>
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
${fontFaceCss}
<link rel="stylesheet" href="${cssHref}">${themeInit}
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
  
  return `<header class="site-header" id="site-header"><div class="inner container"><a class="brand" href="/"><img src="/logo.png" alt="logo"><span>${escapeHtml(siteName)}</span></a><nav class="nav" id="main-nav">${nav}</nav>${toggleBtn}${mobileToggle}</div></header>`;
}

function footer() {
  const year = new Date().getFullYear();
  const navLinks = config.nav.map((n) => `<a href="${n.href}">${escapeHtml(n.label)}</a>`).join(' · ');
  return `<footer class="site-footer"><div class="inner container"><div>&copy; ${year} ${escapeHtml(siteName)} &middot; 静态构建</div><div>${navLinks} &middot; <a href="/rss.xml">RSS</a></div></div></footer>`;
}

function layout(opts) {
  const { title, description, active, body, jsonLd, type, pageUrl, imageUrl, canonical } = opts;
  const headOpts = { type, pageUrl, imageUrl, canonical, jsonLd };
  
  return `${head(title, description, headOpts)}
<body>
<a href="#main-content" class="skip-link">跳到正文</a>
<div class="progress-bar" id="progress-bar"></div>
${header(active)}
<main class="container" id="main-content">${body}</main>
${footer()}
<script>
document.addEventListener('DOMContentLoaded',function(){
  /* Theme toggle via event delegation */
  var toggle=function(){
    var isDark=document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme',isDark?'dark':'light');
    var btn=document.getElementById('theme-toggle');
    if(btn){
      btn.setAttribute('aria-pressed',String(isDark));
      btn.setAttribute('aria-label',isDark?'切换到浅色主题':'切换到深色主题');
    }
  };
  document.addEventListener('click',function(e){if(e.target.closest('#theme-toggle')){e.preventDefault();toggle();}});
  /* Reading progress bar */
  var pb=document.getElementById('progress-bar');
  if(pb){window.addEventListener('scroll',function(){var sc=window.scrollY,dh=document.documentElement.scrollHeight-window.innerHeight;pb.style.width=((sc/dh)*100)+'%';},{passive:true});}
  /* Smooth scroll to top on home link */
  var hl=document.querySelector('.nav a.active[href="/"]');if(hl)hl.addEventListener('click',function(e){if(location.pathname==='/'){e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});}});
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
  /* Scroll reveal animation */
  if(!window.matchMedia('(prefers-reduced-motion:reduce)').matches){var es=document.querySelectorAll('.section,.card,.spotlight,.award-card,.hero-card');es.forEach(function(e){e.classList.add('reveal');});var ob=new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting){x.target.classList.add('visible');ob.unobserve(x.target);}});},{threshold:0.08,rootMargin:'0px 0px -40px 0px'});es.forEach(function(e){ob.observe(e);});}
  /* Initialize theme button ARIA state */
  (function(){var btn=document.getElementById('theme-toggle');if(btn){btn.setAttribute('aria-pressed',String(document.documentElement.classList.contains('dark')));btn.setAttribute('aria-label',document.documentElement.classList.contains('dark')?'切换到浅色主题':'切换到深色主题');}})();
});
</script>
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

// ---------- 小组件 ----------
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

function postCard(p) {
  const d = p.data;
  const cat = config.categories[d.category] || config.categories.note;
  const tags = (d.tags || [])
    .slice(0, 4)
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join('');
  return `<a class="card" href="/blog/${p.slug}/" data-cat="${escapeHtml(d.category)}" data-tags="${escapeHtml((d.tags || []).join(' '))}"><div class="meta"><span class="badge-cat badge-${escapeHtml(d.category)}">${escapeHtml(cat.label)}</span><span>${fmt(d.pubDate)}</span></div><h2>${escapeHtml(d.title)}</h2><p class="desc">${escapeHtml(d.description || '')}</p>${
    tags ? `<div class="meta">${tags}</div>` : ''
  }</a>`;
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
  ]
    .filter(Boolean)
    .map((stat) => `<div class="stat"><b>${stat.value}</b><span>${stat.label}</span></div>`)
    .join('');
  const topSkills = (resume.skills || []).flatMap((s) => s.items).slice(0, 6);
  const cats = Object.entries(config.categories);
  
  const jsonLd = [
    generateJsonLd('website'),
    generateJsonLd('person')
  ].filter(Boolean);

  const body = `
  <section class="hero">
    <div class="hero-grid">
      <div class="hero-text animate-in">
        <span class="eyebrow">具身智能 · 大模型驱动机器人</span>
        <h1>我是 <span class="grad">${escapeHtml(resume.name)}</span><br>让机器人学会「自己想」</h1>
        <p class="lead">${escapeHtml(resume.summary || '')}</p>
        ${stats ? `<div class="stats">${stats}</div>` : ''}
        <div class="cta">
          <a class="btn btn-primary" href="/blog/">阅读笔记</a>
          <a class="btn btn-outline" href="/about/">查看履历</a>
        </div>
        ${socialLinksHtml()}
      </div>
      <aside class="hero-card animate-in delay-3">
        <img class="avatar-lg" src="${resume.avatar}" alt="${escapeHtml(resume.name)}">
        <div class="hc-name">${escapeHtml(resume.name)}</div>
        <div class="hc-role">${escapeHtml(resume.title || '')}</div>
        <div class="hc-tags">${topSkills.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      </aside>
    </div>
  </section>

  ${featured ? `<section class="section"><div class="section-head"><h2>🤖 主打项目</h2><a class="more" href="/projects/">全部项目 →</a></div>
    <a class="spotlight" href="/projects/${featured.slug}/">
      <div class="spotlight-body">
        <span class="badge-cat badge-note">${escapeHtml(featured.data.status || '项目')}</span>
        <h3>${escapeHtml(featured.data.title)}</h3>
        <p>${escapeHtml(featured.data.description || '')}</p>
        <div class="tags">${(featured.data.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        <span class="sl-link">查看项目 →</span>
      </div>
      <div class="spotlight-art"><div class="robot">🤖</div></div>
    </a></section>` : ''}

  ${latest.length ? `<section class="section">
    <div class="section-head"><h2>📝 最新笔记</h2><a class="more" href="/blog/">全部 →</a></div>
    <div class="grid">${latest.map(postCard).join('')}</div>
  </section>` : ''}

  ${awards.length ? `<section class="section"><div class="section-head"><h2>🏆 荣誉墙</h2><a class="more" href="/about/">完整履历 →</a></div>
    <div class="awards-strip">${awards
      .map(
        (a) =>
          `<div class="award-card"><div class="ac-date">${escapeHtml(a.date)}</div><div class="ac-name">${escapeHtml(
            a.name
          )}</div>${a.level ? `<div class="ac-lvl">${escapeHtml(a.level)}</div>` : ''}</div>`
      )
      .join('')}</div></section>` : ''}

  <section class="section">
    <div class="section-head"><h2>🧭 笔记分类</h2><a class="more" href="/blog/">去写笔记 →</a></div>
    <div class="grid cats">${cats
      .map(
        ([k, v]) =>
          `<a class="card cat-card" href="/blog/?cat=${k}"><span class="badge-cat badge-${k}">${escapeHtml(
            v.label
          )}</span><h3>${escapeHtml(v.label)}</h3><p class="desc">${escapeHtml(v.desc)}</p></a>`
      )
      .join('')}</div>
  </section>`;
  
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

  const allTags = [...new Set(posts.flatMap((p) => p.data.tags || []))].sort();
  const validCategories = Object.keys(config.categories);

  // 将文章数据序列化到 JS 中(用于精确标签匹配)
  const postsData = posts.map((p) => ({
    slug: p.slug,
    category: p.data.category,
    tags: p.data.tags || [],
  }));

  const body = `
  <section style="margin-top:28px"><h1 style="font-size:26px;margin:0 0 4px">学习笔记</h1><p style="color:var(--text-mute);margin:0 0 16px">bug 是怎么解决的、技术是怎么学起来的 —— 都记在这里。</p>
  <div id="filters" role="group" aria-label="筛选选项">
    <button data-filter="all" class="active" role="button" aria-pressed="true">全部</button>
    ${Object.entries(config.categories)
      .map(([k, v]) => `<button data-filter="${k}" role="button" aria-pressed="false">${escapeHtml(v.label)}</button>`)
      .join('')}
    <button data-filter="clear" role="button" style="margin-left:auto">清除筛选</button>
  </div>
  ${allTags.length ? `<div class="share" style="margin-top:10px" role="group" aria-label="标签筛选">${allTags.map((t) => `<a class="tag tag-filter" href="/blog/?tag=${encodeURIComponent(t)}" role="button" aria-pressed="false" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</a>`).join('')}</div>` : ''}
  <div role="status" aria-live="polite" id="filter-result" class="sr-only"></div>
  <div class="grid" id="post-grid" style="margin-top:18px">${posts.map(postCard).join('')}</div>
  <div id="empty-state" style="display:none;text-align:center;padding:40px 20px;color:var(--text-mute);"><p>没有找到符合条件的文章</p><a href="/blog/" class="btn btn-outline" style="margin-top:12px;display:inline-flex;">清除筛选</a></div></section>
  <script>
  (function(){
    // 文章数据(从服务端注入,用于精确标签匹配)
    var POSTS_DATA = ${JSON.stringify(postsData)};
    var VALID_CATEGORIES = ${JSON.stringify(validCategories)};

    var grid = document.getElementById('post-grid');
    var emptyState = document.getElementById('empty-state');
    var btns = document.querySelectorAll('#filters button[data-filter]');
    var resultStatus = document.getElementById('filter-result');
    var allCards = grid.querySelectorAll('.card');

    // ---- 纯函数: 筛选逻辑(与 build.mjs 中可测试的函数一致) ----
    function tagMatchesExact(cardTags, filterTag) {
      return cardTags.some(function(t) { return t === filterTag; });
    }

    function matchesFilter(post, cat, tag) {
      if (cat && cat !== 'all' && post.category !== cat) return false;
      if (tag && !tagMatchesExact(post.tags || [], tag)) return false;
      return true;
    }

    function getFilteredSlugs(cat, tag) {
      return POSTS_DATA.filter(function(p) { return matchesFilter(p, cat, tag); }).map(function(p) { return p.slug; });
    }

    function getParams() { return new URLSearchParams(location.search); }

    function applyFilter(cat, tag) {
      var visible = 0;
      var filteredSlugs = getFilteredSlugs(cat, tag);

      allCards.forEach(function(x) {
        var slug = x.getAttribute('href') ? x.getAttribute('href').replace(/^\\/blog\\//, '').replace(/\\/$/, '') : '';
        var show = filteredSlugs.indexOf(slug) !== -1;
        x.style.display = show ? '' : 'none';
        if (show) visible++;
      });

      // 更新分类按钮状态
      btns.forEach(function(b) {
        var f = b.dataset.filter;
        var isActive = f === cat || (f === 'all' && (!cat || cat === ''));
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', String(isActive));
      });

      // 更新标签按钮状态(精确匹配)
      document.querySelectorAll('.tag-filter').forEach(function(ta) {
        var t = ta.getAttribute('data-tag');
        ta.setAttribute('aria-pressed', String(t === tag));
      });

      // 空状态处理
      if (emptyState) {
        emptyState.style.display = visible === 0 ? '' : 'none';
        grid.style.display = visible === 0 ? 'none' : '';
      }

      // ARIA 播报
      if (resultStatus) {
        if (visible === 0) {
          resultStatus.textContent = '没有找到符合条件的文章';
        } else {
          resultStatus.textContent = '显示 ' + visible + ' 篇文章';
        }
      }
    }

    function filterUrl(cat, tag) {
      var params = new URLSearchParams();
      if (cat && cat !== 'all') params.set('cat', cat);
      if (tag) params.set('tag', tag);
      var qs = params.toString();
      return '/blog/' + (qs ? '?' + qs : '');
    }

    function updateUrl(cat, tag) {
      // 使用 pushState 支持浏览器前进/后退
      history.pushState({ cat: cat, tag: tag }, '', filterUrl(cat, tag));
    }

    function clearAllFilters() {
      applyFilter('', '');
      updateUrl('', '');
    }

    // ---- 事件绑定 ----

    // 分类按钮点击
    btns.forEach(function(b) {
      b.addEventListener('click', function() {
        var cat = b.dataset.filter;
        var currentTag = getParams().get('tag') || '';
        if (cat === 'clear') {
          clearAllFilters();
          return;
        }
        applyFilter(cat, currentTag);
        updateUrl(cat, currentTag);
      });
    });

    // 标签点击(精确匹配)
    document.querySelectorAll('.tag-filter').forEach(function(ta) {
      ta.addEventListener('click', function(e) {
        e.preventDefault();
        var tag = ta.getAttribute('data-tag');
        var currentCat = getParams().get('cat') || '';
        applyFilter(currentCat, tag);
        updateUrl(currentCat, tag);
      });
    });

    // 初始化: 从 URL 读取初始状态
    var initCat = getParams().get('cat') || '';
    var initTag = getParams().get('tag') || '';

    // 未知分类回退到全部，并同步清理地址栏中的无效参数。
    if (initCat && !VALID_CATEGORIES.includes(initCat)) {
      console.warn('[filter] 未知分类: "' + initCat + '", 回退到全部');
      initCat = '';
    }
    // 未知标签显示空结果，canonical 仍保持 /blog/。
    applyFilter(initCat, initTag);
    history.replaceState({ cat: initCat, tag: initTag }, '', filterUrl(initCat, initTag));

    // popstate: 浏览器前进/后退恢复筛选状态。
    window.addEventListener('popstate', function(e) {
      var p = getParams();
      var stateCat = (e.state && e.state.cat) || p.get('cat') || '';
      var stateTag = (e.state && e.state.tag) || p.get('tag') || '';
      if (stateCat && !VALID_CATEGORIES.includes(stateCat)) stateCat = '';
      applyFilter(stateCat, stateTag);
    });
  })();
  </script>`;

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
    .map((t) => `<a class="tag" href="/blog/?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`)
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

  const body = `
  <article style="margin-top:24px"><div class="post-head"><div class="post-meta"><span class="badge-cat badge-${d.category}">${escapeHtml(cat.label)}</span><span>${fmt(d.pubDate)}${
    d.updatedDate ? `<span>更新于 ${fmt(d.updatedDate)}</span>` : ''
  }</span></div><h1>${escapeHtml(d.title)}</h1><p style="color:var(--text-soft);margin:6px 0 0">${escapeHtml(d.description || '')}</p>${
    tags ? `<div class="post-meta" style="margin-top:10px">${tags}</div>` : ''
  }</div><div class="prose">${p.html}</div>${shareHtml(d.title, pageUrl)}<nav class="pager">${
    prev
      ? `<a href="/blog/${prev.slug}/"><div class="label">← 上一篇</div><div class="ttl">${escapeHtml(prev.data.title)}</div></a>`
      : '<span></span>'
  }${
    next
      ? `<a href="/blog/${next.slug}/" style="text-align:right"><div class="label">下一篇 →</div><div class="ttl">${escapeHtml(next.data.title)}</div></a>`
      : '<span></span>'
  }</nav>${commentHtml()}</article>`;
  
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

  const body = `
  <article style="margin-top:24px"><div class="post-head"><div class="post-meta"><span class="tag">${escapeHtml(
    d.status || ''
  )}</span><span>${fmt(d.date)}</span>${d.role ? `<span>角色:${escapeHtml(d.role)}</span>` : ''}</div><h1>${escapeHtml(
    d.title
  )}</h1><p style="color:var(--text-soft);margin:6px 0 0">${escapeHtml(d.description || '')}</p>${
    (d.tags || []).length
      ? `<div class="post-meta" style="margin-top:10px">${(d.tags || [])
          .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
          .join('')}</div>`
      : ''
  }</div>${awards}${linksHtml}<div class="prose">${p.html}</div>${shareHtml(d.title, pageUrl)}${commentHtml()}</article>`;
  
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

  // Build term cards HTML with safe escaping
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

  const body = `
  <section class="terms-page">
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

  <script>
  (function(){
    var glossaryData = ${safeJsonForScript(glossary)};
    var VALID_CATEGORIES = ${safeJsonForScript(categoryList)};
    var TERMS_PER_PAGE = 10;
    var getCompactPaginationItems = ${getCompactPaginationItems.toString()};
    var parsePaginationJump = ${parsePaginationJump.toString()};

    var searchInput = document.getElementById('terms-search');
    var catBtns = document.querySelectorAll('#terms-categories button[data-category]');
    var termsResults = document.getElementById('terms-results');
    var termsList = document.getElementById('terms-list');
    var termsPrimarySection = document.getElementById('terms-primary-section');
    var termsPrimaryList = document.getElementById('terms-primary-list');
    var termsRelatedSection = document.getElementById('terms-related-section');
    var termsRelatedList = document.getElementById('terms-related-list');
    var termsEmpty = document.getElementById('terms-empty');
    var termsCount = document.getElementById('terms-count');
    var clearBtn = document.getElementById('terms-clear-btn');
    var termsPagination = document.getElementById('terms-pagination');
    var siteHeader = document.getElementById('site-header');
    var allTermCards = termsList ? Array.prototype.slice.call(termsList.querySelectorAll('.term-card')) : [];
    var termCardsById = Object.create(null);
    allTermCards.forEach(function(card) {
      termCardsById[card.getAttribute('id')] = card;
    });
    var currentPage = 1;
    var filteredTerms = [];
    var currentResultGroup = {
      isSearch: false,
      strongest: [],
      related: [],
      results: glossaryData.slice()
    };

    /* ---- 动态顶栏高度检测 ---- */
    function updateHeaderHeight() {
      if (siteHeader && siteHeader.getBoundingClientRect) {
        var h = Math.round(siteHeader.getBoundingClientRect().height);
        if (h > 0) {
          document.documentElement.style.setProperty('--header-height', h + 'px');
        }
      }
    }
    updateHeaderHeight();
    if (siteHeader && typeof ResizeObserver !== 'undefined') {
      try {
        var ro = new ResizeObserver(updateHeaderHeight);
        ro.observe(siteHeader);
      } catch(e) {
        window.addEventListener('resize', updateHeaderHeight, { passive: true });
      }
    } else {
      window.addEventListener('resize', updateHeaderHeight, { passive: true });
    }

    /* ---- Hash 定位与闪烁提醒 ---- */
    var liveRegion = null;
    function getLiveRegion() {
      if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        liveRegion.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
        document.body.appendChild(liveRegion);
      }
      return liveRegion;
    }

    function announce(msg) {
      getLiveRegion().textContent = msg;
    }

    function isReducedMotion() {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    var _pulseTimer = null;
    var _pulseCard = null;
    var _termNavigationId = 0;

    function clearTermPulse(card) {
      if (!card) return;
      card.classList.remove('term-card--hash-target', 'animate-pulse');
    }

    function pulseTermCard(card) {
      if (!card) return;
      /* 清除之前可能正在进行的动画或静态高亮。 */
      clearTimeout(_pulseTimer);
      if (_pulseCard && _pulseCard !== card) clearTermPulse(_pulseCard);
      clearTermPulse(card);
      /* 强制 reflow 以重启动画 */
      void card.offsetWidth;
      card.classList.add('term-card--hash-target', 'animate-pulse');
      _pulseCard = card;

      var finish = function() {
        if (_pulseCard !== card) return;
        clearTimeout(_pulseTimer);
        clearTermPulse(card);
        _pulseCard = null;
        _pulseTimer = null;
      };

      /* reduced motion 时保留 1.2s 静态高亮；普通模式由一次 1.2s 动画完成。 */
      _pulseTimer = setTimeout(finish, 1250);
      if (!isReducedMotion()) {
        card.addEventListener('animationend', finish, { once: true });
      }
    }

    function termIdFromHash(value) {
      if (typeof value !== 'string') return '';
      var raw = value.charAt(0) === '#' ? value.slice(1) : value;
      if (!raw) return '';
      try {
        raw = decodeURIComponent(raw);
      } catch (e) {
        return '';
      }
      return /^[a-z0-9_-]+$/.test(raw) ? raw : '';
    }

    /* 等待平滑滚动真正抵达顶栏下方，再开始提示，避免提示在目标仍在屏幕外时结束。 */
    function waitForTermAlignment(target, navigationId, onReady) {
      var framesRemaining = 180;
      var previousTop = null;

      function checkAlignment() {
        if (navigationId !== _termNavigationId || !target.isConnected) return;

        var targetTop = target.getBoundingClientRect().top;
        var headerBottom = 0;
        if (siteHeader && siteHeader.getBoundingClientRect) {
          headerBottom = siteHeader.getBoundingClientRect().bottom;
        }

        /* 允许浏览器子像素渲染误差；正常位置为顶栏底部下方 8px。 */
        var aligned = targetTop >= headerBottom - 2 && targetTop <= headerBottom + 10;
        var settled = previousTop !== null && Math.abs(targetTop - previousTop) <= 0.5;
        if ((aligned && settled) || framesRemaining <= 0) {
          onReady();
          return;
        }

        previousTop = targetTop;
        framesRemaining--;
        requestAnimationFrame(checkAlignment);
      }

      requestAnimationFrame(checkAlignment);
    }

    function scrollToTermFromHash(hash, options) {
      options = options || {};
      var termId = termIdFromHash(hash);
      if (!termId) return false;

      var target = document.getElementById(termId);
      if (!target) return false;

      /*
       * 卡片被 hidden 可能有两种原因：筛选没有匹配它，或它只是位于另一页。
       * 必须用筛选结果判断，不能仅靠 target.hidden，否则跨页关联会被误判。
       */
      var targetIndex = filteredTerms.findIndex(function(term) { return term.id === termId; });
      if (targetIndex === -1) {
        /* 只有用户主动点击关联时才清除筛选；直接 URL 和历史导航仅播报。 */
        if (!options.revealHidden) {
          announce('当前筛选已隐藏该术语');
          return false;
        }
        clearFiltersForTerm();
        targetIndex = filteredTerms.findIndex(function(term) { return term.id === termId; });
        if (targetIndex === -1) return false;
      }

      /* 搜索结果按“最强相关术语 / 相关内容”完整展示，不参与分页。 */
      var targetPage = currentResultGroup.isSearch ? 1 : Math.floor(targetIndex / TERMS_PER_PAGE) + 1;
      if (currentPage !== targetPage) applyFilters(targetPage);

      target = document.getElementById(termId);
      if (!target || target.hidden || target.offsetParent === null) return false;
      if (options.historyMode) updateUrl(options.historyMode, termId);

      var navigationId = ++_termNavigationId;

      /* scroll-margin-top 统一处理顶栏偏移。 */
      requestAnimationFrame(function() {
        if (navigationId !== _termNavigationId) return;
        target.scrollIntoView({ block: 'start', inline: 'nearest' });
        var term = glossaryData.find(function(t) { return t.id === termId; });
        waitForTermAlignment(target, navigationId, function() {
          if (navigationId !== _termNavigationId) return;
          pulseTermCard(target);
          if (term) announce('已定位到术语：' + term.term);
        });
      });
      return true;
    }

    /* ---- 搜索：术语名优先，摘要命中归入“相关内容” ---- */
    function normalizeText(s) { return String(s || '').toLowerCase().replace(/\\s+/g, ' ').trim(); }

    function getTermNameMatchRank(term, query) {
      var search = normalizeText(query);
      if (!search) return Number.POSITIVE_INFINITY;

      function fieldRank(value, offset) {
        var field = normalizeText(value);
        if (!field) return Number.POSITIVE_INFINITY;
        if (field === search) return offset;
        if (field.indexOf(search) === 0) return offset + 1;
        return field.indexOf(search) !== -1 ? offset + 2 : Number.POSITIVE_INFINITY;
      }

      var rank = Math.min(fieldRank(term.term, 0), fieldRank(term.fullName, 3));
      (Array.isArray(term.aliases) ? term.aliases : []).forEach(function(alias) {
        rank = Math.min(rank, fieldRank(alias, 6));
      });
      return rank;
    }

    function matchesRelatedContent(term, query) {
      var search = normalizeText(query);
      return Boolean(search && normalizeText(term.summary).indexOf(search) !== -1);
    }

    function matchesCategory(term, cat) {
      if (!cat || cat === 'all') return true;
      return term.category === cat;
    }

    function groupSearchResults(query, category) {
      var search = normalizeText(query);
      var scopedTerms = glossaryData.filter(function(term) { return matchesCategory(term, category); });
      if (!search) {
        return {
          isSearch: false,
          strongest: [],
          related: [],
          results: scopedTerms
        };
      }

      var rankedTerms = scopedTerms.map(function(term, index) {
        return { term: term, index: index, rank: getTermNameMatchRank(term, search) };
      });
      var strongest = rankedTerms
        .filter(function(item) { return Number.isFinite(item.rank); })
        .sort(function(a, b) { return a.rank - b.rank || a.index - b.index; })
        .map(function(item) { return item.term; });
      var strongestIds = new Set(strongest.map(function(term) { return term.id; }));
      var related = rankedTerms
        .filter(function(item) { return !strongestIds.has(item.term.id) && matchesRelatedContent(item.term, search); })
        .map(function(item) { return item.term; });

      return {
        isSearch: true,
        strongest: strongest,
        related: related,
        results: strongest.concat(related)
      };
    }

    function moveCardsTo(container, terms) {
      if (!container) return;
      var fragment = document.createDocumentFragment();
      terms.forEach(function(term) {
        var card = termCardsById[term.id];
        if (!card) return;
        card.hidden = false;
        fragment.appendChild(card);
      });
      container.replaceChildren(fragment);
    }

    function renderSearchSections(resultGroup) {
      termsList.hidden = true;
      moveCardsTo(termsPrimaryList, resultGroup.strongest);
      moveCardsTo(termsRelatedList, resultGroup.related);
      if (termsPrimarySection) termsPrimarySection.hidden = resultGroup.strongest.length === 0;
      if (termsRelatedSection) termsRelatedSection.hidden = resultGroup.related.length === 0;
    }

    function restorePagedCards(pageIds) {
      var fragment = document.createDocumentFragment();
      allTermCards.forEach(function(card) {
        card.hidden = !pageIds.has(card.getAttribute('id'));
        fragment.appendChild(card);
      });
      termsList.replaceChildren(fragment);
      if (termsPrimarySection) termsPrimarySection.hidden = true;
      if (termsRelatedSection) termsRelatedSection.hidden = true;
    }

    /* ---- 关联链接点击拦截 ---- */
    if (termsResults) {
      termsResults.addEventListener('click', function(e) {
        var link = e.target.closest('.term-link');
        if (!link) return;
        var href = link.getAttribute('href');
        if (!href || href.charAt(0) !== '#') return;

        e.preventDefault();
        scrollToTermFromHash(href, { revealHidden: true, historyMode: 'push' });
      });
    }

    /* ---- hashchange / popstate / 首次加载统一处理 ---- */
    var _hashNavigationPending = false;
    function scheduleHashNavigation() {
      if (_hashNavigationPending) return;
      _hashNavigationPending = true;
      requestAnimationFrame(function() {
        _hashNavigationPending = false;
        scrollToTermFromHash(location.hash, { revealHidden: false, historyMode: 'replace' });
      });
    }

    window.addEventListener('hashchange', scheduleHashNavigation);

    function setActiveCategory(cat) {
      catBtns.forEach(function(b) {
        var isActive = b.dataset.category === cat || (cat === 'all' && b.dataset.category === 'all');
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', String(isActive));
      });
    }

    function getActiveCategory() {
      var activeCat = 'all';
      catBtns.forEach(function(b) {
        if (b.classList.contains('active')) activeCat = b.dataset.category;
      });
      return activeCat;
    }

    function clampPage(page, totalPages) {
      var numericPage = Number(page);
      if (!Number.isSafeInteger(numericPage)) numericPage = 1;
      return Math.min(Math.max(numericPage, 1), Math.max(totalPages, 1));
    }

    function renderPagination(totalPages) {
      if (!termsPagination) return;
      termsPagination.replaceChildren();
      if (totalPages <= 1) {
        termsPagination.hidden = true;
        return;
      }

      var fragment = document.createDocumentFragment();
      function appendPageButton(label, page, options) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'terms-page-btn';
        button.textContent = label;
        button.dataset.page = String(page);
        button.setAttribute('aria-controls', 'terms-results');
        button.setAttribute('aria-label', options.ariaLabel);
        if (options.current) {
          button.setAttribute('aria-current', 'page');
          button.disabled = true;
        } else if (options.disabled) {
          button.disabled = true;
        }
        fragment.appendChild(button);
      }

      function appendEllipsis() {
        var ellipsis = document.createElement('span');
        ellipsis.className = 'terms-page-ellipsis';
        ellipsis.textContent = '…';
        ellipsis.setAttribute('aria-hidden', 'true');
        fragment.appendChild(ellipsis);
      }

      function appendPageJump() {
        var form = document.createElement('form');
        form.className = 'terms-page-jump';
        form.noValidate = true;
        form.dataset.totalPages = String(totalPages);
        form.setAttribute('aria-label', '跳至指定页');

        var label = document.createElement('label');
        label.className = 'terms-page-jump-label';
        label.htmlFor = 'terms-page-jump-input';
        label.textContent = '跳至';

        var input = document.createElement('input');
        input.id = 'terms-page-jump-input';
        input.className = 'terms-page-jump-input';
        input.type = 'text';
        input.inputMode = 'numeric';
        input.enterKeyHint = 'go';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.pattern = '[1-9]\\d*';
        input.placeholder = '页码';
        input.setAttribute('aria-label', '页码，范围 1 至 ' + totalPages);
        input.setAttribute('aria-invalid', 'false');

        var suffix = document.createElement('span');
        suffix.className = 'terms-page-jump-suffix';
        suffix.textContent = '页';
        suffix.setAttribute('aria-hidden', 'true');

        var submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'terms-page-btn terms-page-jump-submit';
        submit.textContent = '跳转';
        submit.setAttribute('aria-label', '跳转到输入页码');

        form.appendChild(label);
        form.appendChild(input);
        form.appendChild(suffix);
        form.appendChild(submit);
        fragment.appendChild(form);
      }

      appendPageButton('上一页', currentPage - 1, {
        ariaLabel: '上一页',
        disabled: currentPage <= 1
      });

      var pageItems = getCompactPaginationItems(currentPage, totalPages);
      var lastPage = pageItems.pop();
      pageItems.forEach(function(item) {
        if (item === 'ellipsis') {
          appendEllipsis();
          return;
        }
        appendPageButton(String(item), item, {
          ariaLabel: '第 ' + item + ' 页',
          current: item === currentPage
        });
      });

      /* 跳页控件按需求放在动态最后一页和“下一页”之前。 */
      appendPageJump();
      appendPageButton(String(lastPage), lastPage, {
        ariaLabel: '第 ' + lastPage + ' 页（最后一页）',
        current: lastPage === currentPage
      });
      appendPageButton('下一页', currentPage + 1, {
        ariaLabel: '下一页',
        disabled: currentPage >= totalPages
      });

      termsPagination.appendChild(fragment);
      termsPagination.hidden = false;
    }

    function applyFilters(requestedPage) {
      var query = searchInput.value.trim();
      var activeCat = getActiveCategory();
      currentResultGroup = groupSearchResults(query, activeCat);
      filteredTerms = currentResultGroup.results;

      var totalCount = filteredTerms.length;
      if (currentResultGroup.isSearch) {
        currentPage = 1;
        renderSearchSections(currentResultGroup);

        if (totalCount > 0) {
          if (currentResultGroup.strongest.length && currentResultGroup.related.length) {
            termsCount.textContent = '找到 ' + totalCount + ' 个结果：' + currentResultGroup.strongest.length + ' 个术语名匹配，' + currentResultGroup.related.length + ' 个相关内容';
          } else if (currentResultGroup.strongest.length) {
            termsCount.textContent = '找到 ' + totalCount + ' 个术语名匹配';
          } else {
            termsCount.textContent = '找到 ' + totalCount + ' 个相关内容（术语名未直接匹配）';
          }
        } else {
          termsCount.textContent = '无匹配结果';
        }

        termsEmpty.hidden = totalCount !== 0;
        renderPagination(0);
        return { totalCount: totalCount, totalPages: totalCount > 0 ? 1 : 0, page: currentPage, isSearch: true };
      }

      var totalPages = totalCount > 0 ? Math.ceil(totalCount / TERMS_PER_PAGE) : 1;
      currentPage = clampPage(requestedPage === undefined ? currentPage : requestedPage, totalPages);
      var firstIndex = (currentPage - 1) * TERMS_PER_PAGE;
      var pageTerms = filteredTerms.slice(firstIndex, firstIndex + TERMS_PER_PAGE);
      var pageIds = new Set(pageTerms.map(function(term) { return term.id; }));

      restorePagedCards(pageIds);

      if (totalCount > 0) {
        var lastIndex = firstIndex + pageTerms.length;
        termsCount.textContent = '显示 ' + (firstIndex + 1) + '–' + lastIndex + ' / 共 ' + totalCount + ' 个术语，第 ' + currentPage + ' / ' + totalPages + ' 页';
      } else {
        termsCount.textContent = '无匹配结果';
      }

      termsEmpty.hidden = totalCount !== 0;
      termsList.hidden = totalCount === 0;
      renderPagination(totalCount > 0 ? totalPages : 0);
      return { totalCount: totalCount, totalPages: totalPages, page: currentPage, isSearch: false };
    }

    function clearAll() {
      searchInput.value = '';
      setActiveCategory('all');
      applyFilters(1);
      updateUrl('push');
    }

    function clearFiltersForTerm() {
      searchInput.value = '';
      setActiveCategory('all');
      return applyFilters(1);
    }

    function updateUrl(mode, termId) {
      var query = searchInput.value.trim();
      var activeCat = getActiveCategory();
      var params = new URLSearchParams();
      if (query) params.set('q', query);
      if (activeCat && activeCat !== 'all') params.set('category', activeCat);
      if (!currentResultGroup.isSearch && currentPage > 1) params.set('page', String(currentPage));
      var qs = params.toString();
      var safeTermId = termIdFromHash(termId || '');
      var hash = safeTermId ? '#' + encodeURIComponent(safeTermId) : '';
      var state = { q: query, category: activeCat || 'all', page: currentResultGroup.isSearch ? 1 : currentPage, term: safeTermId };
      var url = '/terms/' + (qs ? '?' + qs : '') + hash;
      if (mode === 'push') {
        history.pushState(state, '', url);
      } else {
        history.replaceState(state, '', url);
      }
    }

    function scrollTermsListIntoView() {
      requestAnimationFrame(function() {
        var target = currentResultGroup.isSearch && termsResults ? termsResults : termsList;
        target.scrollIntoView({ block: 'start', inline: 'nearest' });
      });
    }

    function changePage(page) {
      if (currentResultGroup.isSearch) return;
      var nextPage = clampPage(page, Math.ceil(filteredTerms.length / TERMS_PER_PAGE) || 1);
      if (nextPage === currentPage) return;
      applyFilters(nextPage);
      updateUrl('push');
      scrollTermsListIntoView();
    }

    if (termsPagination) {
      termsPagination.addEventListener('click', function(e) {
        var button = e.target.closest('.terms-page-btn');
        if (!button || button.disabled) return;
        var page = Number(button.dataset.page);
        if (!Number.isSafeInteger(page)) return;
        changePage(page);
      });

      termsPagination.addEventListener('input', function(e) {
        if (!e.target.matches('.terms-page-jump-input')) return;
        e.target.setAttribute('aria-invalid', 'false');
      });

      termsPagination.addEventListener('submit', function(e) {
        var form = e.target.closest('.terms-page-jump');
        if (!form) return;
        e.preventDefault();

        var input = form.querySelector('.terms-page-jump-input');
        var totalPages = Number(form.dataset.totalPages);
        var page = parsePaginationJump(input ? input.value : '', totalPages);
        if (page === null) {
          if (input) {
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            input.select();
          }
          announce('请输入 1 到 ' + totalPages + ' 的整数页码');
          return;
        }

        input.setAttribute('aria-invalid', 'false');
        if (page === currentPage) {
          announce('当前已是第 ' + page + ' 页');
          return;
        }
        changePage(page);
      });
    }

    // Search input: use replaceState to avoid flooding history
    searchInput.addEventListener('input', function() {
      applyFilters(1);
      updateUrl('replace');
    });

    // Category buttons: use pushState for navigation
    catBtns.forEach(function(b) {
      b.addEventListener('click', function() {
        var cat = b.dataset.category;
        setActiveCategory(cat);
        applyFilters(1);
        updateUrl('push');
      });
    });

    // Clear button
    if (clearBtn) {
      clearBtn.addEventListener('click', function(e) {
        e.preventDefault();
        clearAll();
      });
    }

    function parsePageParam(rawPage) {
      if (rawPage === null) return { page: 1, normalized: false };
      if (!/^[1-9]\d*$/.test(rawPage)) return { page: 1, normalized: true };
      var page = Number(rawPage);
      if (!Number.isSafeInteger(page)) return { page: 1, normalized: true };
      /* 第 1 页统一不保留 page 参数，URL 更简洁、可预测。 */
      return { page: page, normalized: page === 1 };
    }

    // Initialize from URL params
    function initFromUrl() {
      var params = new URLSearchParams(location.search);
      var q = params.get('q') || '';
      var cat = params.get('category') || '';
      var pageInfo = parsePageParam(params.get('page'));
      var normalized = pageInfo.normalized;

      /* 搜索模式完整展示分区结果，因此 page 参数没有语义，统一去掉。 */
      if (q.trim() && params.has('page')) normalized = true;

      // Unknown category fallback
      if (cat && !VALID_CATEGORIES.includes(cat)) {
        cat = '';
        normalized = true;
      }

      searchInput.value = q;
      setActiveCategory(cat || 'all');
      var result = applyFilters(pageInfo.page);
      if (result.page !== pageInfo.page) normalized = true;
      if (normalized) updateUrl('replace', termIdFromHash(location.hash));
    }

    initFromUrl();
    scheduleHashNavigation();

    // 浏览器前进/后退：先恢复筛选状态，再处理 hash 定位；同一帧内会自动去重。
    window.addEventListener('popstate', function() {
      initFromUrl();
      scheduleHashNavigation();
    });
  })();
  </script>`;

  return layout({
    title: '专业术语',
    description: '机器人、ROS 2、导航、语音交互与具身智能领域专业术语参考',
    active: '/terms/',
    body,
    jsonLd,
    pageUrl: '/terms/'
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

function copyPublic(distDir) {
  if (!fs.existsSync(PUBLIC)) return;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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
    write(tmpDist, 'rss.xml', rss());
    write(tmpDist, 'sitemap.xml', sitemap());
    write(tmpDist, 'robots.txt', robots());
    write(tmpDist, '404.html', notFound());

    console.log('[build] 复制 public 资源...');
    copyPublicFiltered(tmpDist);

    const criticalResources = [
      'index.html',
      `assets/${cssHashedName}`,
      `assets/${loraFilename}`,
      `assets/${jetbrainsFilename}`,
      'assets/licenses/lora-variable-LICENSE.txt',
      'assets/licenses/jetbrains-mono-variable-LICENSE.txt',
      'favicon.svg',
      'avatar.svg',
      'og-image.png',
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
