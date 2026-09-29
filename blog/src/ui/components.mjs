import { h, Fragment } from './h.mjs';
import { renderToStaticMarkup } from 'react-dom/server';

export function html(node) {
  return renderToStaticMarkup(node);
}

function Badge({ cat, label }) {
  return h('span', { className: `badge-cat badge-${cat}` }, label);
}

function Tag({ children }) {
  return h('span', { className: 'tag' }, children);
}

export function SectionHead({ title, href, moreLabel }) {
  return h(
    'div',
    { className: 'section-head rx-sh' },
    h(
      'div',
      { className: 'rx-sh-left' },
      h('span', { className: 'rx-sh-bar', 'aria-hidden': 'true' }),
      h('h2', null, title)
    ),
    href ? h('a', { className: 'more', href }, moreLabel || '更多 →') : null
  );
}

export function Stats({ items = [] }) {
  if (!items.length) return null;
  return h(
    'div',
    { className: 'stats rx-stats' },
    items.map((s) =>
      h(
        'div',
        { className: 'stat', key: s.label },
        h('b', null, String(s.value)),
        h('span', null, s.label)
      )
    )
  );
}

/** 个人名片：使用现有主题变量，浅/深色自动适配 */
export function ProfileCard({ name, title, avatar, skills = [] }) {
  return h(
    'aside',
    { className: 'rx-profile animate-in delay-3', 'aria-label': '个人简介' },
    h(
      'div',
      { className: 'rxp-top' },
      h(
        'div',
        { className: 'rxp-avatar-wrap' },
        h('img', { className: 'rxp-avatar', src: avatar, alt: name, width: 76, height: 76 }),
        h('span', {
          className: 'rxp-status-dot',
          'data-agent-status-dot': '',
          'data-state': 'checking',
          'aria-hidden': 'true',
        })
      ),
      h(
        'div',
        { className: 'rxp-id' },
        h('div', { className: 'rxp-name' }, name),
        h('div', { className: 'rxp-role' }, title),
        h(
          'div',
          {
            className: 'rxp-status',
            role: 'status',
            'aria-live': 'polite',
            'data-agent-status': '',
            'data-state': 'checking',
          },
          h('i', { 'aria-hidden': 'true' }),
          h('span', null, '状态检测中')
        )
      )
    ),
    h(
      'button',
      {
        className: 'rxp-toggle',
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': 'rxp-details',
      },
      '查看方向与技能'
    ),
    h(
      'div',
      { className: 'rxp-details', id: 'rxp-details' },
      h(
        'div',
        { className: 'rxp-rows' },
        h(
          'div',
          { className: 'rxp-row' },
          h('span', { className: 'rxp-k' }, '方向'),
          h('span', { className: 'rxp-v' }, '具身智能 · 大模型驱动机器人')
        ),
        h(
          'div',
          { className: 'rxp-row' },
          h('span', { className: 'rxp-k' }, '闭环'),
          h('span', { className: 'rxp-v' }, '感知 → 推理 → 执行')
        )
      ),
      skills.length
        ? h(
            'div',
            { className: 'hc-tags rxp-tags' },
            skills.slice(0, 6).map((t) => h(Tag, { key: t }, t))
          )
        : null
    )
  );
}

export function Hero({ eyebrow, name, headlineAfter, lead, stats, profile }) {
  return h(
    'section',
    { className: 'hero rx-hero' },
    h('div', { className: 'rx-hero-aura', 'aria-hidden': 'true' }),
    h(
      'div',
      { className: 'hero-grid' },
      h(
        'div',
        { className: 'hero-text animate-in' },
        h('span', { className: 'eyebrow' }, eyebrow),
        h(
          'h1',
          null,
          '我是 ',
          h('span', { className: 'grad' }, name),
          h('br'),
          headlineAfter
        ),
        h('p', { className: 'lead' }, lead),
        h(Stats, { items: stats }),
        h(
          'div',
          { className: 'cta' },
          h('a', { className: 'btn btn-primary', href: '/blog/' }, '阅读笔记'),
          h('a', { className: 'btn btn-outline', href: '/about/' }, '查看履历')
        )
      ),
      profile
    )
  );
}

/** 项目区：主题变量着色的分层示意（非死色面板） */
export function ProjectSpotlight({ project }) {
  if (!project) return null;
  const d = project.data || {};
  const tags = (d.tags || []).slice(0, 6);
  return h(
    'a',
    { className: 'spotlight rx-spotlight', href: `/projects/${project.slug}/` },
    h(
      'div',
      { className: 'spotlight-body' },
      h(Badge, { cat: 'note', label: d.status || '项目' }),
      h('h3', null, d.title),
      h('p', null, d.description || ''),
      tags.length
        ? h('div', { className: 'tags' }, tags.map((t) => h(Tag, { key: t }, t)))
        : null,
      h('span', { className: 'sl-link' }, '查看项目 →')
    ),
    h(
      'div',
      { className: 'rx-stack-art', 'aria-hidden': 'true' },
      h('div', { className: 'rxsa-layer rxsa-1' }, 'LLM Agent'),
      h('span', { className: 'rxsa-arrow' }),
      h('div', { className: 'rxsa-layer rxsa-2' }, 'OpenClaw'),
      h('span', { className: 'rxsa-arrow' }),
      h('div', { className: 'rxsa-layer rxsa-3' }, 'ROS 2 · 导航 · 机械臂'),
      h('span', { className: 'rxsa-arrow' }),
      h('div', { className: 'rxsa-layer rxsa-4' }, 'Jetson · 执行器')
    )
  );
}

