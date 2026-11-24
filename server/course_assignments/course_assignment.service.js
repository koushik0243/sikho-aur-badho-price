import mongoose from 'mongoose';
import CourseAssignment from './course_assignment.model.js';
import User from '../users/user.model.js';
import { assertCourseAvailable } from '../_helpers/deletedCourse.js';
import { takeSeat, undoTakeSeat } from '../course_seats/course_seat.service.js';

const { ObjectId } = mongoose.Types;

function httpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

/**
 * The organization a learner belongs to — taken from the learner's account, so a request
 * can't charge a course to another organization's seats. Null for a learner with no org.
 */
async function learnerOrgId(userId, requestedOrgId) {
    if (!userId || !ObjectId.isValid(userId)) throw httpError(400, 'A valid learner is required.');
    const learner = await User.findOne({ _id: userId, deletedAt: null }).select('orgId').lean();
    if (!learner) throw httpError(404, 'Learner not found.');
    const orgId = learner.orgId ? String(learner.orgId) : null;
    if (requestedOrgId && String(requestedOrgId) !== orgId) {
        throw httpError(400, 'This learner belongs to a different organization.');
    }
    return orgId;
}

const buildQuery = (filters = {}) => {
    const query = {};
    if (filters.organizationId && ObjectId.isValid(filters.organizationId)) {
        query.organizationId = new ObjectId(filters.organizationId);
    }
    if (filters.userId && ObjectId.isValid(filters.userId)) {
        query.userId = new ObjectId(filters.userId);
    }
    if (filters.courseId && ObjectId.isValid(filters.courseId)) {
        query.courseId = new ObjectId(filters.courseId);
    }
    if (filters.topicId && ObjectId.isValid(filters.topicId)) {
        query.topicId = new ObjectId(filters.topicId);
    }
    if (filters.passed !== undefined) {
        query.passed = filters.passed === 'true' || filters.passed === true;
    }
    return query;
};

// Assigning a course to an organization's learner uses one of the learner seats the
// organization bought for that course (course_seats). With no seat left it is refused.
// The seat stays used even if the course is later removed from the learner.
export const createCourseAssignment = async (data) => {
    if (!data.courseId || !ObjectId.isValid(data.courseId)) throw httpError(400, 'A valid course is required.');
    await assertCourseAvailable(data.courseId); // a deleted course can't be assigned
    const orgId = await learnerOrgId(data.userId, data.organizationId);

    const already = await CourseAssignment.exists({ userId: new ObjectId(String(data.userId)), courseId: new ObjectId(String(data.courseId)) });
    if (already) throw httpError(409, 'This course is already assigned to this learner.');

    if (orgId) await takeSeat(orgId, data.courseId);
    try {
        return await new CourseAssignment({
            organizationId: orgId,
            userId: data.userId,
            topicId: data.topicId,
            courseId: data.courseId,
            answers: data.answers || {},
            score: data.score || 0,
            passed: data.passed !== undefined ? data.passed : false,
            attemptedAt: data.attemptedAt || new Date()
        }).save();
    } catch (error) {
        if (orgId) await undoTakeSeat(orgId, data.courseId); // nothing was assigned
        throw error;
    }
};

/**
 * Which of `courseIds` the learner is already assigned: { assigned: [courseId] }.
 * With `orgId`, the learner must belong to that organization (else 404).
 */
export const findAssignedCourses = async ({ userId, courseIds, orgId = null }) => {
    if (!userId || !ObjectId.isValid(String(userId))) throw httpError(400, 'A valid learner is required.');
    const ids = courseIds.filter(id => ObjectId.isValid(String(id)));
    if (!ids.length || ids.length !== courseIds.length) throw httpError(400, 'Valid courses are required.');
    const learner = await User.findOne({ _id: new ObjectId(String(userId)), deletedAt: null }).select('orgId').lean();
    if (!learner || (orgId && String(learner.orgId || '') !== String(orgId))) throw httpError(404, 'Learner not found.');
    const assigned = await CourseAssignment.distinct('courseId', {
        userId: learner._id,
        courseId: { $in: ids.map(id => new ObjectId(String(id))) },
    });
    return { assigned: assigned.map(String) };
};

export const editCourseAssignment = async (editId) => {
    try {
        return await CourseAssignment.findById(editId)
            .populate('organizationId', '_id name org_name')
            .populate('userId', '_id name email emp_id')
            .populate('topicId', '_id title')
            .populate('courseId', '_id title status deletedAt')
            .lean();
    } catch (error) {
        throw error;
    }
};

