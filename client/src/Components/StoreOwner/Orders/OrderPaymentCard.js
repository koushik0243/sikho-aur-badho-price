'use client';

import { useEffect, useState } from 'react';
import { kit as k, Card } from '../PageKit/PageKit';
import { paymentMethodLabel, paymentNotes } from './orderViewUtils';
import s from './ViewOrder.module.css';

const COPY_RESET_MS = 2000;

const CopyIcon = (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M8 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0015.414 5L13 2.586A2 2 0 0011.586 2H8z" />
    <path d="M4 6a2 2 0 012-2v10h8a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
  </svg>
);

/** How the order was paid and the references needed to trace it (Razorpay ids, order id). */
export default function OrderPaymentCard({ order }) {
  const notes = paymentNotes(order);
  return (
    <Card id="order-payment" title="Payment">
      <dl className={s.payList}>
        <PayRow label="Method">{paymentMethodLabel(order)}</PayRow>
        {order.razorpay_payment_id && (
          <PayRow label="Payment ID"><CopyValue value={order.razorpay_payment_id} name="payment ID" /></PayRow>
        )}
        {order.razorpay_order_id && (
          <PayRow label="Razorpay order ID"><CopyValue value={order.razorpay_order_id} name="Razorpay order ID" /></PayRow>
        )}
        <PayRow label="Order reference"><CopyValue value={String(order._id)} name="order reference" /></PayRow>
        {notes && <PayRow label="Notes"><span className={s.notes}>{notes}</span></PayRow>}
      </dl>
    </Card>
  );
}

function PayRow({ label, children }) {
  return (
    <div className={s.payRow}>
      <dt className={s.payLabel}>{label}</dt>
      <dd className={s.payValue}>{children}</dd>
    </div>
  );
}

/** A reference id with a copy button; the result is announced to screen readers. */
function CopyValue({ value, name }) {
  const [state, setState] = useState('idle'); // idle | copied | failed

  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => setState('idle'), COPY_RESET_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed'); // clipboard blocked or unavailable (e.g. not on https)
    }
  }

  return (
    <span className={s.copyRow}>
      <code className={s.code}>{value}</code>
      <button type="button" className={`${k.iconBtn} ${s.copyBtn}`} onClick={copy}
        aria-label={`Copy ${name}`} title={`Copy ${name}`}>
        {CopyIcon}
      </button>
      <span className={state === 'failed' ? s.copyFailed : s.copyDone} aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </span>
  );
}
