'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import apiServiceHandler from '../../../service/apiService';
import { formatPrice } from '../../StoreOwner/Cart/cartFormat';
import p from './OrderPaymentEditor.module.css';

export const PAYMENT_MODES = [
  { value: 'online',  label: 'Online' },
  { value: 'offline', label: 'Offline' },
];
export const MAX_PAYMENT_DETAILS = 2000;

function fmtDate(val) {
  const d = new Date(val);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * One course order of the organization: what it bought (read-only) and its payment mode and
 * details, which are the only things that can be changed (PUT order/payment/:id).
 * `showSummary` false: only the payment fields (the page shows the order itself).
 * @param {{ order: object, onSaved: (order: object) => void, showSummary?: boolean }} props
 */
export default function OrderPaymentEditor({ order, onSaved, showSummary = true }) {
  const savedMode = order.payment_mode || '';
  const savedDetails = order.payment_details || '';
  const [mode, setMode] = useState(savedMode);
  const [details, setDetails] = useState(savedDetails);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const id = String(order._id);
  const shortId = id.slice(-8).toUpperCase();
  const items = Array.isArray(order.items) ? order.items : [];
  const changed = mode !== savedMode || details.trim() !== savedDetails;

  async function save(e) {
    e.preventDefault();
    const errs = {};
    if (!mode) errs.mode = 'Please select a payment mode.';
    if (!details.trim()) errs.details = 'Please enter the payment details.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const res = await apiServiceHandler('PUT', `order/payment/${id}`, { paymentMode: mode, paymentDetails: details.trim() });
      toast.success(`Payment details updated for order #${shortId}.`);
      onSaved?.(res?.data || { ...order, payment_mode: mode, payment_details: details.trim() });
    } catch (err) {
      toast.warning(err?.message || 'Could not update the payment details. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={showSummary ? p.card : p.plain} onSubmit={save} noValidate
      aria-label={showSummary ? undefined : `Payment for order #${shortId}`}
      aria-labelledby={showSummary ? `order-${id}-title` : undefined}>
      {showSummary && (
        <>
          <div className={p.head}>
            <div className={p.headLeft}>
              <span id={`order-${id}-title`} className={p.orderNo}>Order #{shortId}</span>
              <span className={p.orderMeta}>{fmtDate(order.purchase_date || order.createdAt)}</span>
            </div>
            <span className={p.total}>{formatPrice(order.credit_amount)}</span>
          </div>

          <ul className={p.items}>
            {items.map((it, i) => (
              <li key={`${it.courseId}-${i}`}>
                <span className={p.itemTitle}>{it.title}</span>
                <span className={p.itemCalc}>{it.learners} × {formatPrice(it.unit_price)} = {formatPrice(it.line_total)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className={p.fields}>
        <div className={p.field}>
          <label className={p.label} htmlFor={`pm-${id}`}>Payment Mode <span className={p.req} aria-hidden="true">*</span></label>
          <select id={`pm-${id}`} className={p.select} value={mode} disabled={saving}
            aria-invalid={Boolean(errors.mode) || undefined}
            onChange={e => { setMode(e.target.value); setErrors(prev => ({ ...prev, mode: undefined })); }}>
            <option value="">— Select payment mode —</option>
            {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          {errors.mode && <p className={p.error}>{errors.mode}</p>}
        </div>
        <div className={p.field}>
          <label className={p.label} htmlFor={`pd-${id}`}>Payment Details <span className={p.req} aria-hidden="true">*</span></label>
          <textarea id={`pd-${id}`} className={p.textarea} rows={3} maxLength={MAX_PAYMENT_DETAILS} disabled={saving}
            aria-invalid={Boolean(errors.details) || undefined}
            placeholder={mode === 'offline' ? 'e.g. Cheque no., bank, date received' : 'e.g. Transaction / UPI reference no., date'}
            value={details}
            onChange={e => { setDetails(e.target.value); setErrors(prev => ({ ...prev, details: undefined })); }} />
          {errors.details && <p className={p.error}>{errors.details}</p>}
        </div>
        <div className={p.actions}>
          <button type="submit" className={p.saveBtn} disabled={saving || !changed}>
            {saving ? 'Updating…' : 'Update Payment'}
          </button>
        </div>
      </div>
    </form>
  );
}
