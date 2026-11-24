import mongoose from 'mongoose';
import User from './user.model.js';
import CourseAssignment from '../course_assignments/course_assignment.model.js';
import { requester, SUPERADMIN, STORE_OWNER } from '../middleware/accountAccess.js';

// An organization's learners for the store owner pages, without sending every learner
// record to the browser:
//   GET /user/admin/org-learners/page    — Users page: one page of learners + the KPI totals
//   GET /user/admin/org-learners/options — pickers (Assign Courses): id, name and email only
// A store owner always gets their own organization; a super admin passes ?orgId=.

const { ObjectId } = mongoose.Types;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The organization whose learners the caller may list. */
async function orgOf(req) {
  const me = await requester(req);
  if (me?.user_type === STORE_OWNER) {
    if (!me.orgId) throw httpError(403, 'Your account is not linked to an organization.');
    return new ObjectId(me.orgId);
  }
  if (me?.user_type === SUPERADMIN) {
    if (!ObjectId.isValid(String(req.query.orgId || ''))) throw httpError(400, 'A valid organization is required.');
    return new ObjectId(String(req.query.orgId));
  }
  throw httpError(403, 'Your account does not have access to this.');
}

const learnersOf = (orgId) => ({ orgId, user_type: 'employee', orgRole: 'employee', deletedAt: null });

const searchFilter = (search) => {
  const term = typeof search === 'string' ? search.trim() : '';
  if (!term) return {};
  const rx = { $regex: escapeRegex(term), $options: 'i' };
  return { $or: [{ name: rx }, { email: rx }, { whatsapp_no: rx }] };
};

/** Totals for the KPI tiles — over all of the organization's learners, whatever the search. */
async function learnerStats(orgId) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [row] = await User.aggregate([
    { $match: learnersOf(orgId) },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $in: [{ $ifNull: ['$status', 'active'] }, ['active', '']] }, 1, 0] } },
        inactive: { $sum: { $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0] } },
        deactivated: { $sum: { $cond: [{ $in: ['$status', ['deactivated', 'suspended']] }, 1, 0] } },
        newThisMonth: { $sum: { $cond: [{ $gte: ['$createdAt', monthStart] }, 1, 0] } },
      },
    },
  ]);
  return {
    total: row?.total || 0,
    active: row?.active || 0,
    inactive: row?.inactive || 0,
    deactivated: row?.deactivated || 0,
    newThisMonth: row?.newThisMonth || 0,
  };
}

/** How many different courses each of these learners has. */
async function courseCounts(userIds) {
  if (!userIds.length) return new Map();
  const rows = await CourseAssignment.aggregate([
    { $match: { userId: { $in: userIds } } },
    { $group: { _id: '$userId', courses: { $addToSet: '$courseId' } } },
    { $project: { count: { $size: '$courses' } } },
  ]);
  return new Map(rows.map(r => [String(r._id), r.count]));
}

// GET /user/admin/org-learners/page?search=&page=&limit=
export const listOrgLearnersPage = async (req, res, next) => {
  try {
    const orgId = await orgOf(req);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const query = { ...learnersOf(orgId), ...searchFilter(req.query.search) };

    const [rows, total, stats] = await Promise.all([
      User.find(query)
        .select('_id name email whatsapp_no status createdAt lastLoginAt')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
      learnerStats(orgId),
    ]);
    const counts = await courseCounts(rows.map(r => r._id));
    const data = rows.map(r => ({ ...r, courseCount: counts.get(String(r._id)) || 0 }));

    res.status(200).json({ status: 200, message: 'Successfully fetched.', data, total, page, limit, stats });
  } catch (error) {
    next(error);
  }
};

// GET /user/admin/org-learners/options — every learner, id + name + email (newest first).
export const listOrgLearnerOptions = async (req, res, next) => {
  try {
    const orgId = await orgOf(req);
    const data = await User.find(learnersOf(orgId))
      .select('_id name email status')
      .sort({ createdAt: -1, _id: -1 })
      .lean();
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) {
    next(error);
  }
};
