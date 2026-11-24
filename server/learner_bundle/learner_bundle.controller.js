import express from 'express';
import mongoose from 'mongoose';
import { requester } from '../middleware/accountAccess.js';
import { assertLearnerCanAccessCourse } from '../_helpers/learnerCourseAccess.js';
import { listCourseAssignment, countCourseLearners } from '../course_assignments/course_assignment.service.js';
import { listCoursesFor, getCourseForViewer } from '../courses/course.controller.js';
import { listOrganizationCourse } from '../organization_course/organization_course.service.js';
import { listActivity } from '../activity_log/activity_log.service.js';
import { getMyProgressReport } from '../reports/my_report.controller.js';
import { listChapter } from '../chapters/chapter.service.js';
import { listTopic } from '../topics/topic.service.js';
import { getCourseStats } from '../reviews/review.service.js';
import { getCourseProgress } from '../progress/progress.service.js';
import { getAttemptsByCourse } from '../quiz_attempts/quiz_attempt.service.js';
import { getCourseLockStatus } from '../quiz_attempts/quiz_attempt.controller.js';
import { getCompletion } from '../course_completions/course_completion.service.js';
import { listMyCourseActivity } from '../topic_activity/topic_activity.controller.js';
import { listAttempts as listAptitudeAttempts } from '../aptitude_attempts/aptitude_attempt.service.js';
import { cachedReport } from '../_helpers/reportCache.js';

// The organization's course list is the same for every learner of that organization, so the
// dashboards of an organization's learners share one copy for a short while instead of each
// querying it (it changes only when the organization buys or removes a course).
const orgCoursesShared = cachedReport('learner-bundle:org-courses', 30 * 1000,
  ({ orgId }) => listOrganizationCourse({ orgId }));

// Learner page bundles: everything a learner page needs on open, in ONE request.
//
// The dashboard used to make 5 GETs and the course player 11; under load the per-request
// cost (auth + account lookup per request) dominated. Each key of a bundle holds exactly the
// `data` the matching single endpoint returns, built by the same functions with the same
// access rules — the learner is always the signed-in account, never an id from the request.
// The single endpoints stay: pages still use them to refresh one piece after an action.
//
// Mounted for learners only (app.js: allowAccounts LEARNER).

const Router = express.Router();

/**
 * Waits for every piece; a failed piece comes back null with its error in `errors`, so the
 * page still shows the rest — as it did when each piece was its own request.
 * @param {Record<string, Promise<any>>} pieces  already-started work, by response key
 * @returns {Promise<Record<string, any> & { errors: Record<string, { status: number, message: string }> }>}
 */
async function settlePieces(pieces) {
  const keys = Object.keys(pieces);
  const results = await Promise.allSettled(keys.map(key => pieces[key]));
  const data = {};
  const errors = {};
  results.forEach((result, i) => {
    const key = keys[i];
    if (result.status === 'fulfilled') {
      data[key] = result.value;
      return;
    }
    data[key] = null;
    errors[key] = pieceError(key, result.reason);
  });
  return { ...data, errors };
}

/** The status + message the single endpoint would have answered with (via the app error handler). */
function pieceError(key, error) {
  const status = Number(error?.statusCode) || 500;
  // Expected refusals (400 / 410 …) are part of normal use; anything else is a server fault
  // that would otherwise vanish inside a 200 response, so record it.
  if (status >= 500) console.error(`[learner-bundle] ${key} failed:`, error);
  return { status, message: error?.message || 'Internal server error' };
}

/**
 * The signed-in learner (from the token, looked up by requester). The mount's allowAccounts
 * has already loaded it, so this costs no extra query; null means "sign in again".
 */
async function signedInLearner(req) {
  const me = await requester(req);
  return me && mongoose.isValidObjectId(me._id) ? me : null;
}

const unauthorized = res => res.status(401).json({ status: 401, message: 'Please sign in again.' });

// ── Dashboard ────────────────────────────────────────────────────────────────

