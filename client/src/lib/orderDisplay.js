// How an order reads in the order lists and detail pages (super admin and store owner).
// Orders are either a credit package purchase or a course purchase from the store owner's
// cart (order_type 'course', with items: [{ courseId, title, unit_price, learners, line_total }]).

export const isCourseOrder = (order) => order?.order_type === 'course';

const courseItems = (order) => (Array.isArray(order?.items) ? order.items : []);

export const orderLearnerCount = (order) => courseItems(order).reduce((n, i) => n + (Number(i.learners) || 0), 0);

/** Short name of what was bought: the credit package, the single course, or "N courses". */
export function orderItemLabel(order) {
  if (!isCourseOrder(order)) return order?.credit_id?.title || '—';
  const items = courseItems(order);
  if (items.length === 1) return items[0].title || '1 course';
  return `${items.length} courses`;
}

/** Second line for course orders: "2 courses · 7 learners". */
export function orderItemDetail(order) {
  if (!isCourseOrder(order)) return '';
  const courses = courseItems(order).length;
  const learners = orderLearnerCount(order);
  return `${courses} course${courses !== 1 ? 's' : ''} · ${learners} learner${learners !== 1 ? 's' : ''}`;
}

export const orderCourseItems = courseItems;
