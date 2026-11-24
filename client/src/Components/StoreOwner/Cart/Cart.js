'use client';

import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { selectUser } from '../../../redux/slices/authSlice';
import apiServiceHandler from '../../../service/apiService';
import { useStoreCart, clampLearners, MAX_LEARNERS_PER_ITEM } from '../../../lib/storeCart';
import { kit as k, PageHeader, Card, Pill, KitIcon } from '../PageKit/PageKit';
import { coursePrice, formatPrice, lineTotal } from './cartFormat';
import { openRazorpayCheckout } from '../../../lib/razorpayCheckout';
import s from './Cart.module.css';

const ALL_COURSES_PATH = '/storeowner/all-courses';

/** − [ n ] + for the number of learners; typing is kept as text until it's a valid number. */
function LearnerStepper({ value, onChange, label }) {
  const [draft, setDraft] = useState(null); // text while typing, null when showing `value`
  const commit = (text) => { onChange(clampLearners(text || value)); setDraft(null); };
  return (
    <div className={s.stepper} role="group" aria-label={label}>
      <button type="button" className={s.stepBtn} aria-label="One learner fewer"
        disabled={value <= 1} onClick={() => onChange(value - 1)}>−</button>
      <input className={s.stepInput} type="text" inputMode="numeric" aria-label="Number of learners"
        value={draft ?? String(value)}
        onChange={e => { if (/^\d{0,5}$/.test(e.target.value)) setDraft(e.target.value); }}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <button type="button" className={s.stepBtn} aria-label="One learner more"
        disabled={value >= MAX_LEARNERS_PER_ITEM} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export default function Cart() {
  const user = useSelector(selectUser);
  const router = useRouter();
  const cart = useStoreCart(user?._id);
  const [courses, setCourses] = useState(null); // null while loading
  const [placing, setPlacing] = useState(false);
  const [payStep, setPayStep] = useState('');   // what's happening while paying, for the button
  // Razorpay: { configured, mode: 'test' | 'live' } — test keys = sandbox, live keys = real money.
  const [gateway, setGateway] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiServiceHandler('GET', `order/razorpay/config?t=${Date.now()}`)
      .then(res => { if (!cancelled) setGateway(res?.data || { configured: false }); })
      .catch(() => { if (!cancelled) setGateway({ configured: false }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiServiceHandler('GET', 'course/list?status=published')
      .then(res => { if (!cancelled) setCourses(Array.isArray(res?.data) ? res.data : []); })
      .catch(() => {
        if (cancelled) return;
        setCourses([]);
        toast.warning('Could not load course prices. Please refresh the page.');
      });
    return () => { cancelled = true; };
  }, []);

  const loading = courses === null;
  const byId = new Map((courses || []).map(c => [String(c._id), c]));
  const rows = cart.items.map(item => {
    const course = byId.get(item.courseId);
    const unit = course ? coursePrice(course) : 0;
    return { ...item, course, unit, total: course ? lineTotal(unit, item.learners) : 0 };
  });
  // No course is free: a course without a price can't be ordered, like a course that's gone.
  const priced = (r) => r.course && r.unit > 0;
  const available = rows.filter(priced);
  const unavailable = loading ? 0 : rows.length - available.length;
  const totalLearners = available.reduce((n, r) => n + r.learners, 0);
  const grandTotal = Math.round(available.reduce((n, r) => n + r.total, 0) * 100) / 100;
  const needsPayment = grandTotal > 0;
  const paymentReady = !needsPayment || gateway?.configured === true;
  const canPlace = !loading && !placing && available.length > 0 && unavailable === 0 && gateway !== null && paymentReady;

  function orderPlaced(orderId, message) {
    cart.clear();
    toast.success(message);
    router.push(orderId ? `/storeowner/orders/${orderId}` : '/storeowner/orders');
  }

  // Pay: the server prices the cart and opens a Razorpay order for that amount; after
  // Checkout the server verifies the payment, then adds the courses and learners.
  async function placeOrder() {
    if (!canPlace) return;
    setPlacing(true);
    setPayStep('Starting payment…');
    let started = null;
    let paidAtRazorpay = false;
    try {
      const res = await apiServiceHandler('POST', 'order/razorpay/checkout', {
        items: available.map(r => ({ courseId: r.courseId, learners: r.learners })),
      });
      started = res?.data;
      if (started?.paid) { // nothing to charge — placed straight away
        orderPlaced(started.order?._id, 'Order placed. The courses are now in My Courses.');
        return;
      }

      setPayStep('Waiting for payment…');
      const result = await openRazorpayCheckout({
        keyId: started.keyId,
        razorpayOrderId: started.razorpayOrderId,
        amount: started.amount,
        currency: started.currency,
        name: 'sikhoaurbadho',
        description: `${available.length} course${available.length !== 1 ? 's' : ''} · ${totalLearners} learner${totalLearners !== 1 ? 's' : ''}`,
        prefill: started.prefill,
      });

      if (result.status !== 'paid') {
        apiServiceHandler('POST', 'order/razorpay/cancel', { orderId: started.orderId }).catch(() => {});
        toast.info(result.lastError ? `Payment not completed: ${result.lastError}` : 'Payment canceled. Your cart is unchanged.');
        return;
      }

      paidAtRazorpay = true;
      setPayStep('Confirming payment…');
      await apiServiceHandler('POST', 'order/razorpay/verify', {
        orderId: started.orderId,
        razorpayOrderId: result.razorpayOrderId,
        razorpayPaymentId: result.razorpayPaymentId,
        signature: result.signature,
      });
      orderPlaced(started.orderId, 'Payment successful. The courses are now in My Courses.');
    } catch (err) {
      if (paidAtRazorpay && started?.orderId) {
        // Paid at Razorpay but not confirmed here: Razorpay's webhook completes the order.
        // The cart is kept until the order shows as successful.
        toast.warning('Your payment was received but is still being confirmed. Check this order in a few minutes — do not pay again.');
        router.push(`/storeowner/orders/${started.orderId}`);
      } else {
        toast.warning(err?.message || 'Could not complete the payment. Please try again.');
      }
    } finally {
      setPlacing(false);
      setPayStep('');
    }
  }

  const continueBtn = (
    <button type="button" className={k.btnOutline} onClick={() => router.push(ALL_COURSES_PATH)}>
      Continue Shopping
    </button>
  );

  if (!loading && rows.length === 0) {
    return (
      <div className={k.page}>
        <PageHeader title="Cart" sub="Choose how many learners you are buying each course for." />
        <Card>
          <div className={s.emptyState}>
            <span className={s.emptyIcon} aria-hidden="true">{KitIcon.cart}</span>
            <p className={s.emptyTitle}>Your cart is empty</p>
            <p className={s.emptyText}>Add courses from All Courses, then set the number of learners here.</p>
            <button type="button" className={k.btnPrimary} onClick={() => router.push(ALL_COURSES_PATH)}>
              Browse Courses
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={k.page}>
      <PageHeader title="Cart" sub="Choose how many learners you are buying each course for." actions={continueBtn} />

      <div className={s.layout}>
        <Card title="Courses in your cart" flush
          meta={<Pill tone="neutral">{rows.length} course{rows.length !== 1 ? 's' : ''}</Pill>}>
          <div className={k.tableWrap}>
            <table className={`${k.table} ${s.cartTable}`}>
              <thead>
                <tr>
                  <th>Course</th>
                  <th className={k.num}>Price per learner</th>
                  <th className={s.thLearners}>No. of learners</th>
                  <th className={k.num}>Row total</th>
                  <th><span className={k.srOnly}>Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.courseId} className={!loading && !priced(r) ? s.rowUnavailable : undefined}>
                    <td>
                      <div className={s.courseCell}>
                        <span className={s.courseTitle}>{loading ? 'Loading…' : (r.course?.title || 'Course no longer available')}</span>
                        {!loading && r.course && (r.course.catId?.title || r.course.level) && (
                          <span className={s.courseMeta}>
                            {[r.course.catId?.title, r.course.level].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {!loading && !r.course && <span className={s.courseMeta}>Remove it to place your order.</span>}
                        {!loading && r.course && !(r.unit > 0) && <span className={s.courseMeta}>This course has no price yet. Remove it to place your order.</span>}
                      </div>
                    </td>
                    <td className={k.num}>{loading || !r.course ? '—' : formatPrice(r.unit)}</td>
                    <td>
                      {r.course || loading
                        ? <LearnerStepper value={r.learners} label={`Learners for ${r.course?.title || 'this course'}`}
                            onChange={n => cart.setLearners(r.courseId, n)} />
                        : '—'}
                    </td>
                    <td className={`${k.num} ${k.strong}`}>{loading || !r.course ? '—' : formatPrice(r.total)}</td>
                    <td>
                      <div className={k.actions}>
                        <button type="button" className={k.iconBtnDanger} data-action="delete"
                          title="Remove from cart" aria-label={`Remove ${r.course?.title || 'course'} from cart`}
                          onClick={() => cart.remove(r.courseId)}>
                          {KitIcon.trash}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Order summary" className={s.summaryCard}>
          <dl className={s.summary}>
            <div className={s.summaryRow}><dt>Courses</dt><dd>{available.length}</dd></div>
            <div className={s.summaryRow}><dt>Total learners</dt><dd>{totalLearners}</dd></div>
            <div className={`${s.summaryRow} ${s.summaryTotal}`}>
              <dt>Total amount</dt>
              <dd>{loading ? '—' : formatPrice(grandTotal)}</dd>
            </div>
          </dl>
          {unavailable > 0 && (
            <p className={s.summaryWarn} role="alert">
              {unavailable} course{unavailable !== 1 ? 's are' : ' is'} not available to buy (removed, or no price yet). Remove {unavailable !== 1 ? 'them' : 'it'} to continue.
            </p>
          )}
          {needsPayment && gateway && !gateway.configured && (
            <p className={s.summaryWarn} role="alert">
              Online payment is not set up yet. Please contact support to complete this purchase.
            </p>
          )}
          <button type="button" className={`${k.btnPrimary} ${s.placeBtn}`} disabled={!canPlace} onClick={placeOrder}>
            {placing ? (payStep || 'Please wait…') : needsPayment ? `Pay ${loading ? '' : formatPrice(grandTotal)}` : 'Place Order'}
          </button>
          <p className={s.summaryNote}>
            {needsPayment
              ? 'Pay securely with Razorpay — UPI, cards, net banking or wallets. The courses are added to My Courses as soon as the payment is confirmed.'
              : 'Nothing to pay. The courses are added to My Courses straight away.'}
          </p>
          {needsPayment && gateway?.configured && gateway.mode === 'test' && (
            <p className={s.testMode}>
              <span className={s.testBadge}>Test mode</span> Razorpay sandbox — no real money is charged.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