export const updateCourseAssignment = async (updateId, data) => {
    try {
        // Which learner, course and organization an assignment is for can't change: that
        // would move a used seat without the seat count knowing. Assign a new course instead.
        if (data.organizationId !== undefined || data.userId !== undefined || data.courseId !== undefined) {
            throw httpError(400, 'The learner, course or organization of an assignment can’t be changed. Remove it and assign the course again.');
        }
        const updateFields = {};
        if (data.topicId !== undefined) updateFields.topicId = data.topicId;
        if (data.answers !== undefined) updateFields.answers = data.answers;
        if (data.score !== undefined) updateFields.score = data.score;
        if (data.passed !== undefined) updateFields.passed = data.passed;
        if (data.attemptedAt !== undefined) updateFields.attemptedAt = data.attemptedAt;

        if (Object.keys(updateFields).length === 0) {
            return await CourseAssignment.findById(updateId)
                .populate('organizationId', '_id name org_name')
                .populate('userId', '_id name email emp_id')
                .populate('topicId', '_id title')
                .populate('courseId', '_id title status deletedAt')
                .lean();
        }

        return await CourseAssignment.findByIdAndUpdate(
            updateId,
            { $set: updateFields },
            { returnDocument: 'before', runValidators: true }
        ).lean();
    } catch (error) {
        throw error;
    }
};

export const listCourseAssignment = async (filters = {}, { slim = false } = {}) => {
    try {
        const query = buildQuery(filters);
        // slim: only what the store owner pages read (learner name/email, course title) —
        // a fraction of the payload for an organization with hundreds of learners.
        if (slim) {
            return await CourseAssignment.find(query)
                .select('organizationId userId courseId attemptedAt')
                .populate('userId', '_id name email')
                .populate('courseId', '_id title status deletedAt')
                .sort({ attemptedAt: -1 })
                .lean();
        }
        return await CourseAssignment.find(query)
            .populate('organizationId', '_id name org_name')
            .populate('userId', '_id name email emp_id')
            .populate('topicId', '_id title')
            .populate('courseId', '_id title status deletedAt')
            .sort({ attemptedAt: -1 })
            .lean();
    } catch (error) {
        throw error;
    }
};

/** Number of distinct learners a course is assigned to (all organizations). */
export const countCourseLearners = async (courseId) => {
    if (!courseId || !ObjectId.isValid(courseId)) throw httpError(400, 'A valid course is required.');
    const ids = await CourseAssignment.distinct('userId', { courseId: new ObjectId(String(courseId)) });
    return ids.length;
};

/**
 * Distinct learners per course within one organization (store owner My Courses and its
 * course detail page), so the pages no longer download every assignment to count them.
 * Learners whose account no longer exists are not counted — the pages used to drop them
 * too, as their populated learner came back empty.
 * @param {{ orgId?: string|null, courseId?: string }} options  orgId null = all organizations
 * @returns {Promise<Record<string, number>>} { courseId: learnerCount }, courses with none omitted
 */
export const countLearnersPerCourse = async ({ orgId = null, courseId } = {}) => {
    const match = {};
    if (orgId) {
        if (!ObjectId.isValid(String(orgId))) throw httpError(400, 'A valid organization is required.');
        match.organizationId = new ObjectId(String(orgId));
    }
    if (courseId !== undefined) {
        if (!ObjectId.isValid(String(courseId))) throw httpError(400, 'A valid course is required.');
        match.courseId = new ObjectId(String(courseId));
    }
    const rows = await CourseAssignment.aggregate([
        { $match: match },
        // One row per learner with their courses, so each learner is looked up only once.
        { $group: { _id: '$userId', courses: { $addToSet: '$courseId' } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user', pipeline: [{ $project: { _id: 1 } }] } },
        { $match: { 'user.0': { $exists: true } } },
        { $unwind: '$courses' },
        { $match: { courses: { $ne: null } } },
        { $group: { _id: '$courses', learners: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map(r => [String(r._id), r.learners]));
};

export const listCourseAssignmentPagination = async (page, limit, filters = {}) => {
    try {
        const query = buildQuery(filters);
        return await CourseAssignment.find(query)
            .populate('organizationId', '_id name org_name')
            .populate('userId', '_id name email emp_id')
            .populate('topicId', '_id title')
            .populate('courseId', '_id title status deletedAt')
            .sort({ attemptedAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();
    } catch (error) {
        throw error;
    }
};

export const getCourseAssignmentCount = async (filters = {}) => {
    try {
        const query = buildQuery(filters);
        return await CourseAssignment.countDocuments(query);
    } catch (error) {
        throw error;
    }
};

export const deleteCourseAssignment = async (delId) => {
    try {
        return await CourseAssignment.findByIdAndDelete(delId).lean();
    } catch (error) {
        throw error;
    }
};
