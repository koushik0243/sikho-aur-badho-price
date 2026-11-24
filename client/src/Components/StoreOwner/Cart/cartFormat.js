// Shared by the store owner Cart page, All Courses cards, the header cart button and the
// order screens.

export const CART_PATH = '/storeowner/cart';

/** A course's Price Per Learner in rupees. course_price is a Mongo Decimal128 ({ $numberDecimal }). */
export function coursePrice(course) {
  const raw = course?.course_price?.$numberDecimal ?? course?.course_price ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** "Rs. 1,000.00" (Indian digit grouping). */
export function formatPrice(n) {
  const v = Number(n) || 0;
  return `Rs. ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Row total in rupees, rounded to paise the same way the server does. */
export const lineTotal = (unitPrice, learners) => Math.round(unitPrice * learners * 100) / 100;
