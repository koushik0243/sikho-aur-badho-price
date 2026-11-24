'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import apiServiceHandler from '../../../service/apiService';
import SuperAdminShell from '../SuperAdminShell';
import ConfirmModal from '../ConfirmModal';
import sPage from "./OrgUserAssignmentList.module.css";
import { withAdminKit } from '../AdminKit/AdminKit';
import { EmptyState, PageGap, ResultCount, SkeletonRows, SortArrow, pageItems } from '../AdminKit/ListParts';
import useBulkDelete from '../AdminKit/useBulkDelete';

// Page styles + the shared super admin look.
const s = withAdminKit(sPage);

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
const EyeIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
  </svg>
);
const LoginIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
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

// Users store their full name in `name`.
function displayName(u) {
  return u.name?.trim() || u.email || '—';
}

const assignedOn = (u) => u.updatedAt || u.createdAt;
const orgIdOf = (u) => String((typeof u.orgId === 'object' ? u.orgId?._id : u.orgId) ?? '');

// Organizations per page (each organization shows all of its users, like Course Assignments).
const LIMIT = 50;

// Every learner (employee) assigned to an organization — or to `orgFilter` only — in one
// request with just the columns shown here. The list is grouped by organization, so all of
// it is loaded and paged by organization here; server paging by user would split one
// organization's users across pages.
async function fetchAssignedUsers(orgFilter) {
  const params = new URLSearchParams({ orgId: orgFilter || 'any', t: String(Date.now()) });
  const res = await apiServiceHandler('GET', `user/admin/org-learners?${params.toString()}`);
  return (Array.isArray(res?.data) ? res.data : []).filter(u => orgIdOf(u));
}

function groupByOrg(users) {
  const map = new Map();
  for (const u of users) {
    const orgId = orgIdOf(u);
    if (!map.has(orgId)) {
      map.set(orgId, { orgId, orgName: u.orgId?.org_name || u.orgId?.name || '—', users: [] });
    }
    map.get(orgId).users.push(u);
  }
  return [...map.values()];
}

const compareText = (a, b) => String(a ?? '').toLowerCase().localeCompare(String(b ?? '').toLowerCase());

// Within an organization: by user name, email or assigned date. Organizations: by name.
const USER_SORTS = {
  name:       (a, b) => compareText(displayName(a), displayName(b)),
  email:      (a, b) => compareText(a.email, b.email),
  assignedOn: (a, b) => (new Date(assignedOn(a)).getTime() || 0) - (new Date(assignedOn(b)).getTime() || 0),
};

function filterAndSort(groups, { search, sortKey, sortDir }) {
  const term = search.trim().toLowerCase();
  const dir = sortDir === 'asc' ? 1 : -1;
  const matched = groups.reduce((acc, g) => {
    const orgMatches = term && g.orgName.toLowerCase().includes(term);
    const users = !term || orgMatches
      ? g.users
      : g.users.filter(u => displayName(u).toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term));
    if (users.length) acc.push({ ...g, users });
    return acc;
  }, []);
  const userSort = USER_SORTS[sortKey];
  const withUsersSorted = matched.map(g => ({
    ...g,
    users: [...g.users].sort(userSort ? (a, b) => dir * userSort(a, b) : USER_SORTS.name),
  }));
  const orgDir = sortKey === 'orgName' ? dir : 1;
  return withUsersSorted.sort((a, b) => orgDir * compareText(a.orgName, b.orgName));
}

