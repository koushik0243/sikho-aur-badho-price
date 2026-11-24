'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import apiServiceHandler from '../../../service/apiService';
import { isCourseDeleted } from '../../../lib/courseAvailability';
import SuperAdminShell from '../SuperAdminShell';
import fPage from '../OrgCourseAssignment/AddOrgCourseAssignment.module.css';
import sPage from './UserCourseAssignment.module.css';
import { withAdminKit } from '../AdminKit/AdminKit';

// Page styles + the shared super admin look.
const f = withAdminKit(fPage);
const s = withAdminKit(sPage);

const BASE_PATH = '/superadmin/user-course-assignment';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7" />
  </svg>
);
const RemoveIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
  </svg>
);

const listOf = res => (Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
const idOf = v => String(v?._id ?? v ?? '');

let rowSeq = 0;
const newRow = (userId = '') => ({ key: ++rowSeq, userId, courseIds: new Set() });

export default function AddUserCourseAssignment() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlOrgId = searchParams.get('orgId') ?? '';
  const urlUserId = searchParams.get('userId') ?? '';

  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(urlOrgId);
  const [learners, setLearners] = useState([]);
  const [courses, setCourses] = useState([]);          // the organization's courses: [{ id, title }]
  const [assignedByUser, setAssignedByUser] = useState(new Map()); // userId → Set(courseId)
  // Learner seats per course: { purchased, used, available } (server/course_seats).
  const [seats, setSeats] = useState(new Map());
  const [loadingOrg, setLoadingOrg] = useState(!!urlOrgId);
  const [rows, setRows] = useState(() => [newRow()]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Back, Cancel and Save always return to the full list, not one organization.
  const backPath = BASE_PATH;

  // Old edit links (add?orgId=…&userId=…) open the learner's edit page.
  useEffect(() => {
    if (urlOrgId && urlUserId) router.replace(`${BASE_PATH}/${urlOrgId}/${urlUserId}`);
  }, [router, urlOrgId, urlUserId]);

  useEffect(() => {
    apiServiceHandler('GET', 'organization/options')
      .then(res => setOrgs(listOf(res)))
      .catch(() => toast.warning('Failed to load organizations.'));
  }, []);

  // Organization chosen → its learners, its courses and what each learner already has.
  useEffect(() => {
    if (!orgId) return undefined;
    let cancelled = false;
    Promise.all([
      apiServiceHandler('GET', `user/admin/list?orgId=${orgId}&user_type=employee&orgRole=employee`),
      apiServiceHandler('GET', `organization-course/list?orgId=${orgId}&status=active`),
      apiServiceHandler('GET', `course-assignment/list?organizationId=${orgId}&view=slim&t=${Date.now()}`),
      apiServiceHandler('GET', `course-seat/list?orgId=${orgId}&t=${Date.now()}`),
    ]).then(([learnerRes, courseRes, assignRes, seatRes]) => {
      if (cancelled) return;
      const learnerList = listOf(learnerRes);
      const seen = new Set();
      const courseList = listOf(courseRes)
        .filter(oc => !isCourseDeleted(oc.courseId)) // a deleted course can't be assigned
        .map(oc => ({ id: idOf(oc.courseId), title: oc.courseId?.title || '—' }))
        .filter(c => c.id && !seen.has(c.id) && seen.add(c.id));
      const assigned = new Map();
      for (const a of listOf(assignRes)) {
        const uid = idOf(a.userId);
        assigned.set(uid, new Set([...(assigned.get(uid) || []), idOf(a.courseId)]));
      }
      setLearners(learnerList);
      setCourses(courseList);
      setAssignedByUser(assigned);
      setSeats(new Map(listOf(seatRes).map(st => [String(st.courseId), st])));
      setRows([newRow()]);
    }).catch(() => {
      if (!cancelled) toast.warning('Failed to load the organization’s learners and courses.');
    }).finally(() => {
      if (!cancelled) setLoadingOrg(false);
    });
    return () => { cancelled = true; };
  }, [orgId]);

  function changeOrganization(nextOrgId) {
    setOrgId(nextOrgId);
    setErrors({});
    setLearners([]);
    setCourses([]);
    setAssignedByUser(new Map());
    setSeats(new Map());
    setRows([newRow()]);
    setLoadingOrg(!!nextOrgId);
  }

  // Seats left for a course after everything ticked on this page (all learner rows).
  // Assigning a course uses one seat per learner; with none left the course is disabled.
  const tickedCount = courseId => rows.reduce((n, r) => n + (r.courseIds.has(courseId) ? 1 : 0), 0);
  const seatsLeft = courseId => (seats.get(courseId)?.available || 0) - tickedCount(courseId);

  function updateRow(key, change) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...change(r) } : r)));
    setErrors(prev => ({ ...prev, [key]: undefined, submit: undefined }));
  }

  const chooseLearner = (key, userId) => updateRow(key, () => ({ userId, courseIds: new Set() }));
  const toggleCourse = (key, courseId) => updateRow(key, r => {
    const next = new Set(r.courseIds);
    if (next.has(courseId)) next.delete(courseId); else next.add(courseId);
    return { courseIds: next };
  });
  const addRow = () => setRows(prev => [...prev, newRow()]);
  const removeRow = key => setRows(prev => (prev.length > 1 ? prev.filter(r => r.key !== key) : prev));

  // Each learner can appear in only one row.
  const learnerOptionsFor = row => {
    const takenElsewhere = new Set(rows.filter(r => r.key !== row.key && r.userId).map(r => r.userId));
    return learners.filter(l => !takenElsewhere.has(String(l._id)));
  };
  const allLearnersChosen = learners.length > 0 && rows.length >= learners.length;

  function validate() {
    const e = {};
    if (!orgId) e.orgId = 'Please select an organization.';
    rows.forEach(r => {
      if (!r.userId) e[r.key] = 'Select a learner, or remove this row.';
      else if (r.courseIds.size === 0) e[r.key] = 'Select at least one course for this learner.';
    });
    const overbooked = courses.filter(c => seatsLeft(c.id) < 0).map(c => c.title);
    if (overbooked.length) e.submit = `Not enough learners available for: ${overbooked.join(', ')}.`;
    return e;
  }

  async function handleSubmit() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmitting(true);
    let assignedCount = 0;
    const failures = [];
    const courseTitle = id => courses.find(c => c.id === id)?.title || 'a course';
    const learnerName = id => learners.find(l => String(l._id) === id)?.name || 'a learner';
    try {
      // One at a time: each assignment uses a learner seat, and the server checks the seats left.
      for (const row of rows) {
        const already = assignedByUser.get(row.userId) || new Set();
        for (const courseId of [...row.courseIds].filter(cid => !already.has(cid))) {
          try {
            // Same steps as the store owner's Assign Courses page: the assignment
            // (which emails the learner), then the credit-usage record.
            await apiServiceHandler('POST', 'course-assignment/create', { organizationId: orgId, userId: row.userId, courseId });
            await apiServiceHandler('POST', 'credit-used/create', { orgId, learnerId: row.userId, courseId, status: 'active' });
            assignedCount++;
          } catch (err) {
            failures.push(`${courseTitle(courseId)} for ${learnerName(row.userId)}: ${err?.message || 'failed'}`);
          }
        }
      }
      if (failures.length) {
        toast.warning(`${assignedCount} assigned. Not assigned — ${failures.join(' · ')}`);
        router.push(backPath);
        return;
      }
      toast.success(`${assignedCount} course${assignedCount === 1 ? '' : 's'} assigned to ${rows.length} learner${rows.length === 1 ? '' : 's'} — email notification sent.`);
      router.push(backPath);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SuperAdminShell activeSection="assign-user-course">
      <button className={f.backBtn} onClick={() => router.push(backPath)}>
        <BackIcon /> Back
      </button>
      <h1 className={f.pageTitle}>Assign User Course</h1>
      <p className={f.pageSubtitle}>Assign an organization’s courses to its learners</p>

      <div className={f.formCard} style={{ maxWidth: 'none', width: '100%' }}>
        <div className={f.formGroup}>
          <label htmlFor="ucaOrg">Organization *</label>
          <select id="ucaOrg" value={orgId} onChange={e => changeOrganization(e.target.value)} disabled={submitting}>
            <option value="">— Select organization —</option>
            {orgs.map(o => <option key={o._id} value={o._id}>{o.org_name}</option>)}
          </select>
          {errors.orgId && <p className={f.errorMsg}>{errors.orgId}</p>}
        </div>

        {orgId && (loadingOrg ? (
          <p className={f.emptyHint}>Loading learners and courses…</p>
        ) : learners.length === 0 ? (
          <p className={f.emptyHint}>This organization has no learners yet. Assign users to it first.</p>
        ) : (
          <div className={s.rowsBlock}>
            {rows.map((row, idx) => {
              const assigned = assignedByUser.get(row.userId) || new Set();
              return (
              <div key={row.key} className={s.learnerRow}>
                <div className={s.learnerHead}>
                  <div className={s.learnerField}>
                    <label htmlFor={`ucaLearner${row.key}`}>Learner {rows.length > 1 ? idx + 1 : ''} *</label>
                    <select
                      id={`ucaLearner${row.key}`}
                      className={`${s.learnerSelect}${errors[row.key] && !row.userId ? ` ${s.inputError}` : ''}`}
                      value={row.userId}
                      onChange={e => chooseLearner(row.key, e.target.value)}
                      disabled={submitting}
                    >
                      <option value="">— Select learner —</option>
                      {learnerOptionsFor(row).map(l => (
                        <option key={l._id} value={l._id}>
                          {l.name || l.email}{l.email && l.name ? ` (${l.email})` : ''}{l.status && l.status !== 'active' ? ' — inactive' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className={s.removeRowBtn}
                    title="Remove this learner"
                    aria-label={`Remove learner row ${idx + 1}`}
                    onClick={() => removeRow(row.key)}
                    disabled={rows.length === 1 || submitting}
                  >
                    <RemoveIcon />
                  </button>
                </div>

                <div className={s.coursesLabel}>
                  Courses *
                  {row.userId && <span className={s.coursesCount}>({row.courseIds.size} selected)</span>}
                </div>
                {!row.userId ? (
                  <p className={s.coursesHint}>Select a learner to choose courses.</p>
                ) : courses.length === 0 ? (
                  <p className={s.coursesHint}>This organization has no courses yet.</p>
                ) : (
                  <div className={`${s.courseGrid}${errors[row.key] ? ` ${s.inputError}` : ''}`}>
                    {courses.map(c => {
                      const isAssigned = assigned.has(c.id);
                      const ticked = row.courseIds.has(c.id);
                      const seat = seats.get(c.id) || { purchased: 0, available: 0 };
                      const left = Math.max(0, seatsLeft(c.id));
                      // No learner seat left (and not already ticked here): can't be assigned.
                      const noSeats = !isAssigned && !ticked && left <= 0;
                      const seatText = `${left} of ${seat.purchased} available`;
                      return (
                        <label
                          key={c.id}
                          className={`${s.courseOption}${isAssigned ? ` ${s.courseOptionLocked}` : ''}${noSeats ? ` ${s.courseOptionNoSeats}` : ''}`}
                          title={isAssigned
                            ? 'Already assigned to this learner'
                            : noSeats
                              ? (seat.purchased ? 'All purchased learners for this course are used. Buy more learners to assign it.' : 'No learners purchased for this course yet. Buy learners to assign it.')
                              : `${left} of ${seat.purchased} purchased learners still available`}
                        >
                          <input
                            type="checkbox"
                            checked={isAssigned || ticked}
                            disabled={isAssigned || noSeats || submitting}
                            onChange={() => toggleCourse(row.key, c.id)}
                          />
                          <span className={s.courseOptionTitle}>{c.title}</span>
                          {isAssigned
                            ? <span className={s.assignedTag}>Assigned</span>
                            : <span className={`${s.seatTag}${left <= 0 ? ` ${s.seatTagEmpty}` : ''}`}>{seatText}</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
                {errors[row.key] && <p className={f.errorMsg}>{errors[row.key]}</p>}
              </div>
              );
            })}

            <button type="button" className={s.addMoreBtn} onClick={addRow} disabled={allLearnersChosen || submitting}>
              + Add More
            </button>
            {allLearnersChosen && <p className={s.rowsHint}>Every learner of this organization is already in the list.</p>}
          </div>
        ))}

        {orgId && !loadingOrg && learners.length > 0 && (
          <p className={s.seatNote}>
            Each course shows the learners still available out of those purchased for it. Assigning a course
            uses one; removing it from a learner later does not give it back.
          </p>
        )}
        {errors.submit && <p className={f.errorMsg}>{errors.submit}</p>}

        <div className={f.formActions}>
          <button className={f.btnPublish} disabled={submitting || loadingOrg} onClick={handleSubmit}>
            {submitting ? 'Saving…' : 'Assign Courses'}
          </button>
          <button className={f.btnCancel} onClick={() => router.push(backPath)} disabled={submitting}>
            Cancel
          </button>
        </div>
      </div>
    </SuperAdminShell>
  );
}