/**
 * The dashboard's pieces. Same calls as:
 *   assignments → GET /course-assignment/list   (a learner's filter is always their own id)
 *   courses     → GET /course/list              (a learner sees only assigned courses)
 *   orgCourses  → GET /organization-course/list?orgId=<own org>  (null without an org, as the page did)
 *   activity    → GET /activity-log/list?userId=<own id>
 *   progress    → GET /my-report/progress       (shares that endpoint's short-lived cache)
 */
function dashboardPieces(me) {
  const userId = String(me._id);
  return {
    assignments: listCourseAssignment({ userId }),
    courses: listCoursesFor(me),
    orgCourses: me.orgId ? orgCoursesShared({ orgId: String(me.orgId) }) : Promise.resolve(null),
    activity: listActivity(userId),
    progress: getMyProgressReport({ userId }),
  };
}

// GET /learner-bundle/dashboard
const dashboardBundle = async (req, res, next) => {
  try {
    const me = await signedInLearner(req);
    if (!me) return unauthorized(res);
    const data = await settlePieces(dashboardPieces(me));
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) {
    next(error);
  }
};

// ── Course player ────────────────────────────────────────────────────────────

/** Same rule as the player: an aptitude test is required when it's on and has questions. */
const needsAptitudeTest = course =>
  Boolean(course?.aptitudeEnabled)
  && Array.isArray(course?.aptitudeSelectedQuestionIds)
  && course.aptitudeSelectedQuestionIds.length > 0;

/**
 * The course player's pieces. Same calls as:
 *   course           → GET /course/:id                 (410 for a deleted course)
 *   chapters         → GET /chapter/list?courseId=
 *   topics           → GET /topic/list?courseId=
 *   reviewStats      → GET /review/stats?courseId=
 *   progress         → GET /progress/course?courseId=
 *   quizAttempts     → GET /quiz-attempt/course?courseId=
 *   enrolled         → GET /course-assignment/count?courseId=   ({ learners })
 *   completion       → GET /course-completion?courseId=         (record or null)
 *   activity         → GET /topic-activity/mine?courseId=
 *   locks            → GET /quiz-attempt/lock?courseId=
 *   aptitudeAttempts → GET /aptitude-attempt/list?courseId=     (only when the course requires
 *                      the test — the page asked only then; otherwise null)
 */
function coursePieces(userId, courseId) {
  const course = getCourseForViewer(courseId);
  return {
    course,
    chapters: listChapter({ courseId }),
    topics: listTopic({ courseId }),
    reviewStats: getCourseStats({ courseId }),
    progress: getCourseProgress({ userId, courseId }),
    quizAttempts: getAttemptsByCourse({ userId, courseId, chapterId: null }),
    enrolled: countCourseLearners(courseId).then(learners => ({ learners })),
    completion: getCompletion({ userId, courseId }).then(rec => rec || null),
    activity: listMyCourseActivity({ userId, courseId }),
    locks: getCourseLockStatus({ userId, courseId }),
    // A failed course load is already reported under `course`; don't repeat it here.
    aptitudeAttempts: course.catch(() => null).then(c => (
      needsAptitudeTest(c) ? listAptitudeAttempts({ userId, courseId }) : null
    )),
  };
}

// GET /learner-bundle/course/:courseId
const courseBundle = async (req, res, next) => {
  try {
    const me = await signedInLearner(req);
    if (!me) return unauthorized(res);
    const { courseId } = req.params;
    if (!mongoose.isValidObjectId(courseId)) {
      return res.status(400).json({ status: 400, message: 'Valid courseId is required.' });
    }
    // The whole bundle is refused (404 "Course not found.") for a course not assigned to this
    // learner — no piece of it (chapters, lessons, reviews …) may leak through.
    await assertLearnerCanAccessCourse(req, courseId);
    const data = await settlePieces(coursePieces(String(me._id), courseId));
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) {
    next(error);
  }
};

Router.get('/dashboard', dashboardBundle);
Router.get('/course/:courseId', courseBundle);

export default Router;
