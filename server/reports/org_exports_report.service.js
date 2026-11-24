import mongoose from 'mongoose';

// Data behind the store owner's Reports page (CSV / PDF downloads).
//
// The page used to download every learner, every course assignment and every quiz attempt
// (with all answers) of the organization just to show four counts; the rows of a download
// are now built here, only when the owner clicks it.

const { ObjectId } = mongoose.Types;
const oid = (v) => String(v || '');

export const EXPORT_KEYS = ['completion', 'performers', 'failure', 'zoom', 'certificates'];

/** Same fallbacks the page used for a learner's name. */
const learnerName = (u) => (u ? u.name || u.fullName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || oid(u._id) : '');
const NAME_FIELDS = { name: 1, fullName: 1, firstName: 1, lastName: 1, email: 1 };

/** The organization's learners (the people the Users page lists). */
const learnersQuery = (org) => ({ orgId: org, user_type: 'employee', orgRole: 'employee', deletedAt: null });

/** The organization's courses (bought / added) and everyone ever in the organization. */
async function orgScope(db, org) {
  const [courseIds, userIds] = await Promise.all([
    db.collection('organization_courses').distinct('courseId', { orgId: org, deletedAt: null }),
    db.collection('users').distinct('_id', { orgId: org }),
  ]);
  return { courseIds: courseIds.filter(Boolean), userIds };
}

/** Quiz attempts on the organization's courses by its people (what the page counted). */
const attemptsMatch = ({ courseIds, userIds }) => ({ courseId: { $in: courseIds }, userId: { $in: userIds } });

/**
 * The four counts at the top of the Reports page.
 * @param {{ orgId: string }} args
 */
export async function getOrgExportCounts({ orgId }) {
  const db = mongoose.connection.db;
  const org = new ObjectId(orgId);
  const scope = await orgScope(db, org);
  const [learners, assignments, quizAttempts] = await Promise.all([
    db.collection('users').countDocuments(learnersQuery(org)),
    db.collection('course_assignments').countDocuments({ organizationId: org }),
    scope.courseIds.length ? db.collection('quiz_attempts').countDocuments(attemptsMatch(scope)) : 0,
  ]);
  return { courses: scope.courseIds.length, learners, quizAttempts, assignments, generatedAt: new Date() };
}

/** id → document, for the given ids of one collection. */
async function byId(db, collection, ids, projection) {
  const unique = [...new Set(ids.map(oid))].filter(Boolean).map(id => new ObjectId(id));
  const docs = unique.length ? await db.collection(collection).find({ _id: { $in: unique } }).project(projection).toArray() : [];
  return new Map(docs.map(d => [oid(d._id), d]));
}

/** Course assignments with the latest quiz attempt per learner + course (completion / certificate logs). */
async function completionRows(db, org, scope) {
  const [assignments, latest] = await Promise.all([
    db.collection('course_assignments').find({ organizationId: org })
      .project({ userId: 1, courseId: 1, attemptedAt: 1 }).sort({ attemptedAt: -1 }).toArray(),
    scope.courseIds.length
      ? db.collection('quiz_attempts').aggregate([
        { $match: attemptsMatch(scope) },
        { $group: { _id: { u: '$userId', c: '$courseId' }, at: { $max: '$createdAt' } } },
      ]).toArray()
      : [],
  ]);
  const [users, courses] = await Promise.all([
    byId(db, 'users', assignments.map(a => a.userId), NAME_FIELDS),
    byId(db, 'courses', assignments.map(a => a.courseId), { title: 1 }),
  ]);
  const lastAttempt = new Map(latest.map(l => [`${l._id.u}|${l._id.c}`, l.at]));
  return assignments.map(a => {
    const u = users.get(oid(a.userId));
    return {
      name: learnerName(u), email: u?.email || '',
      course: courses.get(oid(a.courseId))?.title || '',
      assignedAt: a.attemptedAt || null,
      lastAttemptAt: lastAttempt.get(`${a.userId}|${a.courseId}`) || null,
    };
  });
}

