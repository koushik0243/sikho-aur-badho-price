'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Store owner course cart: [{ courseId, learners }], kept in this browser per signed-in
// user. Shared by the All Courses page, the header cart button and the Cart page.
// Prices are never stored here — the Cart page shows the course's current price, and the
// server prices the order itself at checkout (server/orders/order.course_purchase.js).

export const MAX_LEARNERS_PER_ITEM = 10000; // same limit as the server
const CHANGE_EVENT = 'storeowner-cart-change';
const EMPTY = Object.freeze([]);

const keyFor = (userId) => `storeownerCart:${userId}`;

// useSyncExternalStore needs the same array back while nothing changed.
let cache = { key: null, raw: null, items: EMPTY };

function readItems(userId) {
  if (!userId || typeof window === 'undefined') return EMPTY;
  const key = keyFor(userId);
  let raw = null;
  try { raw = window.localStorage.getItem(key); } catch { return EMPTY; }
  if (cache.key === key && cache.raw === raw) return cache.items;
  let items = EMPTY;
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      items = parsed
        .filter(i => i && typeof i.courseId === 'string' && Number.isInteger(i.learners) && i.learners >= 1)
        .map(i => ({ courseId: i.courseId, learners: Math.min(i.learners, MAX_LEARNERS_PER_ITEM) }));
    }
  } catch { items = EMPTY; }
  cache = { key, raw, items };
  return items;
}

function writeItems(userId, items) {
  if (!userId || typeof window === 'undefined') return;
  try { window.localStorage.setItem(keyFor(userId), JSON.stringify(items)); } catch { /* storage full or blocked */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange); // another tab changed the cart
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export const clampLearners = (n) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(Math.max(v, 1), MAX_LEARNERS_PER_ITEM) : 1;
};

/** The signed-in store owner's cart, plus the actions that change it. */
export function useStoreCart(userId) {
  const items = useSyncExternalStore(subscribe, () => readItems(userId), () => EMPTY);
  const id = userId ? String(userId) : null;

  const update = useCallback(fn => writeItems(id, fn(readItems(id))), [id]);
  const add = useCallback((courseId, learners = 1) => update(list => (
    list.some(i => i.courseId === courseId) ? list : [...list, { courseId, learners: clampLearners(learners) }]
  )), [update]);
  const setLearners = useCallback((courseId, learners) => update(list => list.map(i => (
    i.courseId === courseId ? { ...i, learners: clampLearners(learners) } : i
  ))), [update]);
  const remove = useCallback(courseId => update(list => list.filter(i => i.courseId !== courseId)), [update]);
  const clear = useCallback(() => update(() => []), [update]);

  return {
    items,
    count: items.length,
    has: courseId => items.some(i => i.courseId === courseId),
    add, setLearners, remove, clear,
  };
}
