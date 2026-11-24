'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import { toast } from 'sonner';
import { selectUser } from '../../../redux/slices/authSlice';
import apiServiceHandler from '../../../service/apiService';
import { isCourseDeleted } from '../../../lib/courseAvailability';
import pageStyles from "./AssignCourses.module.css";
import { withFormKit } from '../PageKit/PageKit';

// Page styles + the shared store owner form look.
const s = withFormKit(pageStyles);

// ── Icons ────────────────────────────────────────────────────────
const Icon = {
  trash:    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>,
  email:    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" /><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" /></svg>,
  search:   <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>,
};

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 350;

const idOf = (v) => String(v?._id ?? v ?? '');
const learnersAvailableText = (n) => (n > 0 ? `${n} available` : 'No learners available');

/** Learners still available per course: { [courseId]: number } (purchased − used). */
async function loadAvailableLearners() {
  const res = await apiServiceHandler('GET', `course-seat/list?t=${Date.now()}`);
  const seats = Array.isArray(res?.data) ? res.data : [];
  return Object.fromEntries(seats.map(st => [String(st.courseId), Number(st.available) || 0]));
}

/** "A, B and C" */
function joinTitles(titles) {
  if (titles.length <= 1) return titles[0] || '';
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

export default function AssignCoursesPage() {
  const user = useSelector(selectUser);

  const [learners,        setLearners]        = useState([]); // id + name + email for the picker
  const [courses,         setCourses]         = useState([]);
  const [available,       setAvailable]       = useState({}); // learners left per course
  const [selectedUserId,   setSelectedUserId]   = useState('');
  const [selectedCourseIds,setSelectedCourseIds]= useState(new Set());
  const [courseDropdownOpen, setCourseDropdownOpen] = useState(false);
  const [courseSearch,    setCourseSearch]     = useState('');
  const courseDropdownRef = useRef(null);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [orgId,           setOrgId]           = useState(null);
  const [confirmItem,     setConfirmItem]     = useState(null); // { recordId, title, learnerName }
  const [notifyMethod,    setNotifyMethod]    = useState('email');
  // Current Assignments: one page of learners (with their courses) from the server.
  const [groups,          setGroups]          = useState([]);
  const [groupTotal,      setGroupTotal]      = useState(0);
  const [tableLoading,    setTableLoading]    = useState(true);
  const [assignPage,      setAssignPage]      = useState(1);
  const [checked,         setChecked]         = useState(new Set());
  const [confirmBulk,     setConfirmBulk]     = useState(false);
  const [bulkDeleting,    setBulkDeleting]    = useState(false);
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [debouncedAssignmentSearch, setDebouncedAssignmentSearch] = useState('');
  const tableSeq = useRef(0); // only the latest table request may update it

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedAssignmentSearch(assignmentSearch.trim());
      setAssignPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [assignmentSearch]);

  function getTokenUserId() {
    if (typeof window === 'undefined') return null;
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload._id || null;
    } catch { return null; }
  }

  const loadAssignments = useCallback(async () => {
    if (!orgId) return;
    const seq = ++tableSeq.current;
    setTableLoading(true);
    try {
      const params = new URLSearchParams({ page: String(assignPage), limit: String(PAGE_SIZE), sort: 'learnerName', t: String(Date.now()) });
      if (debouncedAssignmentSearch) params.set('search', debouncedAssignmentSearch);
      const res = await apiServiceHandler('GET', `course-assignment/grouped?${params.toString()}`);
      if (seq !== tableSeq.current) return;
      setGroups(Array.isArray(res?.data?.groups) ? res.data.groups : []);
      setGroupTotal(Number(res?.data?.total) || 0);
    } catch {
      if (seq !== tableSeq.current) return;
      setGroups([]);
      setGroupTotal(0);
      toast.warning('Failed to load the current assignments.');
    } finally {
      if (seq === tableSeq.current) setTableLoading(false);
    }
  }, [orgId, assignPage, debouncedAssignmentSearch]);

  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  const refreshAvailable = useCallback(async () => {
    const latest = await loadAvailableLearners();
    setAvailable(latest);
    // A course that ran out of learners can't stay selected.
    setSelectedCourseIds(prev => {
      const next = new Set([...prev].filter(cid => (latest[cid] || 0) >= 1));
      return next.size === prev.size ? prev : next;
    });
    return latest;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let effectiveOrgId = user?.orgId ? idOf(user.orgId) : null;
      if (!effectiveOrgId) {
        const uid = user?._id || getTokenUserId();
        if (uid) {
          const r = await apiServiceHandler('GET', `user/admin/edit/${uid}`);
          const rec = r?.data ?? r;
          if (rec?.orgId) effectiveOrgId = idOf(rec.orgId);
        }
      }
      if (!effectiveOrgId) { setLoading(false); setTableLoading(false); return; }
      setOrgId(effectiveOrgId);

      const [learnersRes, coursesRes] = await Promise.all([
        apiServiceHandler('GET', `user/admin/org-learners/options?t=${Date.now()}`),
        apiServiceHandler('GET', `organization-course/list?orgId=${effectiveOrgId}&status=active`),
        refreshAvailable(),
      ]);

      setLearners(Array.isArray(learnersRes?.data) ? learnersRes.data : []);
      const courseList = Array.isArray(coursesRes?.data) ? coursesRes.data
                       : Array.isArray(coursesRes) ? coursesRes : [];
      // A course the super admin deleted can't be assigned any more.
      setCourses(courseList.filter(item => !isCourseDeleted(item.courseId)));
    } catch {
      toast.warning('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [user?._id, user?.orgId, refreshAvailable]);

  useEffect(() => { loadData(); }, [loadData]);

  // Close the course dropdown on outside click
  useEffect(() => {
    function handleOutsideClick(e) {
      if (courseDropdownRef.current && !courseDropdownRef.current.contains(e.target)) {
        setCourseDropdownOpen(false);
        setCourseSearch('');
      }
    }
    if (courseDropdownOpen) document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [courseDropdownOpen]);

  const availableFor = (courseId) => available[courseId] || 0;

  function toggleCourseSelection(courseId) {
    if (availableFor(courseId) < 1) return; // no learner left for this course
    setSelectedCourseIds(prev => {
      const next = new Set(prev);
      next.has(courseId) ? next.delete(courseId) : next.add(courseId);
      return next;
    });
  }

  const courseTitle = (courseId) => {
    const item = courses.find(c => idOf(c.courseId) === courseId);
    return item?.courseId?.title || 'this course';
  };

  const filteredCourses = courseSearch
    ? courses.filter(c => {
        const title = (c.courseId?.title || '').toLowerCase();
        return title.includes(courseSearch.toLowerCase());
      })
    : courses;

  /** Assigns each course; returns { done: [courseId], failed: [{ courseId, message }] }. */
  async function assignEach(courseIds) {
    const results = await Promise.allSettled(courseIds.map(async (courseId) => {
      await apiServiceHandler('POST', 'course-assignment/create', {
        organizationId: orgId,
        userId:         selectedUserId,
        courseId,
      });
      // Log credit usage
      await apiServiceHandler('POST', 'credit-used/create', {
        orgId,
        learnerId: selectedUserId,
        courseId,
        status:   'active',
      }).catch(() => {}); // the course is assigned either way
    }));
    const done = [], failed = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') done.push(courseIds[i]);
      else failed.push({ courseId: courseIds[i], message: r.reason?.message || 'Could not assign.' });
    });
    return { done, failed };
  }

  async function handleAssign() {
    if (!selectedUserId)              { toast.warning('Please select a learner');       return; }
    if (selectedCourseIds.size === 0) { toast.warning('Please select at least one course'); return; }

    const learnerName = learners.find(l => l._id === selectedUserId)?.name || 'This learner';
    const chosen = [...selectedCourseIds];
    setSaving(true);
    try {
      // First check, on the server, which of these courses the learner already has.
      const check = await apiServiceHandler('GET', `course-assignment/check?userId=${selectedUserId}&courseIds=${chosen.join(',')}&t=${Date.now()}`);
      const alreadyAssigned = new Set((check?.data?.assigned || []).map(String));
      const already = chosen.filter(cid => alreadyAssigned.has(cid));
      const toAssign = chosen.filter(cid => !alreadyAssigned.has(cid));

      if (already.length) {
        toast.warning(`${learnerName} is already assigned ${joinTitles(already.map(courseTitle))}.`);
      }
      if (toAssign.length === 0) return;

      const { done, failed } = await assignEach(toAssign);
      if (done.length) {
        toast.success(`${joinTitles(done.map(courseTitle))} assigned to ${learnerName} — email notification sent.`);
      }
      failed.forEach(f => toast.warning(`${courseTitle(f.courseId)}: ${f.message}`));

      if (done.length) {
        setSelectedUserId('');
        setSelectedCourseIds(new Set());
      }
      await Promise.all([refreshAvailable().catch(() => {}), loadAssignments()]);
    } catch (err) {
      toast.warning(err?.message || 'Failed to assign course(s)');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(item) {
    setConfirmItem(null);
    try {
      await apiServiceHandler('GET', `course-assignment/delete/${item.recordId}`);
      setChecked(prev => { const next = new Set(prev); next.delete(item.recordId); return next; });
      toast.error('Assignment removed');
      await loadAssignments();
    } catch {
      toast.warning('Failed to remove assignment');
    }
  }

  async function handleBulkRemove() {
    const ids = [...checked];
    setBulkDeleting(true);
    setConfirmBulk(false);
    try {
      for (const id of ids) {
        await apiServiceHandler('GET', `course-assignment/delete/${id}`);
      }
      setChecked(new Set());
      toast.error(`${ids.length} assignment${ids.length > 1 ? 's' : ''} removed`);
    } catch {
      toast.warning('Failed to remove some assignments');
    } finally {
      setBulkDeleting(false);
      if (assignPage !== 1) setAssignPage(1); else await loadAssignments();
    }
  }

  const recordIdsOf = (group) => (group.courses || []).map(c => String(c.recordId));

  function toggleLearnerCheck(group) {
    const ids = recordIdsOf(group);
    setChecked(prev => {
      const next = new Set(prev);
      const allOn = ids.every(id => next.has(id));
      allOn ? ids.forEach(id => next.delete(id)) : ids.forEach(id => next.add(id));
      return next;
    });
  }

  function toggleAll() {
    const ids = groups.flatMap(recordIdsOf);
    setChecked(prev => {
      const next = new Set(prev);
      const allOn = ids.every(id => next.has(id));
      allOn ? ids.forEach(id => next.delete(id)) : ids.forEach(id => next.add(id));
      return next;
    });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  const totalLearnerPages  = Math.max(1, Math.ceil(groupTotal / PAGE_SIZE));
  const pagedLearnerGroups = groups;
  const idsOnPage          = groups.flatMap(recordIdsOf);
  const allPageChecked     = idsOnPage.length > 0 && idsOnPage.every(id => checked.has(id));

  return (
    <>
      {/* ── Assign form card ── */}
      <div className={s.formCard}>
        <div className={s.cardHead}><h2 className={s.cardTitle}>Assign Courses To Learners</h2></div>
        <div className={s.cardBody}>
        <div className={s.formRow}>
          {/* Assignee */}
          <div className={`${s.formGroup} ${s.formGroupWide}`}>
            <label className={s.formLabel}>Assignee</label>
            <div className={s.selectWrapper}>
              <select
                className={s.formSelect}
                value={selectedUserId}
                onChange={e => setSelectedUserId(e.target.value)}
                disabled={loading}
              >
                <option value="">
                  {loading ? 'Loading learners…' : learners.length === 0 ? 'No learners found' : 'Select Learner'}
                </option>
                {learners.map(l => (
                  <option key={l._id} value={l._id}>
                    {l.name || l.email}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Select Course(s) — multi-select */}
          <div className={`${s.formGroup} ${s.formGroupWide}`}>
            <label className={s.formLabel}>Select Course(s)</label>
            <div className={s.multiSelectWrapper} ref={courseDropdownRef}>
              <button
                type="button"
                className={s.multiSelectButton}
                onClick={() => setCourseDropdownOpen(o => !o)}
                disabled={loading || courses.length === 0}
              >
                <span className={s.multiSelectButtonText}>
                  {loading
                    ? 'Loading courses…'
                    : courses.length === 0
                      ? 'No courses available'
                      : selectedCourseIds.size === 0
                        ? 'Select Course(s)'
                        : `${selectedCourseIds.size} course${selectedCourseIds.size > 1 ? 's' : ''} selected`}
                </span>
                {/* Same chevron as every other dropdown (globals.css) */}
                <svg className={s.multiSelectChevron} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>

              {courseDropdownOpen && (
                <div className={s.multiSelectPanel}>
                  <div className={s.multiSelectSearchWrap}>
                    {Icon.search}
                    <input
                      type="text"
                      className={s.multiSelectSearchInput}
                      placeholder="Search courses…"
                      value={courseSearch}
                      onChange={e => setCourseSearch(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                  </div>
                  {filteredCourses.length === 0 ? (
                    <div className={s.multiSelectEmpty}>No courses match your search.</div>
                  ) : filteredCourses.map(c => {
                    const courseId  = idOf(c.courseId);
                    const title     = c.courseId?.title || courseId;
                    const learnersLeft = availableFor(courseId);
                    const enabled   = learnersLeft >= 1;
                    return (
                      <label
                        key={courseId}
                        className={`${s.multiSelectOption} ${enabled ? '' : s.multiSelectOptionDisabled}`}
                        title={enabled ? undefined : 'No learners available for this course. Buy more learners to assign it.'}
                      >
                        <input
                          type="checkbox"
                          className={s.checkInput}
                          checked={enabled && selectedCourseIds.has(courseId)}
                          disabled={!enabled}
                          onChange={() => toggleCourseSelection(courseId)}
                        />
                        <span className={s.multiSelectOptionText}>{title}</span>
                        <span className={`${s.multiSelectBadge} ${enabled ? '' : s.multiSelectBadgeNone}`}>{learnersAvailableText(learnersLeft)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Notify */}
          <div className={s.formGroup}>
            <label className={s.formLabel}>Notify Learners Via</label>
            <div className={s.notifyToggle}>
              <button
                className={`${s.notifyOption} ${notifyMethod === 'email' ? s.notifyOptionActive : ''}`}
                type="button"
                onClick={() => setNotifyMethod('email')}
              >
                <span className={s.notifyIcon}>{Icon.email}</span>
                Email
              </button>
            </div>
          </div>
        </div>

        {/* Assign button */}
        <div className={s.assignBtnWrap}>
          <button
            className={s.btnAssign}
            onClick={handleAssign}
            disabled={saving || loading}
          >
            {saving
              ? 'Assigning…'
              : selectedCourseIds.size > 1 ? `Assign ${selectedCourseIds.size} Courses` : 'Assign Course'}
          </button>
        </div>
        </div>
      </div>

      {/* ── Current Assignments ── */}
      <div className={s.tableCard}>
        <div className={s.cardHead}>
          <h3 className={s.cardTitle}>Current Assignments</h3>
          <div className={s.searchWrap}>
            {Icon.search}
            <input
              type="text"
              className={s.searchInput}
              placeholder="Search by learner or course…"
              value={assignmentSearch}
              onChange={e => setAssignmentSearch(e.target.value)}
            />
          </div>
        </div>
        <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.thCheck}>
                <input type="checkbox" className={s.checkInput} checked={allPageChecked} onChange={toggleAll} />
              </th>
              <th className={s.th}>#</th>
              <th className={s.th}>Learner</th>
              <th className={s.th}>Course</th>
              <th className={s.th}>Assigned On</th>
              <th className={s.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading || tableLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className={s.tr}>
                  <td className={s.td} colSpan={6}><div className={s.skeletonRow} /></td>
                </tr>
              ))
            ) : groups.length === 0 ? (
              <tr className={s.tr}>
                <td className={s.td} colSpan={6} style={{ textAlign: 'center', color: '#9aadad', padding: '24px 0' }}>
                  {debouncedAssignmentSearch ? 'No assignments match your search.' : 'No assignments yet'}
                </td>
              </tr>
            ) : pagedLearnerGroups.flatMap((group, gi) => {
              const groupIds = recordIdsOf(group);
              const isGroupChecked = groupIds.every(id => checked.has(id));
              const serial = (assignPage - 1) * PAGE_SIZE + gi + 1;
              const stripe = gi % 2 !== 0 ? s.trAlt : '';

              const learnerName = group.learnerName && group.learnerName !== '—' ? group.learnerName : (group.learnerEmail || '—');
              return group.courses.map((a, ci) => (
                <tr
                  key={a.recordId}
                  className={`${stripe} ${ci > 0 ? s.subRow : ''} ${isGroupChecked ? s.trChecked : ''}`}
                >
                  {ci === 0 && (
                    <>
                      <td className={s.tdCheck} rowSpan={group.courses.length} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className={s.checkInput} checked={isGroupChecked} onChange={() => toggleLearnerCheck(group)} />
                      </td>
                      <td className={s.td} rowSpan={group.courses.length}>{serial}</td>
                      <td className={s.td} rowSpan={group.courses.length}>
                        <div className={s.cellMain}>{learnerName}</div>
                      </td>
                    </>
                  )}
                  <td className={s.td}>{a.title || '—'}</td>
                  <td className={s.td}>{formatDate(a.assignedOn)}</td>
                  <td className={s.tdAction}>
                    <button data-action="delete" className={s.trashBtn} title="Remove assignment" onClick={() => setConfirmItem({ recordId: String(a.recordId), title: a.title, learnerName })}>
                      {Icon.trash}
                    </button>
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
        </div>
        {!loading && (() => {
          const totalPages = totalLearnerPages;
          const from = groupTotal === 0 ? 0 : (assignPage - 1) * PAGE_SIZE + 1;
          const to   = Math.min(assignPage * PAGE_SIZE, groupTotal);
          return (
            <div className={s.pagination}>
              <div className={s.paginationLeft}>
                {checked.size > 0 && (
                  <button
                    data-bulk-action="delete"
                    className={s.btnBulkDelete}
                    onClick={() => setConfirmBulk(true)}
                    disabled={bulkDeleting}
                  >
                    Delete Selected ({checked.size})
                  </button>
                )}
                <span className={s.paginationInfo}>Showing {from}–{to} of {groupTotal} learner{groupTotal !== 1 ? 's' : ''}</span>
              </div>
              <div className={s.paginationBtns}>
                <button className={s.pageBtn} onClick={() => setAssignPage(p => Math.max(1, p - 1))} disabled={assignPage <= 1}>Previous</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} className={`${s.pageBtn} ${p === assignPage ? s.pageBtnActive : ''}`} onClick={() => setAssignPage(p)}>{p}</button>
                ))}
                <button className={s.pageBtn} onClick={() => setAssignPage(p => Math.min(totalPages, p + 1))} disabled={assignPage >= totalPages}>Next</button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Bulk delete confirm dialog ── */}
      {confirmBulk && (
        <div className={s.modalOverlay} onClick={() => setConfirmBulk(false)}>
          <div className={s.modalBox} onClick={e => e.stopPropagation()}>
            <div className={s.modalTitle}>Remove {checked.size} Assignment{checked.size > 1 ? 's' : ''}</div>
            <p className={s.modalBody}>
              Are you sure you want to remove {checked.size} selected assignment{checked.size > 1 ? 's' : ''}?
              This action cannot be undone.
            </p>
            <div className={s.modalActions}>
              <button className={s.modalBtnCancel} onClick={() => setConfirmBulk(false)} disabled={bulkDeleting}>
                Cancel
              </button>
              <button className={s.modalBtnDelete} onClick={handleBulkRemove} disabled={bulkDeleting}>
                {bulkDeleting ? 'Removing…' : `Remove (${checked.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm delete dialog ── */}
      {confirmItem && (
        <div className={s.modalOverlay} onClick={() => setConfirmItem(null)}>
          <div className={s.modalBox} onClick={e => e.stopPropagation()}>
            <div className={s.modalTitle}>Remove Assignment</div>
            <p className={s.modalBody}>
              Remove <strong>{confirmItem.title || 'this course'}</strong> from{' '}
              <strong>{confirmItem.learnerName || 'this learner'}</strong>?
              <br/>This action cannot be undone.
            </p>
            <div className={s.modalActions}>
              <button className={s.modalBtnCancel} onClick={() => setConfirmItem(null)}>Cancel</button>
              <button className={s.modalBtnDelete} onClick={() => handleRemove(confirmItem)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
