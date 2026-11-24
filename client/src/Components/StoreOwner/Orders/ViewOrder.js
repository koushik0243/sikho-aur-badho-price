'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import apiServiceHandler from '../../../service/apiService';
import pageStyles from './ViewOrder.module.css';
import { withDetailKit, kit as k, Pill, KitIcon } from '../PageKit/PageKit';
import { isCourseOrder, orderCourseItems, orderLearnerCount } from '../../../lib/orderDisplay';
import OrderItemsCard from './OrderItemsCard';
import OrderPaymentCard from './OrderPaymentCard';
import { fmtAmount, fmtDateTime, orderStatus, plural } from './orderViewUtils';

// Page styles + the shared store owner detail-page look (back button, breadcrumb).
const vp = withDetailKit(pageStyles);
const s = pageStyles;

const ORDERS_PATH = '/storeowner/orders';

const BackArrow = (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
  </svg>
);

const NOTICE_ICON = { warn: KitIcon.clock, bad: KitIcon.x, neutral: KitIcon.x, info: KitIcon.coins };

/** Id of the order's invoice (created once a purchase is paid), or null if it has none. */
function useOrderInvoiceId(orderId) {
  const [found, setFound] = useState({ orderId: null, invoiceId: null });

  useEffect(() => {
    if (!orderId) return undefined;
    let cancelled = false;
    // The server limits a store owner's invoice list to their own organization.
    apiServiceHandler('GET', `invoice/list?order_id=${encodeURIComponent(orderId)}`)
      .then(res => {
        const data = res?.data ?? res;
        const list = Array.isArray(data) ? data : [];
        const invoice = list.find(i => i.payment_status === 'paid') ?? list[0];
        if (!cancelled) setFound({ orderId, invoiceId: invoice?._id ?? null });
      })
      .catch(() => { /* no invoice link; the rest of the page is unaffected */ });
    return () => { cancelled = true; };
  }, [orderId]);

  return found.orderId === orderId ? found.invoiceId : null;
}

export default function ViewOrder() {
  const router = useRouter();
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const invoiceId = useOrderInvoiceId(order?._id);

  useEffect(() => {
    if (!id) return;
    apiServiceHandler('GET', `order/edit/${id}`)
      .then(res => setOrder(res?.data ?? res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const goBack = () => router.push(ORDERS_PATH);

  if (loading) return <p className={vp.loadingText} role="status">Loading…</p>;
  if (!order?._id) return (
    <>
      <BackNav current="Not Found" onBack={goBack} />
      <p className={vp.loadingText}>Order not found.</p>
    </>
  );

  const shortId = String(order._id).slice(-8).toUpperCase();
  const status = orderStatus(order);

  return (
    <div className={s.page}>
      <BackNav current={`#${shortId}`} onBack={goBack} />
      <OrderSummary order={order} shortId={shortId} status={status} invoiceId={invoiceId} />
      {status.title && <StatusNotice status={status} />}
      <div className={s.layout}>
        <OrderItemsCard order={order} shortId={shortId} />
        <OrderPaymentCard order={order} />
      </div>
    </div>
  );
}

function BackNav({ current, onBack }) {
  return (
    <div className={s.nav}>
      <button type="button" className={vp.backBtn} onClick={onBack}>
        {BackArrow} Back to Orders
      </button>
      <nav className={vp.breadcrumb} aria-label="Breadcrumb">
        <button type="button" className={vp.breadcrumbLink} onClick={onBack}>Orders</button>
        <span className={vp.breadcrumbSep} aria-hidden="true">›</span>
        <span className={vp.breadcrumbCurr} aria-current="page">{current}</span>
      </nav>
    </div>
  );
}

/** "2 courses · 7 learners", or the credit plan's name for older credit orders. */
function purchaseSummary(order) {
  if (!isCourseOrder(order)) return order.credit_id?.title || 'Credit plan';
  return `${plural(orderCourseItems(order).length, 'course')} · ${plural(orderLearnerCount(order), 'learner')}`;
}

function OrderSummary({ order, shortId, status, invoiceId }) {
  const paid = status.key === 'success';
  const placed = order.purchase_date || order.createdAt;
  const placedIso = placed && !Number.isNaN(new Date(placed).getTime()) ? new Date(placed).toISOString() : undefined;
  return (
    <section className={s.summary} aria-labelledby="order-title">
      <div className={s.summaryMain}>
        <p className={s.eyebrow}>{isCourseOrder(order) ? 'Course purchase' : 'Credit plan purchase'}</p>
        <div className={s.titleRow}>
          <h1 id="order-title" className={s.title}>Order #{shortId}</h1>
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
        <dl className={s.meta}>
          <div className={s.metaItem}>
            <dt className={s.metaLabel}>Placed on</dt>
            <dd className={s.metaValue}><time dateTime={placedIso}>{fmtDateTime(placed)}</time></dd>
          </div>
          <div className={s.metaItem}>
            <dt className={s.metaLabel}>Purchased</dt>
            <dd className={s.metaValue}>{purchaseSummary(order)}</dd>
          </div>
        </dl>
      </div>
      <div className={s.amountBox}>
        <span className={s.amountLabel}>{paid ? 'Amount paid' : 'Order total'}</span>
        <span className={`${s.amount} ${paid ? '' : s.amountMuted}`}>{fmtAmount(order.credit_amount)}</span>
        {invoiceId && (
          <Link href={`/storeowner/invoices/${invoiceId}`} className={`${k.btnOutline} ${s.invoiceBtn}`}>
            <span aria-hidden="true">{KitIcon.doc}</span> View invoice
          </Link>
        )}
      </div>
    </section>
  );
}

function StatusNotice({ status }) {
  return (
    <div className={`${s.notice} ${s[`notice_${status.tone}`] ?? ''}`} role="status">
      <span className={s.noticeIcon} aria-hidden="true">{NOTICE_ICON[status.tone] ?? KitIcon.clock}</span>
      <div>
        <p className={s.noticeTitle}>{status.title}</p>
        <p className={s.noticeText}>{status.text}</p>
      </div>
    </div>
  );
}
