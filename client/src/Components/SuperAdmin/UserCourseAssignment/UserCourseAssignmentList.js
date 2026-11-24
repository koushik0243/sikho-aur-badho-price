'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import apiServiceHandler from '../../../service/apiService';
import SuperAdminShell from '../SuperAdminShell';
import ConfirmModal from '../ConfirmModal';
import sPage from '../OrgCourseAssignment/OrgCourseAssignmentList.module.css';
import { withAdminKit } from '../AdminKit/AdminKit';
import { EmptyState, PageGap, PlusIcon, ResultCount, SkeletonRows, SortArrow, pageItems } from '../AdminKit/ListParts';
import useBulkDelete from '../AdminKit/useBulkDelete';
import { orDash } from '../../../lib/displayValue';
import { formatPrice } from '../../StoreOwner/Cart/cartFormat';

// Page styles + the shared super admin look.
const s = withAdminKit(sPage);

const BASE_PATH = '/superadmin/user-course-assignment';
const LIMIT = 50;

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

/** What the organization paid per learner for a course (from its orders, never today's price). */
function paidPriceText(price) {
  if (!price) return 'No purchase found for this course.';
  const last = `${formatPrice(price.last)} per learner`;
  return price.min === price.max ? last : `${last} (latest purchase; earlier purchases ${formatPrice(price.min)} – ${formatPrice(price.max)})`;
}

function fmtDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return '—';
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

const SEARCH_DELAY_MS = 300;

/** A learner row from GET /course-assignment/grouped, with ids as strings. */
function toGroup(g) {
  const orgId = String(g.orgId ?? '');
  const userId = String(g.userId ?? '');
  return {
    key: `${orgId}|${userId}`,
    orgId,
    userId,
    orgName: g.orgName || '—',
    learnerName: g.learnerName || '—',
    learnerEmail: g.learnerEmail || '',
    courses: (Array.isArray(g.courses) ? g.courses : []).map(c => ({
      recordId: String(c.recordId),
      courseId: String(c.courseId ?? ''),
      title: c.title || '—',
      assignedOn: c.assignedOn,
    })),
  };
}

