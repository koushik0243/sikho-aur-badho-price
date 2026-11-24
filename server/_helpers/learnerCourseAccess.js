import mongoose from 'mongoose';
import { requester, LEARNER } from '../middleware/accountAccess.js';
import CourseAssignment from '../course_assignments/course_assignment.model.js';
import Chapter from '../chapters/chapter.model.js';
import Topic from '../topics/topic.model.js';
import Course from '../courses/course.model.js';

/**
 * A learner may only read (or record progress / attempts / notes / reviews in) the courses
 * assigned to them: a course_assignments record with their userId and that courseId.
 * Super admins and store owners are not limited here — their own rules live elsewhere.
 *
 * A refused learner gets 404 "Course not found." (not 403), so a course id that exists
 * can't be told apart from one that doesn't.
 *
 * Usage in a handler (errors reach the app error handler through next(err)):
 *   await assertLearnerCanAccessCourse(req, req.query.courseId);
 *   await assertLearnerCanAccessChapter(req, req.query.chapterId);
 *   await assertLearnerCanAccessTopic(req, req.query.topicId);
 */

export const COURSE_NOT_FOUND_MESSAGE = 'Course not found.';

const { ObjectId } = mongoose.Types;

/** 404 error the app error handler sends as { status: 404, message: 'Course not found.' }. */
export function courseNotFoundError() {
  const err = new Error(COURSE_NOT_FOUND_MESSAGE);
  err.statusCode = 404;
  return err;
}

/**
 * Ids (strings) of every course assigned to this user. One query on the
 * { userId, courseId } index of course_assignments.
 * @returns {Promise<Set<string>>}
 */
export async function assignedCourseIdsForUser(userId) {
  if (!userId || !ObjectId.isValid(String(userId))) return new Set();
  const ids = await CourseAssignment.distinct('courseId', { userId: new ObjectId(String(userId)) });
  return new Set(ids.map(String));
}

/**
 * The signed-in learner's assigned course ids, or null when the account is not a learner
 * (no restriction). Loaded once per request and kept on req, so several checks in one
 * request (e.g. the course player bundle) cost a single query. The promise itself is cached
 * so checks running in parallel share it too.
 * @returns {Promise<Set<string>|null>}
 */
export async function learnerAssignedCourseIds(req) {
  const me = await requester(req);
  // Every caller sits behind protect + allowAccounts, so an unknown account should not get
  // here; refuse rather than fall through to "unrestricted".
  if (!me) throw courseNotFoundError();
  if (me.user_type !== LEARNER) return null;
  if (!req.learnerCourseIds) req.learnerCourseIds = assignedCourseIdsForUser(me._id);
  return req.learnerCourseIds;
}

/** True when the signed-in account is a learner (user_type 'employee'). */
export async function isLearnerRequest(req) {
  const me = await requester(req);
  return me?.user_type === LEARNER;
}

/** No-op for super admins / store owners; throws 404 for a learner not assigned this course. */
export async function assertLearnerCanAccessCourse(req, courseId) {
  const assigned = await learnerAssignedCourseIds(req);
  if (!assigned) return;
  // String() of an array (?courseId=a&courseId=b) never matches a single id, so it is refused.
  if (!courseId || !assigned.has(String(courseId))) throw courseNotFoundError();
}

/** Resolves the chapter's course, then as assertLearnerCanAccessCourse. Unknown chapter → 404. */
export async function assertLearnerCanAccessChapter(req, chapterId) {
  const assigned = await learnerAssignedCourseIds(req);
  if (!assigned) return;
  if (!chapterId || !ObjectId.isValid(String(chapterId))) throw courseNotFoundError();
  const chapter = await Chapter.findById(String(chapterId)).select('courseId').lean();
  if (!chapter || !assigned.has(String(chapter.courseId))) throw courseNotFoundError();
}

/** Resolves the topic's (lesson / quiz / assignment) course, then as assertLearnerCanAccessCourse. */
export async function assertLearnerCanAccessTopic(req, topicId) {
  const assigned = await learnerAssignedCourseIds(req);
  if (!assigned) return;
  if (!topicId || !ObjectId.isValid(String(topicId))) throw courseNotFoundError();
  const topic = await Topic.findById(String(topicId)).select('courseId').lean();
  if (!topic || !assigned.has(String(topic.courseId))) throw courseNotFoundError();
}

/**
 * For list endpoints filtered by any of course / chapter / topic: a learner must name at least
 * one, and every one named must be in an assigned course. With no filter at all a learner would
 * get every course's rows, so that is refused too. No-op for other accounts.
 */