export default function OrgUserAssignmentList() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const urlOrgId     = searchParams.get('orgId') ?? '';

  const [records, setRecords]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [page, setPage]               = useState(1);
  const [confirm, setConfirm]         = useState({ show: false, id: null, name: '', org: '' });
  const [orgs, setOrgs]               = useState([]);
  const [orgFilter, setOrgFilter]     = useState(urlOrgId);
  const [hoveredOrg, setHoveredOrg]   = useState(null);
  const [sortKey, setSortKey]         = useState('');
  const [sortDir, setSortDir]         = useState('asc');
  const [reloadKey, setReloadKey]     = useState(0);

  // A new view starts on page 1. (Ticked organizations that are no longer shown don't
  // count — useBulkDelete only acts on the visible ones.)
  function resetView() { setPage(1); }
  function goToPage(p) { setPage(p); }
  function changeSearch(value) { setSearch(value); resetView(); }
  function changeOrgFilter(value) { setOrgFilter(value); setLoading(true); resetView(); }
  // Reload after a removal (the effect below re-runs on reloadKey).
  function reload() { setLoading(true); setReloadKey(k => k + 1); }

  useEffect(() => {
    apiServiceHandler('GET', 'organization/options')
      .then(res => setOrgs(Array.isArray(res?.data) ? res.data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false; // a newer filter's request wins over a slower older one
    fetchAssignedUsers(orgFilter)
      .then(data => { if (!cancelled) setRecords(data); })
      .catch(() => {
        if (cancelled) return;
        setRecords([]);
        toast.warning('Could not load user assignments. Please refresh the page.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgFilter, reloadKey]);

  const groups     = filterAndSort(groupByOrg(records), { search, sortKey, sortDir });
  const totalOrgs  = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalOrgs / LIMIT));
  const paged      = groups.slice((page - 1) * LIMIT, page * LIMIT);
  const from       = totalOrgs === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to         = Math.min(page * LIMIT, totalOrgs);
  const totalUsers = groups.reduce((n, g) => n + g.users.length, 0);

  /* ── Delete, same as Course Assignments: one checkbox per organization on this page →
     "Delete Selected (N)" removes every user shown for the ticked organizations from
     them; each user row also has its own Delete button. Accounts are never deleted. ── */
  const removeFromOrg = id => apiServiceHandler('PUT', `user/admin/update/${id}`, { orgId: null });
  const orgKeyOf = (g, idx) => String(g.orgId || `row-${idx}`);
  const usersByOrg = new Map(paged.map((g, idx) => [orgKeyOf(g, idx), g.users.map(u => String(u._id))]));
  const bulk = useBulkDelete({
    visibleIds: [...usersByOrg.keys()],
    recordsOf: key => usersByOrg.get(key) || [],
    deleteRecord: removeFromOrg,
    singular: 'organization',
    plural: 'organizations',
    title: 'Remove Users of Selected Organizations',
    confirmLabel: 'Remove All',
    confirmMessage: n => `Remove all users of ${n} selected organization${n !== 1 ? 's' : ''} from ${n !== 1 ? 'those organizations' : 'that organization'}? User accounts will not be deleted.`,
    doneMessage: n => `Users removed from ${n} organization${n !== 1 ? 's' : ''}.`,
    failMessage: n => `Some users of ${n} organization${n !== 1 ? 's' : ''} could not be removed. Please try again.`,
    onDeleted: reload,
  });

  async function doRemove() {
    const { id } = confirm;
    setConfirm({ show: false, id: null, name: '', org: '' });
    try {
      await removeFromOrg(id);
      toast.error('User removed from organization.');
      reload();
    } catch {
      toast.warning('Failed to remove user.');
    }
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    resetView();
  }
  const sortArrow = key => <SortArrow active={sortKey === key} dir={sortDir} />;
  const sortableTh = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };

  function renderGroup(g, idx) {
    const orgKey    = orgKeyOf(g, idx);
    const orgTicked = bulk.isSelected(orgKey);
    const groupCls  = [idx % 2 !== 0 ? s.stripeAlt : '', hoveredOrg === orgKey ? s.orgHover : '', orgTicked ? s.rowSelected : ''];
    const span      = g.users.length;

    return g.users.map((u, ui) => (
      <tr
        key={u._id}
        className={[...groupCls, ui > 0 ? s.subRow : ''].filter(Boolean).join(' ') || undefined}
        onMouseEnter={() => setHoveredOrg(orgKey)}
        onMouseLeave={() => setHoveredOrg(null)}
      >
        {ui === 0 && (
          <>
            <td rowSpan={span} className={s.checkTd}>
              <input type="checkbox" aria-label={`Select ${g.orgName}`}
                checked={orgTicked} onChange={() => bulk.toggle(orgKey)} />
            </td>
            <td rowSpan={span}>{(page - 1) * LIMIT + idx + 1}</td>
            <td rowSpan={span} className={s.orgCell}>
              <span className={s.cellMain}>{g.orgName}</span>
              <span className={s.orgCount}>{span} user{span !== 1 ? 's' : ''}</span>
            </td>
          </>
        )}
        <td>{displayName(u)}</td>
        <td>{u.email || '—'}</td>
        <td>
          {u.status === 'active'
            ? <span className={s.badgeActive}>Active</span>
            : <span className={s.badgeInactive}>{u.status ?? 'Inactive'}</span>}
        </td>
        <td>{fmtDate(assignedOn(u))}</td>
        <td style={{ textAlign: 'center' }}>
          <div className={s.actions} style={{ justifyContent: 'center' }}>
            <button data-action="delete" className={s.btnRemove}
              title="Remove this user from the organization"
              aria-label={`Remove ${displayName(u)} from ${g.orgName}`}
              onClick={() => setConfirm({ show: true, id: u._id, name: displayName(u), org: g.orgName })}>
              <TrashIcon />
            </button>
          </div>
        </td>
        <td>
          <div className={s.actions}>
            <button data-action="view" className={s.btnView} title="View"
              onClick={() => router.push(`/superadmin/organization-user-assignment/${u._id}`)}>
              <EyeIcon />
            </button>
            <button data-action="edit" className={s.btnEdit} title="Edit assignment"
              onClick={() => router.push(`/superadmin/organization-user-assignment/edit/${u._id}`)}>
              <EditIcon />
            </button>
            {/* Log in as this learner — opens the learner dashboard in a new tab (this tab stays super admin) */}
            <button data-action="login" className={s.btnView}
              title={u.status === 'active' ? 'Log in' : 'Log in (account not active)'}
              aria-label={`Log in as ${displayName(u)} (opens a new tab)`}
              disabled={u.status !== 'active'}
              onClick={() => window.open(`/impersonate?userId=${u._id}`, '_blank', 'noopener')}>
              <LoginIcon />
            </button>
          </div>
        </td>
      </tr>
    ));
  }

  return (
    <SuperAdminShell activeSection="assign-user">
      <ConfirmModal
        show={confirm.show}
        title="Delete Assignment"
        message={`Remove "${confirm.name || 'this user'}" from ${confirm.org || 'this organization'}? The user account will not be deleted.`}
        confirmLabel="Delete"
        onConfirm={doRemove}
        onCancel={() => setConfirm({ show: false, id: null, name: '', org: '' })}
      />
      <ConfirmModal {...bulk.confirmProps} />

      <div className={s.pageHeader} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '12px' }}>
        <div>
          <h1 className={s.pageTitle}>User Assignments</h1>
          <p className={s.pageSubtitle}>Employees assigned to organizations</p>
        </div>
        <button className={s.btnAdd} onClick={() => router.push(`/superadmin/organization-user-assignment/add${orgFilter ? `?orgId=${orgFilter}` : ''}`)}>
          + Assign Users
        </button>
      </div>

      <div className={s.card}>
        <div className={s.filterBar}>
          <select
            className={s.orgFilterSelect}
            value={orgFilter}
            onChange={e => changeOrgFilter(e.target.value)}
            disabled={Boolean(urlOrgId)}
          >
            <option value="">All Organizations</option>
            {orgs.map(o => (
              <option key={o._id} value={o._id}>{o.org_name || o.name || '—'}</option>
            ))}
          </select>
          <div className={s.searchWrap}>
            <SearchIcon />
            <input
              className={s.searchInput}
              type="text"
              placeholder="Search by organization, name or email…"
              value={search}
              onChange={e => changeSearch(e.target.value)}
            />
          </div>
        </div>

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.checkTh}>
                  <input type="checkbox" aria-label="Select all organizations on this page" checked={bulk.allSelected} onChange={bulk.toggleAll} />
                </th>
                <th>#</th>
                <th style={sortableTh} onClick={() => toggleSort('orgName')}>Organization{sortArrow('orgName')}</th>
                <th style={sortableTh} onClick={() => toggleSort('name')}>User{sortArrow('name')}</th>
                <th style={sortableTh} onClick={() => toggleSort('email')}>Email{sortArrow('email')}</th>
                <th>Status</th>
                <th style={sortableTh} onClick={() => toggleSort('assignedOn')}>Assigned On{sortArrow('assignedOn')}</th>
                <th style={{ textAlign: 'center' }}>Delete</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows columns={9} />
              ) : groups.length === 0 ? (
                <tr className={s.emptyRow}><td colSpan={9}><EmptyState>No assigned users found.</EmptyState></td></tr>
              ) : paged.flatMap(renderGroup)}
            </tbody>
          </table>
        </div>

        <div className={s.tableFooter}>
          <div className={s.footerLeft}>
            {bulk.selected.length > 0 && (
              <button type="button" data-bulk-action="delete" className={s.btnBulkDelete} onClick={bulk.askToDelete} disabled={bulk.deleting}>
                <TrashIcon />
                Delete Selected ({bulk.selected.length})
              </button>
            )}
            <span className={s.footerInfo}>
              <ResultCount from={from} to={to} total={totalOrgs} singular="organization" plural="organizations" />
              {!loading && totalUsers > 0 && ` · ${totalUsers} user${totalUsers !== 1 ? 's' : ''}`}
            </span>
          </div>
          <div className={s.pagination}>
            <button className={s.pgBtn} disabled={page <= 1} onClick={() => goToPage(page - 1)}>
              Previous
            </button>
            {pageItems(page, totalPages).map(p => typeof p !== 'number' ? <PageGap key={p} /> : (
              <button
                key={p}
                className={`${s.pgBtn}${page === p ? ` ${s.pgBtnActive}` : ''}`}
                onClick={() => goToPage(p)}
              >
                {p}
              </button>
            ))}
            <button className={s.pgBtn} disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
              Next
            </button>
          </div>
        </div>
      </div>
    </SuperAdminShell>
  );
}