const CAT_LABEL = {
  debug: '排错记录',
  learn: '学习途径',
  insight: '技术洞察',
  note: '笔记',
};

export function PostCard({ post }) {
  const d = post.data;
  const cat = d.category || 'note';
  const date = (d.pubDate || '').slice(0, 10);
  const tags = (d.tags || []).slice(0, 4);
  const minutes = d.readingMinutes || null;
  return h(
    'a',
    {
      className: `card rx-card`,
      href: `/blog/${post.slug}/`,
      'data-cat': cat,
    },
    h(
      'div',
      { className: 'meta' },
      h(Badge, { cat, label: CAT_LABEL[cat] || cat }),
      h(
        'span',
        { className: 'rx-card-meta-right' },
        h('time', { dateTime: date }, date),
        minutes
          ? h('span', { className: 'rx-read' }, `约 ${minutes} 分钟`)
          : null
      )
    ),
    h('h2', null, d.title),
    h('p', { className: 'desc' }, d.description || ''),
    tags.length
      ? h('div', { className: 'meta' }, tags.map((t) => h(Tag, { key: t }, t)))
      : null
  );
}

export function CategoryCard({ id, label, desc }) {
  return h(
    'a',
    { className: 'card cat-card rx-cat', href: `/blog/?cat=${id}` },
    h(Badge, { cat: id, label }),
    h('h3', null, label),
    h('p', { className: 'desc' }, desc)
  );
}

export function AwardCard({ award }) {
  return h(
    'div',
    { className: 'award-card rx-award' },
    h('div', { className: 'ac-date' }, award.date),
    h('div', { className: 'ac-name' }, award.name),
    award.level ? h('div', { className: 'ac-lvl' }, award.level) : null
  );
}

/** 文末相关笔记（同分类优先）— 参考 morethan-log / fuwari */
export function RelatedPosts({ currentSlug, posts = [], limit = 3 }) {
  const current = posts.find((p) => p.slug === currentSlug);
  const cat = current?.data?.category;
  const tags = new Set(current?.data?.tags || []);
  const ranked = posts
    .filter((p) => p.slug !== currentSlug)
    .map((p) => {
      let score = 0;
      if (cat && p.data?.category === cat) score += 2;
      const overlap = (p.data?.tags || []).filter((t) => tags.has(t)).length;
      score += overlap;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (!ranked.length) return null;
  return html(
    h(
      'section',
      { className: 'rx-related', 'aria-label': '相关笔记' },
      h(
        'div',
        { className: 'section-head rx-sh' },
        h(
          'div',
          { className: 'rx-sh-left' },
          h('span', { className: 'rx-sh-bar', 'aria-hidden': 'true' }),
          h('h2', null, '相关笔记')
        ),
        h('a', { className: 'more', href: '/blog/' }, '全部 →')
      ),
      h(
        'div',
        { className: 'grid rx-grid rx-related-grid' },
        ranked.map(({ p }) => h(PostCard, { key: p.slug, post: p }))
      )
    )
  );
}

/** 文章 meta：分类 + 日期 + 阅读时长 */
export function PostMeta({ post }) {
  const d = post.data || {};
  const cat = d.category || 'note';
  const date = (d.pubDate || '').slice(0, 10);
  return html(
    h(
      'div',
      { className: 'post-meta rx-post-meta' },
      h('span', { className: `badge-cat badge-${cat}` }, CAT_LABEL[cat] || cat),
      h('time', { dateTime: date }, date),
      d.updatedDate
        ? h('span', { className: 'rx-updated' }, `更新于 ${String(d.updatedDate).slice(0, 10)}`)
        : null,
      d.readingMinutes
        ? h('span', { className: 'rx-read' }, `约 ${d.readingMinutes} 分钟阅读`)
        : null
    )
  );
}

export function renderPostCard(post) {
  return html(h(PostCard, { post }));
}

export function HomePageBody({ resume, stats, skills, featured, posts, awards, categories }) {
  return html(
    h(
      Fragment,
      null,
      h(Hero, {
        eyebrow: '具身智能 · 大模型驱动机器人',
        name: resume.name,
        headlineAfter: '让机器人学会「自己想」',
        lead: resume.summary || '',
        stats,
        profile: h(ProfileCard, {
          name: resume.name,
          title: resume.title || '',
          avatar: resume.avatar || '/logo.png',
          skills,
        }),
      }),
      featured
        ? h(
            'section',
            { className: 'section' },
            h(SectionHead, { title: '主打项目', href: '/projects/', moreLabel: '全部项目 →' }),
            h(ProjectSpotlight, { project: featured })
          )
        : null,
      posts?.length
        ? h(
            'section',
            { className: 'section' },
            h(SectionHead, { title: '最新笔记', href: '/blog/', moreLabel: '全部 →' }),
            h(
              'div',
              { className: 'grid rx-grid' },
              posts.map((p) => h(PostCard, { key: p.slug, post: p }))
            )
          )
        : null,
      awards?.length
        ? h(
            'section',
            { className: 'section' },
            h(SectionHead, { title: '荣誉墙', href: '/about/', moreLabel: '完整履历 →' }),
            h(
              'div',
              { className: 'awards-strip' },
              awards.map((a) => h(AwardCard, { key: a.name + a.date, award: a }))
            )
          )
        : null,
      categories?.length
        ? h(
            'section',
            { className: 'section' },
            h(SectionHead, { title: '笔记分类', href: '/blog/', moreLabel: '浏览全部 →' }),
            h(
              'div',
              { className: 'grid cats rx-grid' },
              categories.map(([id, v]) =>
                h(CategoryCard, { key: id, id, label: v.label, desc: v.desc })
              )
            )
          )
        : null
    )
  );
}
