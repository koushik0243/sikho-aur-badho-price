// Formatting and wording for the store owner order detail page (ViewOrder).

/** Pill tone, label and — for orders that were not paid — what that means for the store owner. */
export const ORDER_STATUS = {
  success:  { tone: 'good',    label: 'Success' },
  pending:  { tone: 'warn',    label: 'Pending',
    title: 'Waiting for payment confirmation',
    text: 'Nothing has been added to your account yet. If you completed the payment, this order updates on its own once the payment is confirmed.' },
  failed:   { tone: 'bad',     label: 'Failed',
    title: 'The payment did not go through',
    text: 'Nothing was added to your account. You can try again by placing a new order.' },
  canceled: { tone: 'neutral', label: 'Canceled',
    title: 'This checkout was not completed',
    text: 'No money was taken and nothing was added to your account.' },
  refunded: { tone: 'info',    label: 'Refunded',
    title: 'This order was refunded',
    text: 'The amount paid for this order has been refunded.' },
};

export function orderStatus(order) {
  const key = String(order?.status || 'pending').toLowerCase();
  return { key, ...(ORDER_STATUS[key] ?? { tone: 'neutral', label: order?.status || '—' }) };
}

export function fmtAmount(val) {
  const n = val != null ? parseFloat(val) : NaN;
  if (Number.isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDateTime(val) {
  const d = val ? new Date(val) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const readable = value => String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** How the order was paid, in words: Razorpay, online/offline (entered by the admin), free… */
export function paymentMethodLabel(order) {
  const gateway = String(order?.payment_gateway || '').toLowerCase();
  if (order?.razorpay_payment_id || gateway === 'razorpay') return 'Razorpay';
  if (order?.payment_mode === 'online') return 'Online payment';
  if (order?.payment_mode === 'offline') return 'Offline payment';
  if (gateway === 'none') return Number(order?.credit_amount) > 0 ? 'Not recorded' : 'Free — nothing to pay';
  return gateway ? readable(gateway) : '—';
}

/**
 * Notes entered with the payment (cheque / UPI reference…). Razorpay orders store
 * "Razorpay payment <id>" here, which the payment id row already shows.
 */
export function paymentNotes(order) {
  const notes = String(order?.payment_details || '').trim();
  if (!notes) return '';
  if (order?.razorpay_payment_id && notes === `Razorpay payment ${order.razorpay_payment_id}`) return '';
  return notes;
}

/** "10–50" credits for an old credit-plan order. */
export function creditRange(credit = {}) {
  if (credit.limit_from != null && credit.limit_to != null) return `${credit.limit_from}–${credit.limit_to}`;
  if (credit.limit_to != null) return String(credit.limit_to);
  if (credit.limit_from != null) return `${credit.limit_from}+`;
  return '—';
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
