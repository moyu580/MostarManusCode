import config from './config.mjs';

function asString(value) {
  return typeof value === 'string' ? value : '';
}

export function isValidCategory(category, categories = config.categories) {
  const normalizedCategory = asString(category);
  return !normalizedCategory || Object.hasOwn(categories, normalizedCategory);
}
