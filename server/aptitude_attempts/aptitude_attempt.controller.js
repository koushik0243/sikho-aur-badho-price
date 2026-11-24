import express from 'express';
import * as Service from './aptitude_attempt.service.js';
import { assertLearnerCanAccessCourse } from '../_helpers/learnerCourseAccess.js';

const Router = express.Router();

/** Seconds the learner spent (sent by the player): whole seconds up to a day, else not recorded. */
const cleanSeconds = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 86400 ? n : null;
};

const submit = async (req, res, next) => {
  try {
    const { courseId, answers, timeTakenSec } = req.body;
    if (!courseId || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ status: 400, message: 'courseId and answers are required.' });
    }
    // The aptitude test counts only for a course assigned to this learner (404 otherwise).
    await assertLearnerCanAccessCourse(req, courseId);
    const attempt = await Service.submitAttempt({
      userId: req.user._id,
      courseId,
      answers,
      timeTakenSec: cleanSeconds(timeTakenSec),
    });
    res.status(200).json({ status: 200, message: 'Aptitude test evaluated.', data: attempt });
  } catch (error) {
    next(error);
  }
};

const list = async (req, res, next) => {
  try {
    const { courseId } = req.query;
    // Without a courseId this is the learner's own attempts on every course; with one, the
    // course must be assigned to them.
    if (courseId) await assertLearnerCanAccessCourse(req, courseId);
    const data = await Service.listAttempts({ userId: req.user._id, courseId: courseId || null });
    res.status(200).json({ status: 200, message: 'Success.', data });
  } catch (error) {
    next(error);
  }
};

Router.post('/submit', submit);
Router.get('/list',     list);

export default Router;