export default function UserCourseAssignmentList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // One page of learners (organization + learner, with their courses) from the server.
  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const [query, setQuery] = useState(''); // the search box, applied after typing pauses
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedOrg, setSelectedOrg] = useState(searchParams.get('orgId') ?? '');
  const [page, setPage] = useState(1);
  const [hoveredKey, setHoveredKey] = useState(null);
  // Single delete: the course, the learner and what was paid per learner (loaded on open).
  const [confirm, setConfirm] = useState({ show: false, id: null, label: '' });

  // Opens the delete confirmation, then fills in what the organization paid per learner
  // for this course (from its orders — the price at purchase, not today's price).
  function askDelete(g, course) {
    setConfirm({ show: true, id: course.recordId, label: course.title, learner: g.learnerName, org: g.orgName, priceText: 'Loading…' });
    apiServiceHandler('GET', `course-seat/list?orgId=${g.orgId}`)
      .then(res => {
        const seat = (Array.isArray(res?.data) ? res.data : []).find(st => String(st.courseId) === course.courseId);
        return paidPriceText(seat?.price);
      })
      .catch(() => 'Could not load the purchase price.')
      .then(priceText => setConfirm(prev => (prev.id === course.recordId ? { ...prev, priceText } : prev)));
  }
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  const fetchRecords = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), t: String(Date.now()) });
    if (selectedOrg) params.set('orgId', selectedOrg);
    if (query) params.set('search', query);
    if (sortKey) { params.set('sort', sortKey); params.set('dir', sortDir); }
    apiServiceHandler('GET', `course-assignment/grouped?${params.toString()}`)
      .then(res => {
        const data = res?.data ?? {};
        setGroups((Array.isArray(data.groups) ? data.groups : []).map(toGroup));
        setTotal(Number(data.total) || 0);
        setAssignmentCount(Number(data.assignments) || 0);
      })
      .catch(() => { setGroups([]); setTotal(0); setAssignmentCount(0); toast.warning('Failed to load user course assignments.'); })
      .finally(() => setLoading(false));
  }, [page, selectedOrg, query, sortKey, sortDir]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Search runs on the server once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    apiServiceHandler('GET', 'organization/options')
      .then(res => setOrgs(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setOrgs([]));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const paged = groups;
  const from = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to = Math.min(page * LIMIT, total);

  // One checkbox per learner block (organization + learner) on this page → "Delete Selected (N)"
  // removes every course assignment shown for the ticked learners.
  const coursesByGroup = new Map(paged.map(g => [g.key, g.courses.map(c => String(c.recordId))]));
  const bulk = useBulkDelete({
    visibleIds: [...coursesByGroup.keys()],
    recordsOf: key => coursesByGroup.get(key) || [],
    deletePath: id => `course-assignment/delete/${id}`,
    singular: 'learner',
    plural: 'learners',
    confirmMessage: n => `Remove all course assignments of ${n} selected learner${n !== 1 ? 's' : ''}? This cannot be undone, and the learner seats these assignments used will NOT be returned to the organizations' available learners.`,
    onDeleted: fetchRecords,
  });

  function toggleSort(key) {
    setPage(1);
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }
  const sortArrow = key => <SortArrow active={sortKey === key} dir={sortDir} />;
  const sortable = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };

  function doDelete() {
    const { id } = confirm;
    setConfirm({ show: false, id: null, label: '' });
    apiServiceHandler('GET', `course-assignment/delete/${id}`)
      .then(() => { toast.error('Course removed from the learner.'); fetchRecords(); })
      .catch(() => toast.warning('Delete failed.'));
  }

  const addPath = selectedOrg ? `${BASE_PATH}/add?orgId=${selectedOrg}` : `${BASE_PATH}/add`;

  return (
    <SuperAdminShell activeSection="assign-user-course">
      <ConfirmModal
        show={confirm.show}
        title="Remove Course"
        message={(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span>Remove &quot;{confirm.label}&quot; from {confirm.learner || 'this learner'}? This cannot be undone.</span>
            <span style={{ padding: '8px 10px', borderRadius: 8, background: '#fff7ed', color: '#9a3412', lineHeight: 1.5 }}>
              The learner count will <strong>not</strong> be returned: the seat this learner used stays used,
              so {confirm.org || 'the organization'}&apos;s available learners for this course will not go up.
            </span>
            <span>Purchase cost for 1 learner: <strong>{confirm.priceText}</strong></span>
          </div>
        )}
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setConfirm({ show: false, id: null, label: '' })}
      />
      <ConfirmModal {...bulk.confirmProps} />

      <div className={s.pageHeader} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '12px' }}>
        <div>
          <h1 className={s.pageTitle}>User Course Assignments</h1>
          <p className={s.pageSubtitle}>Manage course assignments to learners of each organization</p>
        </div>
        <button className={s.btnAdd} onClick={() => router.push(addPath)}>
          <PlusIcon />
          Add Assignment
        </button>
      </div>

      <div className={s.card}>
        <div className={s.filterBar}>
          <select className={s.orgSelect} value={selectedOrg} onChange={e => { setSelectedOrg(e.target.value); setPage(1); }}>
            <option value="">All Organizations</option>
            {orgs.map(o => <option key={o._id} value={o._id}>{o.org_name}</option>)}
          </select>
          <div className={s.searchWrap}>
            <SearchIcon />
            <input
              className={s.searchInput}
              type="text"
              placeholder="Search by organization, learner or course name…"
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
                  <input type="checkbox" aria-label="Select all learners on this page" checked={bulk.allSelected} onChange={bulk.toggleAll} />
                </th>
                <th>#</th>
                <th style={sortable} onClick={() => toggleSort('orgName')}>Organization{sortArrow('orgName')}</th>
                <th style={sortable} onClick={() => toggleSort('learnerName')}>Learner{sortArrow('learnerName')}</th>
                <th>Course</th>
                <th style={sortable} onClick={() => toggleSort('assignedOn')}>Assigned On{sortArrow('assignedOn')}</th>
                <th style={{ textAlign: 'center' }}>Delete</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows columns={7} />
              ) : paged.length === 0 ? (
                <tr className={s.emptyRow}><td colSpan={7}><EmptyState>No assignments found.</EmptyState></td></tr>
              ) : (
                paged.flatMap((g, idx) => {
                  const serial = (page - 1) * LIMIT + idx + 1;
                  const groupTicked = bulk.isSelected(g.key);
                  const rowClass = [idx % 2 !== 0 ? s.stripeAlt : '', hoveredKey === g.key ? s.orgHover : '', groupTicked ? s.rowSelected : ''];
                  return g.courses.map((course, ci) => (
                    <tr
                      key={course.recordId}
                      className={[...rowClass, ci > 0 ? s.subRow : ''].filter(Boolean).join(' ') || undefined}
                      onMouseEnter={() => setHoveredKey(g.key)}
                      onMouseLeave={() => setHoveredKey(null)}
                    >
                      {ci === 0 && (
                        <>
                          <td rowSpan={g.courses.length} className={s.checkTd}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${g.learnerName} (${g.orgName})`}
                              checked={groupTicked}
                              onChange={() => bulk.toggle(g.key)}
                            />
                          </td>
                          <td rowSpan={g.courses.length}>{serial}</td>
                          <td rowSpan={g.courses.length}><div className={s.cellMain}>{orDash(g.orgName)}</div></td>
                          <td rowSpan={g.courses.length}>
                            <div className={s.cellMain}>{g.learnerName}</div>
                            {g.learnerEmail && <div style={{ fontSize: 12, color: '#6b7280' }}>{g.learnerEmail}</div>}
                          </td>
                        </>
                      )}
                      <td>{course.title}</td>
                      <td>{fmtDate(course.assignedOn)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className={s.actions} style={{ justifyContent: 'center' }}>
                          <button data-action="delete"
                            className={s.btnDelete}
                            title="Remove this course from the learner"
                            aria-label={`Remove ${course.title} from ${g.learnerName}`}
                            onClick={() => askDelete(g, course)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ));
                })
              )}
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
            <span><ResultCount from={from} to={to} total={total} singular="learner" plural="learners" />
              {assignmentCount > 0 && ` · ${assignmentCount} course assignment${assignmentCount !== 1 ? 's' : ''}`}</span>
          </div>
          <div className={s.paginationBtns}>
            <button className={s.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            {pageItems(page, totalPages).map(p => typeof p !== 'number' ? <PageGap key={p} /> : (
              <button key={p} className={`${s.pageBtn}${page === p ? ` ${s.pageBtnActive}` : ''}`} onClick={() => setPage(p)}>
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