/** Every quiz attempt, best score first. */
async function performerRows(db, scope) {
  if (!scope.courseIds.length) return [];
  const attempts = await db.collection('quiz_attempts').find(attemptsMatch(scope))
    .project({ userId: 1, courseId: 1, topicId: 1, totalScore: 1, passed: 1, createdAt: 1 })
    .sort({ totalScore: -1, createdAt: -1 }).toArray();
  const [users, courses, topics] = await Promise.all([
    byId(db, 'users', attempts.map(a => a.userId), NAME_FIELDS),
    byId(db, 'courses', attempts.map(a => a.courseId), { title: 1 }),
    byId(db, 'topics', attempts.map(a => a.topicId), { title: 1 }),
  ]);
  return attempts.map(a => {
    const u = users.get(oid(a.userId));
    return {
      name: learnerName(u), email: u?.email || '',
      course: courses.get(oid(a.courseId))?.title || oid(a.courseId),
      quiz: topics.get(oid(a.topicId))?.title || oid(a.topicId),
      score: a.totalScore ?? null, passed: Boolean(a.passed), takenAt: a.createdAt || null,
    };
  });
}

/** Attempts and failures per quiz. */
async function failureRows(db, scope) {
  if (!scope.courseIds.length) return [];
  const groups = await db.collection('quiz_attempts').aggregate([
    { $match: { ...attemptsMatch(scope), topicId: { $ne: null } } },
    { $group: {
      _id: '$topicId',
      courseId: { $first: '$courseId' }, chapterId: { $first: '$chapterId' },
      total: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$passed', true] }, 0, 1] } },
    } },
  ]).toArray();
  const [courses, chapters, topics] = await Promise.all([
    byId(db, 'courses', groups.map(g => g.courseId), { title: 1 }),
    byId(db, 'chapters', groups.map(g => g.chapterId), { title: 1 }),
    byId(db, 'topics', groups.map(g => g._id), { title: 1 }),
  ]);
  return groups.map(g => ({
    course: courses.get(oid(g.courseId))?.title || '',
    chapter: chapters.get(oid(g.chapterId))?.title || '',
    quiz: topics.get(oid(g._id))?.title || oid(g._id),
    total: g.total, failed: g.failed,
  })).sort((a, b) => a.course.localeCompare(b.course) || a.chapter.localeCompare(b.chapter) || a.quiz.localeCompare(b.quiz));
}

/** Each learner with the number of course assignments they have. */
async function learnerRows(db, org) {
  const [learners, counts] = await Promise.all([
    db.collection('users').find(learnersQuery(org)).project(NAME_FIELDS).sort({ createdAt: -1 }).toArray(),
    db.collection('course_assignments').aggregate([
      { $match: { organizationId: org } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const assigned = new Map(counts.map(c => [oid(c._id), c.n]));
  return learners.map(u => ({ name: learnerName(u), email: u.email || '', assigned: assigned.get(oid(u._id)) || 0 }));
}

/**
 * The rows of one download on the Reports page.
 * @param {{ orgId: string, key: string }} args  key: one of EXPORT_KEYS
 */
export async function getOrgExportRows({ orgId, key }) {
  const db = mongoose.connection.db;
  const org = new ObjectId(orgId);
  const scope = key === 'zoom' ? null : await orgScope(db, org);
  let rows;
  if (key === 'completion' || key === 'certificates') rows = await completionRows(db, org, scope);
  else if (key === 'performers') rows = await performerRows(db, scope);
  else if (key === 'failure') rows = await failureRows(db, scope);
  else if (key === 'zoom') rows = await learnerRows(db, org);
  else throw Object.assign(new Error('Unknown report.'), { status: 400 });
  return { key, rows, generatedAt: new Date() };
}
