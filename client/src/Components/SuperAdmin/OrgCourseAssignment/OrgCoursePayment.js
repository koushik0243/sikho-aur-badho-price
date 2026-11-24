'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import apiServiceHandler from '../../../service/apiService';
import SuperAdminShell from '../SuperAdminShell';
import sPage from './AddOrgCourseAssignment.module.css';
import { withAdminKit } from '../AdminKit/AdminKit';
import { FormCard, OrgField, OrgName, SectionHead, TableMessage } from './CourseLearnersTable';
import OrderCourseItems from '../../OrderCourseItems/OrderCourseItems';
import { lineTotal } from '../../StoreOwner/Cart/cartFormat';
import { readPurchaseDraft, clearPurchaseDraft } from './purchaseDraft';
import p from './OrgCoursePayment.module.css';

// Page styles + the shared super admin look.
const s = withAdminKit(sPage);

const LIST_PATH = '/superadmin/organization-course-assignment';
const PAYMENT_MODES = [
  { value: 'online',  label: 'Online' },
  { value: 'offline', label: 'Offline' },
];
const MAX_DETAILS = 2000;

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7" />
  </svg>
);

// The draft is read from sessionStorage in the browser only (null while server-rendering).
const noSubscribe = () => () => {};
const draftSnapshot = () => JSON.stringify(readPurchaseDraft());

// Payment step of Add / Edit Organization Course: shows what is being bought, takes the
// payment mode and details (both required), then places the order — the courses are added
// to the organization with their learners, and the order + invoice are created.
export default function OrgCoursePayment() {
  const router = useRouter();
  const draftJson = useSyncExternalStore(noSubscribe, draftSnapshot, () => null);
  const draft = useMemo(() => (draftJson ? JSON.parse(draftJson) : null), [draftJson]);

  const [mode, setMode]           = useState('');
  const [details, setDetails]     = useState('');
  const [errors, setErrors]       = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Summary in the shape OrderCourseItems shows (the server prices the real order).
  const summary = useMemo(() => {
    if (!draft) return null;
    const items = draft.items.map(i => ({
      courseId: i.courseId, title: i.title, unit_price: i.unitPrice, learners: i.learners,
      line_total: lineTotal(i.unitPrice, i.learners),
    }));
    const total = Math.round(items.reduce((sum, i) => sum + i.line_total, 0) * 100) / 100;
    return { items, credit_amount: total, learners: items.reduce((n, i) => n + i.learners, 0) };
  }, [draft]);

  const goBack = () => router.push(draft?.returnPath || LIST_PATH);

  function validate() {
    const e = {};
    if (!mode) e.mode = 'Please select a payment mode.';
    if (!details.trim()) e.details = 'Please enter the payment details.';
    else if (details.trim().length > MAX_DETAILS) e.details = `Payment details can be at most ${MAX_DETAILS} characters.`;
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!draft || submitting) return;
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      await apiServiceHandler('POST', 'order/purchase-courses', {
        orgId: draft.orgId,
        items: draft.items.map(i => ({ courseId: i.courseId, learners: i.learners })),
        paymentMode: mode,
        paymentDetails: details.trim(),
      });
    } catch (err) {
      toast.warning(err?.message || 'Could not assign the courses. Please try again.');
      setSubmitting(false);
      return;
    }

    // Paid and assigned. Edit page changes: the courses it unticked are removed now.
    const removeIds = draft.removeIds || [];
    const removed = await Promise.allSettled(removeIds.map(id => apiServiceHandler('GET', `organization-course/delete/${id}`)));
    const failed = removed.filter(r => r.status === 'rejected').length;
    clearPurchaseDraft();
    const n = draft.items.length;
    toast.success(`${n} course${n !== 1 ? 's' : ''} assigned to ${draft.orgName || 'the organization'}. The order and invoice are created.`);
    if (failed) toast.warning(`${failed} course${failed !== 1 ? 's' : ''} could not be removed. Please try again from Edit.`);
    router.push(draft.donePath || LIST_PATH);
    router.refresh();
  }

  return (
    <SuperAdminShell activeSection="assign-course">
      <button className={s.backBtn} onClick={goBack} disabled={submitting}>
        <BackIcon /> Back
      </button>
      <h1 className={s.pageTitle}>Payment</h1>
      <p className={s.pageSubtitle}>Record how the organization paid, then assign the courses</p>

      {draftJson === null ? (
        <FormCard><TableMessage>Loading…</TableMessage></FormCard>
      ) : !draft ? (
        <FormCard>
          <TableMessage>Nothing to pay for. Select the courses on Add Organization Course first.</TableMessage>
          <div className={p.emptyActions}>
            <button type="button" className={s.btnPublish} onClick={() => router.push(`${LIST_PATH}/add`)}>
              Add Organization Course
            </button>
          </div>
        </FormCard>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <FormCard>
            <OrgField>
              <OrgName>{draft.orgName || '—'}</OrgName>
            </OrgField>

            <SectionHead
              title="Order summary"
              meta={`${summary.items.length} course${summary.items.length !== 1 ? 's' : ''} · ${summary.learners} learner${summary.learners !== 1 ? 's' : ''}`}
            />
            <div className={p.summary}>
              <OrderCourseItems order={summary} title="Courses to assign" />
              {draft.removeIds?.length > 0 && (
                <p className={p.removeNote}>
                  After payment, {draft.removeIds.length} unticked course{draft.removeIds.length !== 1 ? 's' : ''} will also be removed from the organization.
                </p>
              )}
            </div>

            <SectionHead title="Payment" />
            <div className={p.fields}>
              <div className={p.field}>
                <label className={p.label} htmlFor="payment-mode">
                  Payment Mode <span className={p.req} aria-hidden="true">*</span>
                </label>
                <select id="payment-mode" className={p.select} value={mode} required aria-required="true"
                  aria-invalid={Boolean(errors.mode) || undefined}
                  onChange={e => { setMode(e.target.value); setErrors(prev => ({ ...prev, mode: undefined })); }}
                  disabled={submitting}>
                  <option value="">— Select payment mode —</option>
                  {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                {errors.mode && <p className={p.error}>{errors.mode}</p>}
              </div>

              <div className={`${p.field} ${p.fieldWide}`}>
                <label className={p.label} htmlFor="payment-details">
                  Payment Details <span className={p.req} aria-hidden="true">*</span>
                </label>
                <textarea id="payment-details" className={p.textarea} rows={4} required aria-required="true"
                  aria-invalid={Boolean(errors.details) || undefined}
                  placeholder={mode === 'offline'
                    ? 'e.g. Cheque no., bank, date received'
                    : 'e.g. Transaction / UPI reference no., date'}
                  maxLength={MAX_DETAILS}
                  value={details}
                  onChange={e => { setDetails(e.target.value); setErrors(prev => ({ ...prev, details: undefined })); }}
                  disabled={submitting} />
                <div className={p.fieldFoot}>
                  {errors.details ? <p className={p.error}>{errors.details}</p> : <span />}
                  <span className={p.count}>{details.length} / {MAX_DETAILS}</span>
                </div>
              </div>
            </div>

            <div className={p.footer}>
              <button type="button" className={s.btnCancel} onClick={goBack} disabled={submitting}>Back</button>
              <button type="submit" className={s.btnPublish} disabled={submitting}>
                {submitting ? 'Assigning…' : 'Submit & Assign Courses'}
              </button>
            </div>
          </FormCard>
        </form>
      )}
    </SuperAdminShell>
  );
}
