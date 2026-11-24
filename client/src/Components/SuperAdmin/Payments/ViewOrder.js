'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import apiServiceHandler from '../../../service/apiService';
import SuperAdminShell from '../SuperAdminShell';
import vpPage from "./ViewOrder.module.css";
import { withAdminKit } from '../AdminKit/AdminKit';
import { isCourseOrder, orderCourseItems, orderLearnerCount } from '../../../lib/orderDisplay';
import OrderCourseItems from '../../OrderCourseItems/OrderCourseItems';

// Page styles + the shared super admin look.
const vp = withAdminKit(vpPage);

const BackArrow = (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
  </svg>
);

function fmtDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtAmount(val) {
  if (val === null || val === undefined) return '—';
  return `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_BADGE = {
  active:   vp => vp.badgeActive,
  paid:     vp => vp.badgePaid,
  pending:  vp => vp.badgePending,
  failed:   vp => vp.badgeFailed,
  refunded: vp => vp.badgeRefunded,
};

export default function ViewOrder() {
  const router = useRouter();
  const { id } = useParams();
  const [order, setOrder]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    apiServiceHandler('GET', `order/edit/${id}`)
      .then(res => setOrder(res?.data ?? null))
      .catch(() => setOrder(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <SuperAdminShell activeSection="orders"><p className={vp.loadingText}>Loading…</p></SuperAdminShell>;
  if (!order)  return (
    <SuperAdminShell activeSection="orders">
      <button className={vp.backBtn} onClick={() => router.push('/superadmin/payments/orders')}>
        {BackArrow} Back to Orders
      </button>
      <p className={vp.loadingText}>Order not found.</p>
    </SuperAdminShell>
  );

  const shortId    = `#${String(order._id).slice(-8).toUpperCase()}`;
  const statusKey  = (order.status || '').toLowerCase();
  const badgeCls   = STATUS_BADGE[statusKey] ? STATUS_BADGE[statusKey](vp) : vp.badgeNeutral;
  const statusText = order.status ? order.status.charAt(0).toUpperCase() + order.status.slice(1) : '—';
  const courseOrder = isCourseOrder(order);

  return (
    <SuperAdminShell activeSection="orders">
      <button className={vp.backBtn} onClick={() => router.push('/superadmin/payments/orders')}>
        {BackArrow} Back to Orders
      </button>
      <nav className={vp.breadcrumb}>
        <button className={vp.breadcrumbLink} onClick={() => router.push('/superadmin/payments/orders')}>Orders</button>
        <span className={vp.breadcrumbSep}>›</span>
        <span className={vp.breadcrumbCurr}>{shortId}</span>
      </nav>

      <div className={vp.detailCardWide}>
        <div className={vp.detailHead}>
          <div className={vp.detailHeadLeft}>
            <div className={vp.detailAvatarAmber}>#</div>
            <div>
              <h1 className={vp.detailTitle}>{shortId}</h1>
              <div className={vp.detailBadges}>
                <span className={badgeCls}>{statusText}</span>
              </div>
            </div>
          </div>
        </div>

        <div className={vp.detailSections}>
          <div className={vp.sectionBlock}>
            <div className={vp.sectionTitle}>{courseOrder ? 'Organization & Courses' : 'Organization & Credit'}</div>
            <div className={vp.sectionRows}>
              <div className={vp.sectionRow}>
                <span className={vp.sectionLabel}>Organization</span>
                <span className={vp.sectionValue}>{order.organizer_id?.org_name || '—'}</span>
              </div>
              <div className={vp.sectionRow}>
                <span className={vp.sectionLabel}>Org Email</span>
                <span className={vp.sectionValue}>{order.organizer_id?.org_email || '—'}</span>
              </div>
              <div className={vp.sectionRow}>
                <span className={vp.sectionLabel}>Org Phone</span>
                <span className={vp.sectionValue}>{order.organizer_id?.org_phone || '—'}</span>
              </div>
              {courseOrder ? (
                <>
                  <div className={vp.sectionRow}>
                    <span className={vp.sectionLabel}>Order Type</span>
                    <span className={vp.sectionValue}>Course purchase</span>
                  </div>
                  <div className={vp.sectionRow}>
                    <span className={vp.sectionLabel}>Courses / Learners</span>
                    <span className={vp.sectionValue}>{orderCourseItems(order).length} / {orderLearnerCount(order)}</span>
                  </div>
                </>
              ) : (
                <div className={vp.sectionRow}>
                  <span className={vp.sectionLabel}>Credit Package</span>
                  <span className={vp.sectionValue}>{order.credit_id?.title || '—'}</span>
                </div>
              )}
            </div>
          </div>

          <div className={vp.sectionBlock}>
            <div className={vp.sectionTitle}>Payment</div>
            <div className={vp.sectionRows}>
              <div className={vp.sectionRow}>
                <span className={vp.sectionLabel}>Amount</span>
                <span className={vp.sectionValueEmph}>{fmtAmount(order.credit_amount)}</span>
              </div>
              {order.payment_mode ? (
                <>
                  <div className={vp.sectionRow}>
                    <span className={vp.sectionLabel}>Payment Mode</span>
                    <span className={vp.sectionValue} style={{ textTransform: 'capitalize' }}>{order.payment_mode}</span>
                  </div>
                  <div className={vp.sectionRow}>
                    <span className={vp.sectionLabel}>Payment Details</span>
                    <span className={vp.sectionValue} style={{ whiteSpace: 'pre-wrap' }}>{order.payment_details || '—'}</span>
                  </div>
                </>
              ) : (
                <div className={vp.sectionRow}>
                  <span className={vp.sectionLabel}>Payment Gateway</span>
                  <span className={vp.sectionValue}>{order.payment_gateway || '—'}</span>
                </div>
              )}
              <div className={vp.sectionRow}>
                <span className={vp.sectionLabel}>Purchase Date</span>
                <span className={vp.sectionValue}>{fmtDate(order.purchase_date)}</span>
              </div>
              <div className={vp.sectionRow}>
                <span className={vp.sectionLabel}>Created</span>
                <span className={vp.sectionValue}>{fmtDate(order.createdAt)}</span>
              </div>
              <div className={vp.sectionRow}>
                <span className={vp.sectionLabel}>Updated</span>
                <span className={vp.sectionValue}>{fmtDate(order.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>
        {courseOrder && <OrderCourseItems order={order} />}
      </div>
    </SuperAdminShell>
  );
}
