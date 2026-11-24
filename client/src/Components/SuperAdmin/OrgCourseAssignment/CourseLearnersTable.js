'use client';

import { coursePrice, formatPrice, lineTotal } from '../../StoreOwner/Cart/cartFormat';
import { clampLearners, MAX_LEARNERS_PER_ITEM } from '../../../lib/storeCart';
import s from './CourseLearnersTable.module.css';

// Courses × number of learners, shared by Add and Edit Organization Course.
// Each row: checkbox · course · price per learner · no. of learners · cost.
// A real <table>, so its header cells get the app's standard list-header size.

const LEARNERS_TYPING = /^\d{0,5}$/;

/** Learners typed for a course as a number (blank = 0). */
export const learnersCount = (text) => {
  const n = parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LEARNERS_PER_ITEM) : 0;
};

/** What leaving a learners box leaves in it: blank stays blank only when `optional`. */
export const settledLearners = (text, optional) => {
  if (optional && !learnersCount(text)) return '';
  return String(clampLearners(text || 1));
};

/** Totals for the courses being bought: [{ course, learners }]. */
export function purchaseTotals(lines) {
  const bought = lines.filter(l => l.learners > 0);
  return {
    courses: bought.length,
    learners: bought.reduce((n, l) => n + l.learners, 0),
    cost: Math.round(bought.reduce((sum, l) => sum + lineTotal(coursePrice(l.course), l.learners), 0) * 100) / 100,
  };
}

export const LEARNERS_LIMIT_HINT = `1 to ${MAX_LEARNERS_PER_ITEM.toLocaleString('en-IN')} learners per course.`;

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/**
 * @param {{
 *   courses: object[],
 *   checked: Set<string>,                      // ticked course ids
 *   learners: Record<string, string>,          // learners as typed, per course id
 *   onToggle: (id: string) => void,
 *   onLearnersChange: (id: string, text: string) => void,
 *   onLearnersBlur: (id: string) => void,
 *   isLocked?: (id: string) => boolean,        // ticked and can't be unticked
 *   canBuy?: (id: string) => boolean,          // learners box usable when ticked
 *   learnersPlaceholder?: (id: string) => string,
 *   note?: (id: string) => string,             // small line under the course name
 * }} props
 */
export default function CourseLearnersTable({
  courses, checked, learners, onToggle, onLearnersChange, onLearnersBlur,
  isLocked = () => false, canBuy = () => true, learnersPlaceholder = () => '—', note = () => '',
}) {
  return (
    <div className={s.scroll}>
      <table className={s.table}>
        <colgroup>
          <col className={s.colCheck} />
          <col />
          <col className={s.colPrice} />
          <col className={s.colLearners} />
          <col className={s.colCost} />
        </colgroup>
        <thead>
          <tr>
            <th><span className={s.srOnly}>Select</span></th>
            <th>Course</th>
            <th className={`${s.num} ${s.priceCell}`}>Price per learner</th>
            <th className={s.center}>No. of learners</th>
            <th className={s.num}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {courses.map(c => {
            const cid = String(c._id);
            const inputId = `course-pick-${cid}`;
            const ticked = checked.has(cid);
            const locked = isLocked(cid);
            const buyable = ticked && canBuy(cid);
            const unit = coursePrice(c);
            const count = buyable ? learnersCount(learners[cid]) : 0;
            // No course is free: an unpriced course can't be bought (an already-ticked one can be unticked).
            const unpriced = !(unit > 0);
            const sub = unpriced && !locked ? 'No price yet — set its Price Per Learner in the course builder first.' : note(cid);
            return (
              <tr key={cid} className={ticked ? s.rowChecked : undefined}>
                <td className={s.checkCell}>
                  <input id={inputId} type="checkbox" className={s.check}
                    checked={ticked} disabled={locked || (unpriced && !ticked)} onChange={() => onToggle(cid)}
                    title={locked ? 'Learners already have this course, so it cannot be removed.' : unpriced ? 'This course has no price yet.' : undefined} />
                </td>
                <td>
                  <label htmlFor={inputId} className={`${s.courseName} ${locked ? s.courseLocked : ''}`}>
                    {c.title}
                    {locked && <span className={s.lockIcon} title="Locked: learners already have this course"><LockIcon /></span>}
                  </label>
                  {sub && <span className={s.courseNote}>{sub}</span>}
                </td>
                <td className={`${s.num} ${s.priceCell}`}>{unpriced ? '—' : formatPrice(unit)}</td>
                <td className={s.center}>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={s.learnersInput}
                    aria-label={`Number of learners for ${c.title}`}
                    placeholder={buyable ? learnersPlaceholder(cid) : '—'}
                    disabled={!buyable}
                    value={buyable ? (learners[cid] ?? '') : ''}
                    onChange={e => { if (LEARNERS_TYPING.test(e.target.value)) onLearnersChange(cid, e.target.value); }}
                    onBlur={() => onLearnersBlur(cid)}
                  />
                </td>
                <td className={`${s.num} ${count ? s.cost : s.costMuted}`}>
                  {count ? formatPrice(lineTotal(unit, count)) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One figure in the footer ("Courses 2"). */
export function TotalStat({ label, value, warn = false }) {
  return (
    <span className={`${s.stat} ${warn ? s.statWarn : ''}`}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>{value}</span>
    </span>
  );
}

/** Card footer: figures on the left, total cost and the buttons on the right. */
export function PurchaseFooter({ totals, extra, actions }) {
  return (
    <div className={s.footer}>
      <div className={s.stats} aria-live="polite">
        <TotalStat label="Courses" value={totals.courses} />
        <TotalStat label="Learners" value={totals.learners} />
        {extra}
      </div>
      <div className={s.footerRight}>
        <div className={s.totalCost} aria-live="polite">
          <span className={s.statLabel}>Total cost</span>
          <span className={s.totalCostValue}>{formatPrice(totals.cost)}</span>
        </div>
        <div className={s.actions}>{actions}</div>
      </div>
    </div>
  );
}

/** Organization row at the top of the card: label + the dropdown or the fixed name. */
export function OrgField({ label = 'Organization', htmlFor, required = false, error, children }) {
  return (
    <div className={s.orgRow}>
      <label className={s.orgLabel} htmlFor={htmlFor}>
        {label}{required && <span className={s.req} aria-hidden="true"> *</span>}
      </label>
      <div className={s.orgField}>
        {children}
        {error && <p className={s.error}>{error}</p>}
      </div>
    </div>
  );
}

/** The fixed organization name (Edit, or Add opened for one organization). */
export function OrgName({ children }) {
  return <span className={s.orgName}>{children}</span>;
}

/** "Courses" heading with the selected count, and an optional hint on the right. */
export function SectionHead({ title, meta, hint }) {
  return (
    <div className={s.sectionHead}>
      <div className={s.sectionTitleWrap}>
        <span className={s.sectionTitle}>{title}</span>
        {meta && <span className={s.sectionMeta}>{meta}</span>}
      </div>
      {hint && <span className={s.sectionHint}>{hint}</span>}
    </div>
  );
}

/** Small message in place of the table (loading / nothing to list). */
export function TableMessage({ children }) {
  return <p className={s.message}>{children}</p>;
}

/** Validation message under the table. */
export function FormError({ children }) {
  return <p className={s.error}>{children}</p>;
}

/** The page's card (organization row, courses, footer). */
export function FormCard({ children }) {
  return <section className={s.card}>{children}</section>;
}
