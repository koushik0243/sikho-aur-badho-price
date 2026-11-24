'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import apiServiceHandler from '../../../service/apiService';
import SuperAdminShell from '../SuperAdminShell';
import ConfirmModal from '../ConfirmModal';
import sPage from "./OrgCourseAssignmentList.module.css";
import { withAdminKit } from '../AdminKit/AdminKit';
import { EmptyState, PageGap, PlusIcon, ResultCount, SkeletonRows, SortArrow, pageItems } from '../AdminKit/ListParts';
import useBulkDelete from '../AdminKit/useBulkDelete';
import { orDash } from '../../../lib/displayValue';
import { formatPrice } from '../../StoreOwner/Cart/cartFormat';

// Page styles + the shared super admin look.
const s = withAdminKit(sPage);

const BASE_PATH = '/superadmin/organization-course-assignment';
const LIMIT = 50;      // orders per page
const COLUMNS = 14;

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
  </svg>
);
const EditIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
  </svg>
);

function fmtDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return '—';
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

const idOf = v => String(v?._id ?? v ?? '');
const listOf = res => (Array.isArray(res?.data) ? res.data : []);
const time = v => new Date(v).getTime() || 0;

/**
 * One group per course order (its courses as bought: price, learners, cost). A course the
 * organization has with no purchase (added before purchases existed) is a group of its own,
 * marked "No purchase". Newest first.
 */
function buildGroups(orgCourses, orders) {
  // The organization-course record (status, Delete) for each organization + course.
  const orgCourseByKey = new Map();
  for (const oc of orgCourses) orgCourseByKey.set(`${idOf(oc.orgId)}|${idOf(oc.courseId)}`, oc);

  const groups = [];
  const purchased = new Set();
  for (const o of orders) {
    if (o.order_type !== 'course' || o.status !== 'success') continue;
    const orgId = idOf(o.organizer_id);
    const courses = (o.items || []).map((it, i) => {
      const courseId = idOf(it.courseId);
      const oc = orgCourseByKey.get(`${orgId}|${courseId}`);
      purchased.add(`${orgId}|${courseId}`);
      return {
        key: `${o._id}-${i}`,
        courseId,
        title: it.title || oc?.courseId?.title || '—',
        unitPrice: it.unit_price, learners: it.learners, cost: it.line_total,
        recordId: oc?._id ? String(oc._id) : null,   // null: the course was since removed from the organization
        status: oc?.status || null,
      };
    });
    if (!courses.length) continue;
    groups.push({
      key: String(o._id),
      orderId: String(o._id),
      orderNo: String(o._id).slice(-8).toUpperCase(),
      orgId,
      orgName: o.organizer_id?.org_name || '—',
      total: o.credit_amount,
      paymentMode: o.payment_mode || '',
      date: o.purchase_date || o.createdAt,
      courses,
    });
  }
  for (const [key, oc] of orgCourseByKey) {
    if (purchased.has(key)) continue;
    groups.push({
      key: `oc-${oc._id}`,
      orderId: null, orderNo: null,
      orgId: idOf(oc.orgId),
      orgName: oc.orgId?.org_name || '—',
      total: null, paymentMode: '',
      date: oc.createdAt,
      courses: [{
        key: `oc-${oc._id}-0`,
        courseId: idOf(oc.courseId),
        title: oc.courseId?.title || '—',
        unitPrice: null, learners: null, cost: null,
        recordId: String(oc._id),
        status: oc.status,
      }],
    });
  }
  return groups.sort((a, b) => time(b.date) - time(a.date));
}

