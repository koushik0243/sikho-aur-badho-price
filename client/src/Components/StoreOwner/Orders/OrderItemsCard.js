'use client';

import { kit as k, Card } from '../PageKit/PageKit';
import { isCourseOrder, orderCourseItems, orderLearnerCount } from '../../../lib/orderDisplay';
import { creditRange, fmtAmount, plural } from './orderViewUtils';
import s from './ViewOrder.module.css';

/** What was bought: the courses of a course order, or the credit plan of an older order. */
export default function OrderItemsCard({ order, shortId }) {
  return (
    <Card id="order-items" title="Items" flush
      sub={isCourseOrder(order) ? 'Prices as charged at checkout' : 'Credit plan purchased with this order'}>
      <div className={k.tableWrap}>
        {isCourseOrder(order)
          ? <CourseItemsTable order={order} shortId={shortId} />
          : <CreditPlanTable order={order} shortId={shortId} />}
      </div>
    </Card>
  );
}

// Below 560px the price and learner columns fold into a line under the course name
// (.wideOnly / .narrowOnly), so the table fits a phone without sideways scrolling.
function CourseItemsTable({ order, shortId }) {
  const items = orderCourseItems(order);
  const learners = orderLearnerCount(order);
  return (
    <table className={`${k.table} ${s.itemsTable}`}>
      <caption className={k.srOnly}>Courses in order #{shortId}</caption>
      <thead>
        <tr>
          <th scope="col">Course</th>
          <th scope="col" className={`${k.num} ${s.wideOnly}`}>Price per learner</th>
          <th scope="col" className={`${k.num} ${s.wideOnly}`}>Learners</th>
          <th scope="col" className={k.num}>Line total</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && (
          <tr><td colSpan={4} className={k.empty}>No course details were saved with this order.</td></tr>
        )}
        {items.map((item, i) => (
          <tr key={`${item.courseId}-${i}`}>
            <td>
              <span className={s.itemTitle}>{item.title || 'Untitled course'}</span>
              <span className={`${s.itemSub} ${s.narrowOnly}`}>
                {fmtAmount(item.unit_price)} × {plural(Number(item.learners) || 0, 'learner')}
              </span>
            </td>
            <td className={`${k.num} ${s.wideOnly}`}>{fmtAmount(item.unit_price)}</td>
            <td className={`${k.num} ${s.wideOnly}`}>{item.learners}</td>
            <td className={`${k.num} ${k.strong}`}>{fmtAmount(item.line_total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className={s.totalLabel}>
            Total
            <span className={`${s.itemSub} ${s.narrowOnly}`}>{plural(learners, 'learner')}</span>
          </td>
          <td className={s.wideOnly} />
          <td className={`${k.num} ${s.wideOnly} ${s.totalLabel}`}>{learners}</td>
          <td className={`${k.num} ${s.totalAmount}`}>{fmtAmount(order.credit_amount)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function CreditPlanTable({ order, shortId }) {
  const credit = order.credit_id ?? {};
  return (
    <table className={`${k.table} ${s.itemsTable}`}>
      <caption className={k.srOnly}>Credit plan in order #{shortId}</caption>
      <thead>
        <tr>
          <th scope="col">Plan</th>
          <th scope="col" className={k.num}>Credits</th>
          <th scope="col" className={k.num}>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><span className={s.itemTitle}>{credit.title || 'Credit plan'}</span></td>
          <td className={k.num}>{creditRange(credit)}</td>
          <td className={`${k.num} ${k.strong}`}>{fmtAmount(order.credit_amount)}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td className={s.totalLabel} colSpan={2}>Total</td>
          <td className={`${k.num} ${s.totalAmount}`}>{fmtAmount(order.credit_amount)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
