import express from 'express';
import mongoose from 'mongoose';
import * as Service from './quiz_attempt.service.js';
import { requester, SUPERADMIN, STORE_OWNER } from '../middleware/accountAccess.js';
import { assertLearnerCanAccessCourse, assertLearnerCanAccessTopic } from '../_helpers/learnerCourseAccess.js';

const Router = express.Router();

/** Seconds the learner spent (sent by the player): whole seconds up to a day, else not recorded. */
const cleanSeconds = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 86400 ? n : null;
};

const submit = async (req, res, next) => {
  try {
    const { topicId, courseId, chapterId, answers, timeTakenSec } = req.body;
    if (!topicId || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ status: 400, message: 'topicId and answers are required.' });
    }
    // The quiz, and the course named with it, must be assigned to this learner (404 otherwise).
    await assertLearnerCanAccessTopic(req, topicId);
    if (courseId) await assertLearnerCanAccessCourse(req, courseId);
    const attempt = await Service.submitAttempt({
      userId: req.user._id,
      topicId,
      courseId:   courseId  || null,
      chapterId:  chapterId || null,
      answers,
      timeTakenSec: cleanSeconds(timeTakenSec),
    });
    // The quiz is over — free this course's lesson videos right away instead of
    // waiting for the lock to lapse.
    if (courseId && mongoose.isValidObjectId(courseId)) {
      await Service.releaseQuizLock({ userId: req.user._id, courseId });
    }
    res.status(200).json({ status: 200, message: 'Quiz evaluated.', data: attempt });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ status: 403, message: error.message });
    next(error);
  }
};

const history = async (req, res, next) => {
  try {
    const { topicId } = req.query;
    if (!topicId) return res.status(400).json({ status: 400, message: 'topicId is required.' });
    await assertLearnerCanAccessTopic(req, topicId);
    const data = await Service.getAttemptHistory({ userId: req.user._id, topicId });
    res.status(200).json({ status: 200, message: 'Success.', data });
  } catch (error) {
    next(error);
  }
};

const byCourse = async (req, res, next) => {
  try {
    const { courseId, chapterId } = req.query;
    if (!courseId) return res.status(400).json({ status: 400, message: 'courseId is required.' });
    await assertLearnerCanAccessCourse(req, courseId);
    const data = await Service.getAttemptsByCourse({
      userId:    req.user._id,
      courseId,
      chapterId: chapterId || null,
    });
    res.status(200).json({ status: 200, message: 'Success.', data });
  } catch (error) {
    next(error);
  }
};

// Every learner's attempts on a course: the super admin sees all organizations, a store owner
// only their own organization's learners, a learner nothing (they use GET /course).
const byCourseAdmin = async (req, res, next) => {
  try {
    const { courseId, userId } = req.query;
    if (!courseId || !mongoose.isValidObjectId(courseId)) return res.status(400).json({ status: 400, message: 'courseId is required.' });
    if (userId !== undefined && !mongoose.isValidObjectId(userId)) return res.status(400).json({ status: 400, message: 'Invalid learner.' });
    const me = await requester(req);
    let userIds = null;
    if (me?.user_type === STORE_OWNER) {
      if (!me.orgId) return res.status(200).json({ status: 200, message: 'Success.', data: [] });
      userIds = await mongoose.connection.db.collection('users')
        .distinct('_id', { orgId: new mongoose.Types.ObjectId(String(me.orgId)) });
    } else if (me?.user_type !== SUPERADMIN) {
      return res.status(403).json({ status: 403, message: 'Your account does not have access to this.' });
    }
    // ?userId= narrows the list to one learner (still within the owner's organization).
    if (userId) {
      const wanted = String(userId);
      userIds = userIds ? userIds.filter(id => String(id) === wanted) : [new mongoose.Types.ObjectId(wanted)];
    }
    const data = await Service.getAttemptsByCourseAdmin({ courseId, userIds });
    res.status(200).json({ status: 200, message: 'Success.', data });
  } catch (error) {
    next(error);
  }
};

// ── Quiz / video activity locks ──────────────────────────────────────────────
// A quiz in progress locks the course's lesson videos for this learner, and a
// playing lesson video locks the course's quizzes. ownerId identifies the
// holding browser tab so it can ignore its own lock.
const OWNER_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const cleanOwnerId = (v) => (typeof v === 'string' && OWNER_ID_RE.test(v) ? v : null);

const makeLockHeartbeat = (acquire) => async (req, res, next) => {
  try {
    const { courseId, topicId, ownerId } = req.body;
    if (!mongoose.isValidObjectId(courseId) || !mongoose.isValidObjectId(topicId)) {
      return res.status(400).json({ status: 400, message: 'Valid courseId and topicId are required.' });
    }
    // Locks are taken only on a course assigned to this learner (404 otherwise).
    await assertLearnerCanAccessCourse(req, courseId);
    const data = await acquire({ userId: req.user._id, courseId, topicId, ownerId: cleanOwnerId(ownerId) });
    res.status(200).json({ status: 200, message: 'Locked.', data });
  } catch (error) {
    next(error);
  }
};

const makeUnlock = (release) => async (req, res, next) => {
  try {
    const { courseId, ownerId } = req.body;
    if (!mongoose.isValidObjectId(courseId)) {
      return res.status(400).json({ status: 400, message: 'Valid courseId is required.' });
    }
    await assertLearnerCanAccessCourse(req, courseId);
    await release({ userId: req.user._id, courseId, ownerId: cleanOwnerId(ownerId) });
    res.status(200).json({ status: 200, message: 'Unlocked.' });
  } catch (error) {
    next(error);
  }
};

const toLockInfo = (lock) => ({
  active:  !!lock,
  topicId: lock?.topicId || null,
  ownerId: lock?.ownerId || null,
});

/**
 * The learner's quiz / video locks on a course, as GET /lock returns them (also used by the
 * learner course bundle). The quiz lock is also spread at the top level for older clients.
 */
export async function getCourseLockStatus({ userId, courseId }) {
  const [quizLock, videoLock] = await Promise.all([
    Service.getQuizLock({ userId, courseId }),
    Service.getVideoLock({ userId, courseId }),
  ]);
  const quiz = toLockInfo(quizLock);
  return { ...quiz, quiz, video: toLockInfo(videoLock) };
}

const lockStatus = async (req, res, next) => {
  try {
    const { courseId } = req.query;
    if (!mongoose.isValidObjectId(courseId)) {
      return res.status(400).json({ status: 400, message: 'Valid courseId is required.' });
    }
    await assertLearnerCanAccessCourse(req, courseId);
    res.status(200).json({
      status: 200,
      message: 'Success.',
      data: await getCourseLockStatus({ userId: req.user._id, courseId }),
    });
  } catch (error) {
    next(error);
  }
};

Router.post('/submit',       submit);
Router.post('/lock',         makeLockHeartbeat(Service.heartbeatQuizLock));
Router.post('/unlock',       makeUnlock(Service.releaseQuizLock));
Router.post('/video-lock',   makeLockHeartbeat(Service.acquireVideoLock));
Router.post('/video-unlock', makeUnlock(Service.releaseVideoLock));
Router.get('/lock',          lockStatus);
Router.get('/history',       history);
Router.get('/course',        byCourse);
Router.get('/course-all',    byCourseAdmin);

export default Router;