export default function OrgCourseAssignmentList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loaded, setLoaded]           = useState({ groups: [], seats: new Map() });
  const [loading, setLoading]         = useState(true);
  const [reloadKey, setReloadKey]     = useState(0);
  const [orgs, setOrgs]               = useState([]);
  const [search, setSearch]           = useState('');
  const [selectedOrg, setSelectedOrg] = useState(searchParams.get('orgId') ?? '');
  const [page, setPage]               = useState(1);
  const [hoveredKey, setHoveredKey]   = useState(null);
  const [confirm, setConfirm]         = useState({ show: false, id: null, label: '' });
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiServiceHandler('GET', `organization-course/list?t=${reloadKey}`).then(listOf).catch(() => []),
      apiServiceHandler('GET', `order/list?t=${reloadKey}`).then(listOf).catch(() => []),
      // Learner seats per organization + course: "orgId|courseId" → { purchased, used, available }.
      apiServiceHandler('GET', `course-seat/list-all?t=${reloadKey}`).then(listOf).catch(() => []),
    ]).then(([orgCourses, orders, seatList]) => {
      if (cancelled) return;
      setLoaded({
        groups: buildGroups(orgCourses, orders),
        seats: new Map(seatList.map(st => [`${st.orgId}|${st.courseId}`, st])),
      });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const reload = () => { setLoading(true); setReloadKey(n => n + 1); };

  useEffect(() => {
    apiServiceHandler('GET', 'organization/options')
      .then(res => setOrgs(listOf(res)))
      .catch(() => setOrgs([]));
  }, []);

  // Search: an order matches by organization or order no. (all its courses shown), or by
  // course name (only the matching courses shown).
  const term = search.trim().toLowerCase();
  const filtered = loaded.groups.reduce((acc, g) => {
    if (selectedOrg && g.orgId !== selectedOrg) return acc;
    const groupMatches = !term || [g.orgName, g.orderNo || ''].some(v => v.toLowerCase().includes(term));
    const courses = groupMatches ? g.courses : g.courses.filter(c => c.title.toLowerCase().includes(term));
    if (courses.length) acc.push({ ...g, courses });
    return acc;
  }, []);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  }
  const sortArrow = key => <SortArrow active={sortKey === key} dir={sortDir} />;
  const sortable = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };

  const dir = sortDir === 'asc' ? 1 : -1;
  const sorted = sortKey === 'orgName'
    ? [...filtered].sort((a, b) => dir * a.orgName.toLowerCase().localeCompare(b.orgName.toLowerCase()))
    : sortKey === 'date'
      ? [...filtered].sort((a, b) => dir * (time(a.date) - time(b.date)))
      : filtered;

  const total      = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const paged      = sorted.slice((page - 1) * LIMIT, page * LIMIT);
  const from       = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to         = Math.min(page * LIMIT, total);

  // One checkbox per order → "Delete Selected (N)" removes the order's courses from the
  // organization (the order itself stays in Orders).
  const recordsByGroup = new Map(paged.map(g => [g.key, [...new Set(g.courses.map(c => c.recordId).filter(Boolean))]]));
  const bulk = useBulkDelete({
    visibleIds: paged.filter(g => recordsByGroup.get(g.key).length).map(g => g.key),
    recordsOf: key => recordsByGroup.get(key) || [],
    deletePath: id => `organization-course/delete/${id}`,
    singular: 'order',
    plural: 'orders',
    title: 'Remove Courses of Selected Orders',
    confirmMessage: n => `Remove the courses of ${n} selected order${n !== 1 ? 's' : ''} from their organizations? This cannot be undone. The orders stay in Orders.`,
    doneMessage: n => `Courses of ${n} order${n !== 1 ? 's' : ''} removed.`,
    failMessage: n => `Some courses of ${n} order${n !== 1 ? 's' : ''} could not be removed. Please try again.`,
    onDeleted: reload,
  });

  function doDelete() {
    const { id } = confirm;
    setConfirm({ show: false, id: null, label: '' });
    apiServiceHandler('GET', `organization-course/delete/${id}`)
      .then(() => { toast.error('Course removed from the organization.'); reload(); })
      .catch(() => toast.warning('Delete failed.'));
  }

  function renderGroup(g, idx) {
    const span = g.courses.length;
    const ticked = bulk.isSelected(g.key);
    const canSelect = recordsByGroup.get(g.key).length > 0;
    const rowCls = [idx % 2 !== 0 ? s.stripeAlt : '', hoveredKey === g.key ? s.orgHover : '', ticked ? s.rowSelected : ''];

    return g.courses.map((c, ci) => {
      const seat = loaded.seats.get(`${g.orgId}|${c.courseId}`);
      return (
        <tr key={c.key}
          className={[...rowCls, ci > 0 ? s.subRow : ''].filter(Boolean).join(' ') || undefined}
          onMouseEnter={() => setHoveredKey(g.key)}
          onMouseLeave={() => setHoveredKey(null)}>
          {ci === 0 && (
            <>
              <td rowSpan={span} className={s.checkTd}>
                <input type="checkbox" aria-label={g.orderNo ? `Select order #${g.orderNo}` : `Select ${c.title} (${g.orgName})`}
                  checked={ticked} disabled={!canSelect} onChange={() => bulk.toggle(g.key)} />
              </td>
              <td rowSpan={span}>{(page - 1) * LIMIT + idx + 1}</td>
              <td rowSpan={span}><div className={s.cellMain}>{orDash(g.orgName)}</div></td>
              <td rowSpan={span} style={{ whiteSpace: 'nowrap' }}>
                {g.orderNo ? (
                  <>
                    <div className={s.cellMain}>#{g.orderNo}</div>
                    <div className={s.cellSubNote}>{formatPrice(g.total)} · {span} course{span !== 1 ? 's' : ''}</div>
                  </>
                ) : <span className={s.noPurchase}>No purchase</span>}
              </td>
            </>
          )}
          <td>
            {c.title}
            {!c.recordId && <div className={s.cellNote}>Removed from organization</div>}
            {c.status === 'inactive' && <div className={s.cellNote}>Inactive</div>}
          </td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{c.unitPrice != null ? formatPrice(c.unitPrice) : '—'}</td>
          <td style={{ textAlign: 'center' }}>{c.learners ?? '—'}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{c.cost != null ? formatPrice(c.cost) : '—'}</td>
          <td style={{ textAlign: 'center', fontWeight: 600, color: seat && seat.available === 0 ? '#b91c1c' : '#047857' }}
            title={seat ? `${seat.available} of ${seat.purchased} purchased learners available (all purchases of this course)` : undefined}>
            {seat ? seat.available : '—'}
          </td>
          <td style={{ textAlign: 'center' }}>{seat ? seat.used : '—'}</td>
          {ci === 0 && (
            <>
              <td rowSpan={span} style={{ textTransform: 'capitalize' }}>{g.paymentMode || '—'}</td>
              <td rowSpan={span} style={{ whiteSpace: 'nowrap' }}>{fmtDate(g.date)}</td>
            </>
          )}
          <td style={{ textAlign: 'center' }}>
            <div className={s.actions} style={{ justifyContent: 'center' }}>
              <button data-action="delete"
                className={s.btnDelete}
                title={c.recordId ? 'Remove this course from the organization' : 'Already removed from the organization'}
                aria-label={`Remove ${c.title} from ${g.orgName}`}
                disabled={!c.recordId}
                onClick={() => setConfirm({ show: true, id: c.recordId, label: c.title, org: g.orgName })}
              >
                <TrashIcon />
              </button>
            </div>
          </td>
          {ci === 0 && (
            <td rowSpan={span} style={{ textAlign: 'center' }}>
              <div className={s.actions} style={{ justifyContent: 'center' }}>
                <button data-action="edit"
                  className={s.btnEdit}
                  title={g.orderId ? `Edit order #${g.orderNo} (payment details)` : 'No order to edit'}
                  aria-label={g.orderId ? `Edit order #${g.orderNo}` : 'No order to edit'}
                  disabled={!g.orderId}
                  onClick={() => router.push(`${BASE_PATH}/${g.orderId}`)}
                >
                  <EditIcon />
                </button>
              </div>
            </td>
          )}
        </tr>
      );
    });
  }

  return (
    <SuperAdminShell activeSection="assign-course">
      <ConfirmModal
        show={confirm.show}
        title="Delete Assignment"
        message={`Remove "${confirm.label}" from ${confirm.org || 'this organization'}? This cannot be undone. Its purchases stay in Orders.`}
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setConfirm({ show: false, id: null, label: '' })}
      />
      <ConfirmModal {...bulk.confirmProps} />

      <div className={s.pageHeader} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '12px' }}>
        <div>
          <h1 className={s.pageTitle}>Course Assignments</h1>
          <p className={s.pageSubtitle}>Course purchases by organizations, grouped by order</p>
        </div>
        <button className={s.btnAdd} onClick={() => router.push(`${BASE_PATH}/add${selectedOrg ? `?orgId=${selectedOrg}` : ''}`)}>
          <PlusIcon />
          Add Assignment
        </button>
      </div>

      <div className={s.card}>
        <div className={s.filterBar}>
          <select
            className={s.orgSelect}
            value={selectedOrg}
            onChange={e => { setSelectedOrg(e.target.value); setPage(1); }}
          >
            <option value="">All Organizations</option>
            {orgs.map(o => (
              <option key={o._id} value={o._id}>{o.org_name}</option>
            ))}
          </select>
          <div className={s.searchWrap}>
            <SearchIcon />
            <input
              className={s.searchInput}
              type="text"
              placeholder="Search by organization, order no. or course…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.checkTh}>
                  <input type="checkbox" aria-label="Select all orders on this page" checked={bulk.allSelected} onChange={bulk.toggleAll} />
                </th>
                <th>#</th>
                <th style={sortable} onClick={() => toggleSort('orgName')}>Organization{sortArrow('orgName')}</th>
                <th style={{ whiteSpace: 'nowrap' }}>Order No.</th>
                <th>Course</th>
                <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Price / Learner</th>
                <th style={{ textAlign: 'center' }}>Learners</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }} title="Purchased learners of this course not yet used (all purchases)">Learner Available</th>
                <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }} title="Learners this course was assigned to (a removed learner's seat is not returned)">Learner Assigned</th>
                <th>Payment</th>
                <th style={sortable} onClick={() => toggleSort('date')}>Purchased On{sortArrow('date')}</th>
                <th style={{ textAlign: 'center' }}>Delete</th>
                <th style={{ textAlign: 'center' }}>Edit</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows columns={COLUMNS} />
              ) : paged.length === 0 ? (
                <tr className={s.emptyRow}><td colSpan={COLUMNS}><EmptyState>No course purchases found.</EmptyState></td></tr>
              ) : paged.flatMap(renderGroup)}
            </tbody>
          </table>
        </div>

        <div className={s.pagination}>
          <div className={s.footerLeft}>
            {bulk.selected.length > 0 && (
              <button type="button" data-bulk-action="delete" className={s.btnBulkDelete} onClick={bulk.askToDelete} disabled={bulk.deleting}>
                <TrashIcon />
                Delete Selected ({bulk.selected.length})
              </button>
            )}
            <span><ResultCount from={from} to={to} total={total} singular="order" plural="orders" /></span>
          </div>
          <div className={s.paginationBtns}>
            <button className={s.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            {pageItems(page, totalPages).map(p => typeof p !== 'number' ? <PageGap key={p} /> : (
              <button
                key={p}
                className={`${s.pageBtn}${page === p ? ` ${s.pageBtnActive}` : ''}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
            <button className={s.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        </div>
      </div>
    </SuperAdminShell>
  );
}
