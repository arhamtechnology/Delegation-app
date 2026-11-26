import { getLastMutationAt } from './query-cache';

// Prefetched or router-cached server renders can be a little old; views refresh in
// the background when the payload is older than this.
const FRESH_RENDER_MS = 10000;

export function withRenderTime(data) {
  return data ? { ...data, renderedAt: Date.now() } : null;
}

export function isFreshRender(initialData) {
  const renderedAt = initialData?.renderedAt;
  return Boolean(renderedAt) && renderedAt > getLastMutationAt() && Date.now() - renderedAt < FRESH_RENDER_MS;
}
