import config from './config.mjs';

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function postData(post) {
  return post && typeof post === 'object' ? post.data || post : {};
}

export function isValidCategory(category, categories = config.categories) {
  const normalizedCategory = asString(category);
  return !normalizedCategory || Object.hasOwn(categories, normalizedCategory);
}

export function matchesFilter(post, category) {
  const normalizedCategory = asString(category);
  return !normalizedCategory || postData(post).category === normalizedCategory;
}

export function filterPosts(posts, category) {
  return (Array.isArray(posts) ? posts : []).filter((post) => matchesFilter(post, category));
}

export function normalizeFilterState(category, categories = config.categories) {
  const normalizedCategory = asString(category);
  return {
    category: isValidCategory(normalizedCategory, categories) ? normalizedCategory : '',
  };
}
