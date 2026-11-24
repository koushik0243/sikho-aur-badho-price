'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import apiServiceHandler from '../../../service/apiService';
import SuperAdminShell from '../SuperAdminShell';
import sPage from "./AddOrgCourseAssignment.module.css";
import { withAdminKit } from '../AdminKit/AdminKit';
import CourseLearnersTable, {
  FormCard, OrgField, OrgName, SectionHead, TableMessage, FormError, PurchaseFooter,
  LEARNERS_LIMIT_HINT, learnersCount, settledLearners, purchaseTotals,
} from './CourseLearnersTable';
import { savePurchaseDraft, readPurchaseDraft, PAYMENT_PATH } from './purchaseDraft';
import { coursePrice } from '../../StoreOwner/Cart/cartFormat';

const ADD_PATH = '/superadmin/organization-course-assignment/add';

// Page styles + the shared super admin look.
const s = withAdminKit(sPage);

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7" />
  </svg>
);

// Assigning courses here buys them for the organization: each ticked course × its number of
// learners at the course's Price Per Learner. "Assign Courses" opens the Payment page
// (OrgCoursePayment.js), which records the payment and submits the same checkout as the store
// owner's cart (POST order/purchase-courses), so the order is recorded as the organization's own.
export default function AddOrgCourseAssignment() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlOrgId = searchParams.get('orgId') ?? '';
  const thisPath = `${ADD_PATH}${urlOrgId ? `?orgId=${urlOrgId}` : ''}`;

  // Back from the Payment page: start with the same organization and courses ticked.
  // (This page renders in the browser only — useSearchParams inside a Suspense boundary.)
  const [restored] = useState(() => {
    const draft = readPurchaseDraft();
    return draft && draft.returnPath === thisPath ? draft : null;
  });

  const [orgs, setOrgs]               = useState([]);
  const [orgName, setOrgName]         = useState('');
  const [courses, setCourses]         = useState(null); // null while loading
  const [orgId, setOrgId]             = useState(restored?.orgId || urlOrgId);
  // Ticked courses → number of learners as typed (text, so the box can be cleared while typing).
  const [learnersById, setLearnersById] = useState(() => (
    restored ? Object.fromEntries(restored.items.map(i => [i.courseId, String(i.learners)])) : {}
  ));
  const [errors, setErrors]           = useState({});
  const [submitting, setSubmitting]   = useState(false);

  const backPath = urlOrgId
    ? `/superadmin/organization-course-assignment?orgId=${urlOrgId}`
    : '/superadmin/organization-course-assignment';

  // Load courses (always) and orgs (only when no orgId in URL)
  useEffect(() => {
    apiServiceHandler('GET', 'course/list?status=published')
      .then(res => setCourses(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setCourses([]));

    if (!urlOrgId) {
      apiServiceHandler('GET', 'organization/options')
        .then(res => setOrgs(Array.isArray(res?.data) ? res.data : []))
        .catch(() => {});
    }
  }, [urlOrgId]);

  // Organization name for the read-only display (organization chosen from the list page).
  useEffect(() => {
    if (!urlOrgId) return undefined;
    let cancelled = false;
    apiServiceHandler('GET', `organization/edit/${urlOrgId}`)
      .then(res => { if (!cancelled && res?.data?.org_name) setOrgName(res.data.org_name); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [urlOrgId]);

  function changeOrg(id) {
    setOrgId(id);
    setLearnersById({});
    setErrors({});
  }

  function toggleCourse(cid) {
    setLearnersById(prev => {
      const next = { ...prev };
      if (cid in next) delete next[cid]; else next[cid] = '1';
      return next;
    });
    setErrors(prev => ({ ...prev, courses: undefined }));
  }

  const selectedIds = Object.keys(learnersById);
  const courseById  = new Map((courses || []).map(c => [String(c._id), c]));
  const learnersOf  = cid => learnersCount(learnersById[cid]) || 1;
  const totals = purchaseTotals(selectedIds.map(cid => ({ course: courseById.get(cid), learners: learnersOf(cid) })));

  function validate() {
    const e = {};
    if (!orgId) e.orgId = 'Please select an organization.';
    else if (selectedIds.length === 0) e.courses = 'Tick at least one course and enter its number of learners.';
    return e;
  }

  // "Assign Courses" → the Payment page (payment mode + details); the courses are bought
  // and assigned to the organization only when that page is submitted.
  function handleSubmit() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    const name = urlOrgId ? orgName : (orgs.find(o => String(o._id) === orgId)?.org_name || '');
    const saved = savePurchaseDraft({
      orgId,
      orgName: name,
      items: selectedIds.map(courseId => {
        const course = courseById.get(courseId);
        return { courseId, title: course?.title || 'Course', unitPrice: coursePrice(course), learners: learnersOf(courseId) };
      }),
      returnPath: thisPath,
      donePath: backPath,
    });
    if (!saved) { toast.warning('Could not continue to the payment step. Please allow site storage and try again.'); return; }
    setSubmitting(true);
    router.push(PAYMENT_PATH);
  }

  return (
    <SuperAdminShell activeSection="assign-course">
      <button className={s.backBtn} onClick={() => router.push(backPath)}>
        <BackIcon /> Back
      </button>
      <h1 className={s.pageTitle}>Add Organization Course</h1>
      <p className={s.pageSubtitle}>Pick courses for an organization and the number of learners for each</p>

      <FormCard>
        {/* Organization — dropdown, or the fixed name when opened for one organization */}
        <OrgField htmlFor={urlOrgId ? undefined : 'assign-org'} required={!urlOrgId} error={errors.orgId}>
          {urlOrgId ? (
            <OrgName>{orgName || '—'}</OrgName>
          ) : (
            <select id="assign-org" value={orgId} onChange={e => changeOrg(e.target.value)}>
              <option value="">— Select organization —</option>
              {orgs.map(org => (
                <option key={org._id} value={org._id}>{org.org_name}</option>
              ))}
            </select>
          )}
        </OrgField>

        {/* Courses: checkbox · price per learner · number of learners · cost */}
        <SectionHead
          title="Courses"
          meta={selectedIds.length ? `${selectedIds.length} selected` : null}
          hint={LEARNERS_LIMIT_HINT}
        />
        {!orgId ? (
          <TableMessage>Select an organization to choose its courses.</TableMessage>
        ) : courses === null ? (
          <TableMessage>Loading courses…</TableMessage>
        ) : courses.length === 0 ? (
          <TableMessage>No published courses available.</TableMessage>
        ) : (
          <CourseLearnersTable
            courses={courses}
            checked={new Set(selectedIds)}
            learners={learnersById}
            onToggle={toggleCourse}
            onLearnersChange={(cid, text) => setLearnersById(prev => ({ ...prev, [cid]: text }))}
            onLearnersBlur={cid => setLearnersById(prev => (cid in prev ? { ...prev, [cid]: settledLearners(prev[cid], false) } : prev))}
          />
        )}
        {errors.courses && <FormError>{errors.courses}</FormError>}

        <PurchaseFooter
          totals={totals}
          actions={(
            <>
              <button className={s.btnCancel} onClick={() => router.push(backPath)}>Cancel</button>
              <button className={s.btnPublish} disabled={submitting} onClick={handleSubmit}>
                {submitting ? 'Assigning…' : 'Continue to Payment'}
              </button>
            </>
          )}
        />
      </FormCard>
    </SuperAdminShell>
  );
}
