import config from './config.mjs';

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function postData(post) {
  return post && typeof post === 'object' ? post.data || post : {};
}

export function tagMatchesExact(tags, filterTag) {
  const normalizedTag = asString(filterTag);
  if (!normalizedTag) return true;
  return Array.isArray(tags) && tags.some((tag) => tag === normalizedTag);
}

export function matchesFilter(post, category, tag) {
  const data = postData(post);
  const normalizedCategory = asString(category);

  if (normalizedCategory && normalizedCategory !== 'all' && data.category !== normalizedCategory) {
    return false;
  }

  return tagMatchesExact(data.tags, tag);
}

export function filterPosts(posts, category, tag) {
  return (Array.isArray(posts) ? posts : []).filter((post) => matchesFilter(post, category, tag));
}

export function isValidCategory(category, categories = config.categories) {
  const normalizedCategory = asString(category);
  return !normalizedCategory || normalizedCategory === 'all' || Object.hasOwn(categories, normalizedCategory);
}

export function normalizeFilterState(category, tag, categories = config.categories) {
  const normalizedCategory = asString(category);
  return {
    category: isValidCategory(normalizedCategory, categories) ? normalizedCategory : '',
    tag: asString(tag),
  };
}