export async function assertLearnerCanAccessScope(req, { courseId, chapterId, topicId } = {}) {
  if (!(await learnerAssignedCourseIds(req))) return;
  if (!courseId && !chapterId && !topicId) throw courseNotFoundError();
  if (courseId) await assertLearnerCanAccessCourse(req, courseId);
  if (chapterId) await assertLearnerCanAccessChapter(req, chapterId);
  if (topicId) await assertLearnerCanAccessTopic(req, topicId);
}

/**
 * Assigned course ids as ObjectIds for a learner (to limit a course list to them), or
 * undefined for other accounts (no limit).
 * @returns {Promise<mongoose.Types.ObjectId[]|undefined>}
 */
export async function learnerCourseIdFilter(req) {
  const assigned = await learnerAssignedCourseIds(req);
  return assigned ? [...assigned].map(id => new ObjectId(id)) : undefined;
}

// ── Course media files (/uploads, see middleware/mediaAuth.js) ────────────────────────────
// A <video>/<img> request carries only a media token, so there is no `req.account` to reuse
// and a seeking video makes many Range requests. Two small in-memory caches keep that cheap:
// which course(s) reference a file, and which courses a learner is assigned. Only positive
// results are cached, and a refusal always re-reads the learner's assignments, so a course
// assigned a moment ago plays at once; an unassigned course stops playing within the TTL.

const MEDIA_CACHE_TTL_MS = 60 * 1000;
const MEDIA_CACHE_MAX_ENTRIES = 5000;
const uploadOwnersCache = new Map(); // '/uploads/…' → string[] of course ids
const mediaViewerCache = new Map();  // userId → { isLearner, assigned: Set<string> }

function cacheGet(cache, key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < MEDIA_CACHE_TTL_MS) return hit.value;
  cache.delete(key);
  return undefined;
}

function cacheSet(cache, key, value) {
  // Crude bound: entries are cheap to rebuild, so dropping them all beats tracking LRU order.
  if (cache.size >= MEDIA_CACHE_MAX_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

/**
 * Course ids whose records point at this upload: a lesson's video / image / transcript source /
 * attachment, or a course intro video. These are the only fields that hold protected /uploads
 * paths. Empty when nothing references the file.
 */
async function courseIdsOwningUpload(uploadUrl) {
  const cached = cacheGet(uploadOwnersCache, uploadUrl);
  if (cached) return cached;
  const [topics, courses] = await Promise.all([
    Topic.find({
      $or: [
        { videoUrl: uploadUrl }, { imageUrl: uploadUrl },
        { transcriptVideoUrl: uploadUrl }, { 'attachments.url': uploadUrl },
      ],
    }).select('courseId').lean(),
    Course.find({ intro_video: uploadUrl }).select('_id').lean(),
  ]);
  const owners = [...new Set([...topics.map(t => String(t.courseId)), ...courses.map(c => String(c._id))])];
  if (owners.length) cacheSet(uploadOwnersCache, uploadUrl, owners);
  return owners;
}

/** { isLearner, assigned } for a media-token user; an unknown / deleted account counts as a learner with no courses. */
async function mediaViewer(userId, { fresh = false } = {}) {
  const key = String(userId || '');
  if (!fresh) {
    const cached = cacheGet(mediaViewerCache, key);
    if (cached) return cached;
  }
  if (!ObjectId.isValid(key)) return { isLearner: true, assigned: new Set() };
  const user = await mongoose.connection.db.collection('users').findOne(
    { _id: new ObjectId(key), deletedAt: null }, { projection: { user_type: 1 } },
  );
  const isLearner = !user || user.user_type === LEARNER;
  const viewer = { isLearner, assigned: isLearner && user ? await assignedCourseIdsForUser(key) : new Set() };
  if (user) cacheSet(mediaViewerCache, key, viewer);
  return viewer;
}

/**
 * May this user load this protected upload? Always true for super admins and store owners.
 * A learner needs an assignment to a course that references the file; a file no course
 * references is refused (fails closed — e.g. a differently-cased path never matches).
 * @param {string} userId       from the media / login token
 * @param {string} uploadUrl    the stored form, e.g. '/uploads/lesson-videos/123.mp4'
 */
export async function userMayReadUpload(userId, uploadUrl) {
  const viewer = await mediaViewer(userId);
  if (!viewer.isLearner) return true;
  const owners = await courseIdsOwningUpload(uploadUrl);
  if (!owners.length) return false;
  if (owners.some(id => viewer.assigned.has(id))) return true;
  // The cached assignments may predate a new assignment: check once more before refusing.
  const fresh = await mediaViewer(userId, { fresh: true });
  return owners.some(id => fresh.assigned.has(id));
}
