'use client';

import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useRouter } from 'next/navigation';
import { selectUser } from '../../../redux/slices/authSlice';
import apiServiceHandler from '../../../service/apiService';
import { useStoreCart } from '../../../lib/storeCart';
import { CART_PATH, formatPrice } from '../Cart/cartFormat';
import { kit as k, PageHeader, KpiTiles, Card, Pill, SkeletonRows, KitIcon } from '../PageKit/PageKit';
import s from './LearnerUsage.module.css';

const FILTERS = [
  { value: 'all',       label: 'All courses' },
  { value: 'available', label: 'Learners available' },
  { value: 'none',      label: 'None available' },
];

/** What was paid per learner: one price, or the latest with the earlier range. */
function paidText(price) {
  if (!price) return '—';
  return price.min === price.max
    ? formatPrice(price.last)
    : `${formatPrice(price.last)} (earlier ${formatPrice(price.min)} – ${formatPrice(price.max)})`;
}

// Learner Usage: for every course of the organization, how many learners were
// purchased, how many are assigned, and how many can still be assigned. A course is assigned
// to a learner only while learners are available; removing a course from a learner does not
// give the learner back. "Buy Learners" puts the course in the cart.
export default function LearnerUsage() {
  const user = useSelector(selectUser);
  const router = useRouter();
  const cart = useStoreCart(user?._id);
  const [rows, setRows] = useState(null); // null while loading
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    // The server always answers with the signed-in store owner's own organization.
    apiServiceHandler('GET', `course-seat/list?t=${Date.now()}`)
      .then(res => { if (!cancelled) setRows(Array.isArray(res?.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  const loading = rows === null;
  const list = rows || [];
  const term = search.trim().toLowerCase();
  const shown = list
    .filter(r => !term || r.title.toLowerCase().includes(term))
    .filter(r => filter === 'all' || (filter === 'available' ? r.available > 0 : r.available === 0))
    .sort((a, b) => a.title.localeCompare(b.title));

  const sum = key => list.reduce((n, r) => n + (r[key] || 0), 0);
  const purchased = sum('purchased');
  const assigned = sum('used');
  const available = sum('available');
  const noneLeft = list.filter(r => r.available === 0).length;

  function buyLearners(courseId) {
    if (user?._id) cart.add(courseId);
    router.push(CART_PATH);
  }

  return (
    <div className={k.page}>
      <PageHeader
        title="Learner Usage"
        sub="How many learners each course can still be assigned to. Assigning a course uses one; removing it from a learner doesn't give it back."
      />

      <KpiTiles items={[
        { label: 'Courses',            value: loading ? '—' : list.length, icon: KitIcon.layers },
        { label: 'Learners purchased', value: loading ? '—' : purchased,   icon: KitIcon.cart },
        { label: 'Learners assigned',  value: loading ? '—' : assigned,    icon: KitIcon.users },
        { label: 'Learners available', value: loading ? '—' : available,   icon: KitIcon.check, tone: available ? 'good' : '',
          hint: loading || !noneLeft ? '' : `${noneLeft} course${noneLeft !== 1 ? 's have' : ' has'} none left` },
      ]} />

      <Card title="Courses" meta={!loading && <Pill tone="neutral">{shown.length} course{shown.length !== 1 ? 's' : ''}</Pill>} flush>
        <div className={k.toolbar} role="search" aria-label="Filter courses">
          <label className={k.search}>
            <span className={k.srOnly}>Search courses</span>
            {KitIcon.search}
            <input className={k.input} type="text" placeholder="Search by course name…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </label>
          <select className={k.select} aria-label="Availability" value={filter} onChange={e => setFilter(e.target.value)}>
            {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        <div className={k.tableWrap}>
          <table className={k.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Course</th>
                <th className={k.num}>Paid / learner</th>
                <th className={k.num}>Purchased</th>
                <th className={k.num}>Assigned</th>
                <th className={k.num}>Available</th>
                <th>Usage</th>
                <th className={k.num}><span className={k.srOnly}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <SkeletonRows cols={8} /> : shown.length === 0 ? (
                <tr><td colSpan={8} className={k.empty}>
                  {list.length === 0 ? 'Your organization has no courses yet. Buy courses from All Courses.' : 'No courses match these filters.'}
                </td></tr>
              ) : shown.map((r, i) => {
                const usedPct = r.purchased ? Math.min(100, Math.round((r.used / r.purchased) * 100)) : 0;
                return (
                  <tr key={r.courseId}>
                    <td className={k.idx}>{i + 1}</td>
                    <td>
                      <span className={k.strong}>{r.title}</span>
                      {r.level && <span className={s.level}>{r.level}</span>}
                    </td>
                    <td className={k.num}>{paidText(r.price)}</td>
                    <td className={k.num}>{r.purchased}</td>
                    <td className={k.num}>{r.used}</td>
                    <td className={k.num}>
                      <Pill tone={r.available > 0 ? 'good' : 'bad'}>{r.available}</Pill>
                    </td>
                    <td>
                      <div className={s.usage} title={r.purchased ? `${r.used} of ${r.purchased} learners assigned` : 'No learners purchased'}>
                        <span className={s.usageTrack}>
                          <span className={`${s.usageFill} ${r.available === 0 ? s.usageFull : ''}`} style={{ width: `${usedPct}%` }} />
                        </span>
                        <span className={s.usagePct}>{r.purchased ? `${usedPct}%` : '—'}</span>
                      </div>
                    </td>
                    <td className={k.num}>
                      <button type="button" className={r.available === 0 ? k.btnPrimary : k.btnOutline}
                        onClick={() => buyLearners(r.courseId)}
                        title="Add this course to the cart to buy more learners">
                        Buy Learners
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
