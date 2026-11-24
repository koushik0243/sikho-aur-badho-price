import mongoose from 'mongoose';
import CourseAssignment from './course_assignment.model.js';

// Super admin → User Course Assignments: one row per learner (organization + learner) with
// that learner's courses, filtered, sorted and paged by the database. The page used to
// download every assignment on the platform and group them in the browser.

const { ObjectId } = mongoose.Types;

const SORTS = {
  orgName: 'orgSort',
  learnerName: 'learnerSort',
  assignedOn: 'latest',
};
const MAX_LIMIT = 100;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {{ orgId?: string, search?: string, sort?: string, dir?: string, page?: number, limit?: number, searchOrgName?: boolean }} options
 *   searchOrgName — false when the list is one organization's own (its name would match every row)
 * @returns {Promise<{ groups: object[], total: number, assignments: number }>}
 */
export async function listAssignmentsByLearner({ orgId, search, sort, dir, page = 1, limit = 50, searchOrgName = true } = {}) {
  const pageSize = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 50));
  const pageNo = Math.max(1, Number(page) || 1);
  const match = orgId && ObjectId.isValid(orgId) ? { organizationId: new ObjectId(orgId) } : {};
  const term = typeof search === 'string' ? search.trim() : '';
  const rx = term ? { $regexMatch: { input: '$$v', regex: escapeRegex(term), options: 'i' } } : null;

  const pipeline = [
    { $match: match },
    { $sort: { attemptedAt: 1, _id: 1 } },
    {
      $group: {
        _id: { o: '$organizationId', u: '$userId' },
        records: { $push: { recordId: '$_id', courseId: '$courseId', assignedOn: '$attemptedAt' } },
        latest: { $max: '$attemptedAt' },
      },
    },
    { $lookup: { from: 'users', localField: '_id.u', foreignField: '_id', as: 'user', pipeline: [{ $project: { name: 1, email: 1 } }] } },
    { $lookup: { from: 'organizations', localField: '_id.o', foreignField: '_id', as: 'org', pipeline: [{ $project: { org_name: 1 } }] } },
    { $lookup: { from: 'courses', localField: 'records.courseId', foreignField: '_id', as: 'courseDocs', pipeline: [{ $project: { title: 1 } }] } },
    {
      $addFields: {
        learnerName: { $ifNull: [{ $first: '$user.name' }, '—'] },
        learnerEmail: { $ifNull: [{ $first: '$user.email' }, ''] },
        orgName: { $ifNull: [{ $first: '$org.org_name' }, '—'] },
        courses: {
          $map: {
            input: '$records',
            as: 'r',
            in: {
              recordId: '$$r.recordId',
              courseId: '$$r.courseId',
              assignedOn: '$$r.assignedOn',
              title: {
                $ifNull: [{
                  $first: {
                    $map: {
                      input: { $filter: { input: '$courseDocs', as: 'c', cond: { $eq: ['$$c._id', '$$r.courseId'] } } },
                      as: 'c',
                      in: '$$c.title',
                    },
                  },
                }, '—'],
              },
            },
          },
        },
      },
    },
  ];

  if (rx) {
    // A learner matches on organization, name or email (all their courses are shown);
    // otherwise only the courses whose title matches are kept.
    pipeline.push(
      {
        $addFields: {
          groupMatches: {
            $anyElementTrue: [{ $map: { input: searchOrgName ? ['$orgName', '$learnerName', '$learnerEmail'] : ['$learnerName', '$learnerEmail'], as: 'v', in: rx } }],
          },
        },
      },
      {
        $addFields: {
          courses: {
            $cond: ['$groupMatches', '$courses', {
              $filter: { input: '$courses', as: 'c', cond: { $let: { vars: { v: '$$c.title' }, in: rx } } },
            }],
          },
        },
      },
      { $match: { 'courses.0': { $exists: true } } },
    );
  }

  const sortField = SORTS[sort];
  const order = dir === 'desc' ? -1 : 1;
  pipeline.push(
    { $addFields: { orgSort: { $toLower: '$orgName' }, learnerSort: { $toLower: '$learnerName' } } },
    { $sort: sortField ? { [sortField]: order, _id: 1 } : { orgSort: 1, learnerSort: 1, _id: 1 } },
    {
      $facet: {
        meta: [{ $group: { _id: null, total: { $sum: 1 }, assignments: { $sum: { $size: '$courses' } } } }],
        groups: [
          { $skip: (pageNo - 1) * pageSize },
          { $limit: pageSize },
          {
            $project: {
              _id: 0,
              orgId: '$_id.o',
              userId: '$_id.u',
              orgName: 1,
              learnerName: 1,
              learnerEmail: 1,
              courses: 1,
            },
          },
        ],
      },
    },
  );

  const [result] = await CourseAssignment.aggregate(pipeline).allowDiskUse(true);
  const meta = result?.meta?.[0];
  return { groups: result?.groups || [], total: meta?.total || 0, assignments: meta?.assignments || 0 };
}
