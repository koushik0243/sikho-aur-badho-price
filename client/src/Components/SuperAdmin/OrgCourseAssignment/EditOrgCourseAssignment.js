'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import apiServiceHandler from '../../../service/apiService';
import SuperAdminShell from '../SuperAdminShell';
// Same look as Add Organization Course.
import sPage from "./AddOrgCourseAssignment.module.css";
import { withAdminKit } from '../AdminKit/AdminKit';
import { FormCard, OrgField, OrgName, SectionHead, TableMessage } from './CourseLearnersTable';
import OrderPaymentEditor from './OrderPaymentEditor';
import OrderCourseItems from '../../OrderCourseItems/OrderCourseItems';
import p from './EditOrgCoursePage.module.css';

// Page styles + the shared super admin look.
const s = withAdminKit(sPage);

const LIST_PATH = '/superadmin/organization-course-assignment';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7" />
  </svg>
);

function fmtDate(val) {
  const d = new Date(val);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Edit Organization Course — one course order (/organization-course-assignment/<orderId>):
// the courses bought in that order (price per learner, learners, cost as paid; read-only)
// and its payment mode and details, the only things that can be changed here.
// An organization id (older links, the View page) opens the list filtered to that organization.
export default function EditOrgCourseAssignment() {
  const router = useRouter();
  const params = useParams();
  const id = params?.orderId;

  const [loading, setLoading] = useState(true);
  const [order, setOrder]     = useState(null);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    apiServiceHandler('GET', `order/edit/${id}?t=${Date.now()}`)
      .then(res => res?.data || null)
      .catch(() => null)
      .then(async (found) => {
        if (cancelled) return;
        if (found?.order_type === 'course') { setOrder(found); return; }
        // Not a course order: maybe an organization id from an older link.
        const org = await apiServiceHandler('GET', `organization/edit/${id}`).then(r => r?.data).catch(() => null);
        if (!cancelled && org?._id) router.replace(`${LIST_PATH}?orgId=${org._id}`);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, router]);

  const goBack = () => { router.push(LIST_PATH); router.refresh(); };
  const shortId = order ? String(order._id).slice(-8).toUpperCase() : '';
  const items = Array.isArray(order?.items) ? order.items : [];
  const learners = items.reduce((n, it) => n + (Number(it.learners) || 0), 0);

  return (
    <SuperAdminShell activeSection="assign-course">
      <button className={s.backBtn} onClick={goBack}>
        <BackIcon /> Back
      </button>
      <h1 className={s.pageTitle}>Edit Organization Course{order ? ` — Order #${shortId}` : ''}</h1>
      <p className={s.pageSubtitle}>The courses bought in this order. Only the payment details can be changed.</p>

      <FormCard>
        {loading ? (
          <TableMessage>Loading order…</TableMessage>
        ) : !order ? (
          <TableMessage>Order not found.</TableMessage>
        ) : (
          <>
            <OrgField>
              <OrgName>{order.organizer_id?.org_name || '—'}</OrgName>
            </OrgField>

            <SectionHead
              title={`Order #${shortId}`}
              meta={`${items.length} course${items.length !== 1 ? 's' : ''} · ${learners} learner${learners !== 1 ? 's' : ''}`}
              hint={`Purchased on ${fmtDate(order.purchase_date || order.createdAt)}`}
            />
            <div className={p.section}>
              <OrderCourseItems order={order} title="Courses purchased" />
            </div>

            <SectionHead title="Payment" hint="Update how this order was paid" />
            <OrderPaymentEditor order={order} showSummary={false} onSaved={saved => setOrder(prev => ({ ...prev, ...saved, organizer_id: prev.organizer_id }))} />
          </>
        )}

        <div className={p.footer}>
          <button type="button" className={s.btnCancel} onClick={goBack}>Back to list</button>
        </div>
      </FormCard>
    </SuperAdminShell>
  );
}
