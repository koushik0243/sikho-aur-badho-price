import express from 'express';
import mongoose from 'mongoose';
import * as Service from './progress.service.js';
import { requester, STORE_OWNER } from '../middleware/accountAccess.js';
import {
  assertLearnerCanAccessCourse, assertLearnerCanAccessTopic, isLearnerRequest, courseNotFoundError,
} from '../_helpers/learnerCourseAccess.js';

const Router = express.Router();

const update = async (req, res, next) => {
  try {
    const { topicId, courseId, watchedSeconds, durationSeconds, lastPosition } = req.body;
    if (!topicId || !courseId) {
      return res.status(400).json({ status: 400, message: 'topicId and courseId are required.' });
    }
    // Progress is recorded only on a lesson of a course assigned to this learner.
    await assertLearnerCanAccessCourse(req, courseId);
    await assertLearnerCanAccessTopic(req, topicId);
    const data = await Service.updateProgress({
      userId: req.user._id,
      topicId, courseId,
      watchedSeconds:  Number(watchedSeconds)  || 0,
      durationSeconds: Number(durationSeconds) || 0,
      lastPosition:    Number(lastPosition)    ?? Number(watchedSeconds) ?? 0,
    });
    res.status(200).json({ status: 200, message: 'Progress saved.', data });
  } catch (error) {
    next(error);
  }
};

const courseProgress = async (req, res, next) => {
  try {
    const { courseId } = req.query;
    if (!courseId) return res.status(400).json({ status: 400, message: 'courseId is required.' });
    await assertLearnerCanAccessCourse(req, courseId);
    const data = await Service.getCourseProgress({ userId: req.user._id, courseId });
    res.status(200).json({ status: 200, message: 'Success.', data });
  } catch (error) {
    next(error);
  }
};

// Admin-scoped: lets a store owner look up any learner's progress for a course.
const courseProgressAdmin = async (req, res, next) => {
  try {
    const { courseId, userId } = req.query;
    if (!courseId || !userId) {
      return res.status(400).json({ status: 400, message: 'courseId and userId are required.' });
    }
    // The router lets learners read; a learner may use this only for themselves, on an
    // assigned course — never to look up another learner's progress.
    if (await isLearnerRequest(req) && String(userId) !== String(req.user._id)) throw courseNotFoundError();
    await assertLearnerCanAccessCourse(req, courseId);
    // A store owner may only read their own organization's learners.
    const me = await requester(req);
    if (me?.user_type === STORE_OWNER) {
      const learner = mongoose.isValidObjectId(userId)
        ? await mongoose.connection.db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(String(userId)) }, { projection: { orgId: 1 } })
        : null;
      if (!learner || !me.orgId || String(learner.orgId || '') !== me.orgId) {
        return res.status(404).json({ status: 404, message: 'Learner not found.' });
      }
    }
    const data = await Service.getCourseProgress({ userId, courseId });
    res.status(200).json({ status: 200, message: 'Success.', data });
  } catch (error) {
    next(error);
  }
};

Router.post('/update',       update);
Router.get('/course',        courseProgress);
Router.get('/course-admin',  courseProgressAdmin);

export default Router;
