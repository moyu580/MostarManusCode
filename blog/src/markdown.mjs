// Markdown 解析模块:使用 markdown-it + markdown-it-task-lists
// 保留 escapeHtml 等必要工具函数供其他模块使用
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

// ---------- HTML 转义 ----------
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- XML 转义(用于 RSS) ----------
export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------- markdown-it 实例 ----------
const md = new MarkdownIt({
  html: false,          // 不允许原始 HTML 注入
  xhtmlOut: true,
  breaks: false,
  linkify: true,        // 将裸 URL 变为可点击链接
  typographer: false,   // 不改变技术内容标点
}).use(taskLists, { label: true });

// 表格包装器:为表格添加移动端横向滚动容器
const originalTableOpen = md.renderer.rules.table_open || function(tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.table_open = function (tokens, idx, options, env, self) {
  // 在 <table> 前添加滚动容器开始标签
  tokens[idx].attrSet('role', 'table');
  return '<div class="table-scroll" tabindex="0" aria-label="表格内容，可横向滚动">\n'
    + originalTableOpen(tokens, idx, options, env, self);
};

const originalTableClose = md.renderer.rules.table_close || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.table_close = function (tokens, idx, options, env, self) {
  // 在 </table> 后关闭滚动容器
  return originalTableClose(tokens, idx, options, env, self)
    + '\n</div>\n';
};

// 系统架构围栏:使用受限 JSON 生成可访问、可响应的层级结构。
function normalizeArchitectureItems(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value.map((item) => (typeof item === 'string' ? item.trim() : ''));
  return items.every(Boolean) ? items : null;
}

function renderArchitectureFence(content) {
  let definition;
  try {
    definition = JSON.parse(content);
  } catch {
    return null;
  }

  if (!definition || typeof definition !== 'object' || !Array.isArray(definition.layers) || definition.layers.length === 0) {
    return null;
  }

  const layers = [];
  for (const layer of definition.layers) {
    if (!layer || typeof layer !== 'object' || typeof layer.title !== 'string' || !layer.title.trim()) {
      return null;
    }

    const hasItems = Object.hasOwn(layer, 'items');
    const hasModules = Object.hasOwn(layer, 'modules');
    if (hasItems === hasModules) return null;

    if (hasItems) {
      const items = normalizeArchitectureItems(layer.items);
      if (!items) return null;
      layers.push({ title: layer.title.trim(), items });
      continue;
    }

    if (!Array.isArray(layer.modules) || layer.modules.length === 0) return null;
    const modules = [];
    for (const module of layer.modules) {
      if (!module || typeof module !== 'object' || typeof module.title !== 'string' || !module.title.trim()) {
        return null;
      }
      const items = normalizeArchitectureItems(module.items);
      if (!items) return null;
      modules.push({ title: module.title.trim(), items });
    }
    layers.push({ title: layer.title.trim(), modules });
  }

  const renderItems = (items) => `<ul class="architecture-items">${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('')}</ul>`;
  const label = typeof definition.label === 'string' && definition.label.trim()
    ? definition.label.trim()
    : '系统架构';
  const flow = layers
    .map((layer, index) => {
      const connector = index > 0 ? '<span class="architecture-flow__connector" aria-hidden="true"></span>' : '';
      if (layer.modules) {
        const modules = layer.modules
          .map((module) => `<li class="architecture-module"><h4 class="architecture-module__title">${escapeHtml(
            module.title
          )}</h4>${renderItems(module.items)}</li>`)
          .join('');
        return `<li class="architecture-flow__step">${connector}<section class="architecture-layer architecture-layer--modules"><h3 class="architecture-layer__title">${escapeHtml(
          layer.title
        )}</h3><ul class="architecture-modules">${modules}</ul></section></li>`;
      }
      return `<li class="architecture-flow__step">${connector}<section class="architecture-layer"><h3 class="architecture-layer__title">${escapeHtml(
        layer.title
      )}</h3>${renderItems(layer.items)}</section></li>`;
    })
    .join('');

  return `<section class="architecture" aria-label="${escapeHtml(label)}"><ol class="architecture-flow">${flow}</ol></section>\n`;
}

const originalFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.fence = function(tokens, idx, options, env, self) {
  const token = tokens[idx];
  if (String(token.info || '').trim().toLowerCase() !== 'architecture') {
    return originalFence(tokens, idx, options, env, self);
  }

  return renderArchitectureFence(token.content) || originalFence(tokens, idx, options, env, self);
};
// 安全链接验证
const defaultRender = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const hrefAttr = tokens[idx].attrGet('href');
  if (hrefAttr) {
    // 只允许 https:、mailto: 和相对路径
    if (/^(?:javascript|data|vbscript|file)\s*:/i.test(hrefAttr)) {
      // 危险协议:移除 href
      tokens[idx].attrSet('href', '#unsafe');
    }
    // 外部链接自动添加 rel
    if (/^https?:\/\//i.test(hrefAttr)) {
      tokens[idx].attrSet('rel', 'noopener noreferrer');
      tokens[idx].attrSet('target', '_blank');
    }
  }
  return defaultRender(tokens, idx, options, env, self);
};

// 主导出函数:Markdown -> HTML
export function mdToHtml(markdown) {
  // 防止未闭合代码围栏导致死循环:设置超时保护
  const FENCE_TIMEOUT_MS = 5000;
  const start = Date.now();

  try {
    const result = md.render(String(markdown));

    // 检查是否超时(理论上 markdown-it 不会死循环，但作为安全防护)
    if (Date.now() - start > FENCE_TIMEOUT_MS) {
      console.warn('[markdown] Rendering exceeded timeout, returning escaped text');
      return `<p>${escapeHtml(String(markdown))}</p>`;
    }

    return result;
  } catch (e) {
    console.error('[markdown] Render error:', e.message);
    return `<p>${escapeHtml(String(markdown))}</p>`;
  }
}
