'use client';

import { orderCourseItems } from '../../lib/orderDisplay';
import { formatPrice } from '../StoreOwner/Cart/cartFormat';
import s from './OrderCourseItems.module.css';

/** The courses in a course purchase order (order / invoice pages, and the payment summary). */
export default function OrderCourseItems({ order, title = 'Purchased Courses' }) {
  const items = orderCourseItems(order);
  return (
    <section className={s.wrap} aria-labelledby="order-courses-title">
      <h2 id="order-courses-title" className={s.title}>{title}</h2>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Course</th>
              <th className={s.num}>Price per learner</th>
              <th className={s.num}>Learners</th>
              <th className={s.num}>Row total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={`${item.courseId}-${i}`}>
                <td className={s.idx}>{i + 1}</td>
                <td className={s.course}>{item.title || '—'}</td>
                <td className={s.num}>{formatPrice(item.unit_price)}</td>
                <td className={s.num}>{item.learners}</td>
                <td className={`${s.num} ${s.strong}`}>{formatPrice(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className={s.totalLabel}>Total</td>
              <td className={`${s.num} ${s.total}`}>{formatPrice(order?.credit_amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
