import mongoose from 'mongoose';
import CourseSeat from './course_seat.model.js';
import Order from '../orders/order.model.js';
import CourseAssignment from '../course_assignments/course_assignment.model.js';
// The organization's courses (what "organization-course/list" and My Courses read).
import OrganizationCourse from '../organization_course/organization_course.model.js';

const { ObjectId } = mongoose.Types;
const toId = (v) => new ObjectId(String(v));

function httpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

/** Learners bought for a course in the organization's successful course orders. */
async function purchasedFromOrders(orgId, courseId) {
    const [row] = await Order.aggregate([
        { $match: { organizer_id: toId(orgId), order_type: 'course', status: 'success', deletedAt: null } },
        { $unwind: '$items' },
        { $match: { 'items.courseId': toId(courseId) } },
        { $group: { _id: null, learners: { $sum: '$items.learners' } } },
    ]);
    return row?.learners || 0;
}

/**
 * The seat record for an organization's course, created on first use from what already
 * happened: learners bought in earlier orders, and learners the course is assigned to now.
 * Call it BEFORE saving a new order or assignment (afterwards they'd be counted twice).
 */
export async function ensureSeatRecord(orgId, courseId) {
    const key = { orgId: toId(orgId), courseId: toId(courseId) };
    const existing = await CourseSeat.findOne(key).lean();
    if (existing) return existing;
    const [purchased, used] = await Promise.all([
        purchasedFromOrders(orgId, courseId),
        CourseAssignment.countDocuments({ organizationId: key.orgId, courseId: key.courseId }),
    ]);
    try {
        return (await CourseSeat.create({ ...key, purchased, used })).toObject();
    } catch (err) {
        if (err?.code === 11000) return CourseSeat.findOne(key).lean(); // created at the same moment
        throw err;
    }
}

/** Adds bought learners (after a course purchase order is saved). */
export async function addPurchasedSeats(orgId, courseId, learners) {
    await CourseSeat.updateOne({ orgId: toId(orgId), courseId: toId(courseId) }, { $inc: { purchased: learners } });
}

/**
 * Uses one seat for a learner assignment. Atomic: succeeds only while purchased > used, so
 * two assignments at the same moment can never take the last seat twice.
 */
export async function takeSeat(orgId, courseId) {
    await ensureSeatRecord(orgId, courseId);
    const taken = await CourseSeat.findOneAndUpdate(
        { orgId: toId(orgId), courseId: toId(courseId), $expr: { $gt: ['$purchased', '$used'] } },
        { $inc: { used: 1 } },
        { returnDocument: 'after' },
    ).lean();
    if (!taken) {
        throw httpError(409, 'No learners are available for this course. Buy more learners for it before assigning it.');
    }
    return taken;
}

/** Gives a seat back — only when the assignment it was taken for could not be saved. */
export async function undoTakeSeat(orgId, courseId) {
    await CourseSeat.updateOne({ orgId: toId(orgId), courseId: toId(courseId), used: { $gt: 0 } }, { $inc: { used: -1 } });
}

/** Price per learner paid in the organization's course orders, per course (newest order first). */
async function pricesPaid(orgId) {
    const rows = await Order.aggregate([
        { $match: { organizer_id: toId(orgId), order_type: 'course', status: 'success', deletedAt: null } },
        { $sort: { purchase_date: -1, createdAt: -1 } },
        { $unwind: '$items' },
        { $group: {
            _id: '$items.courseId',
            last: { $first: '$items.unit_price' },
            min: { $min: '$items.unit_price' },
            max: { $max: '$items.unit_price' },
        } },
    ]);
    return new Map(rows.map(r => [String(r._id), { last: r.last, min: r.min, max: r.max }]));
}

/**
 * Seats for every organization's courses (super admin Organization Course list):
 * [{ orgId, courseId, purchased, used, available }].
 */
export async function listAllSeats() {
    const orgCourses = await OrganizationCourse.find({ deletedAt: null }).select('orgId courseId').lean();
    const pairs = new Map();
    for (const oc of orgCourses) {
        if (oc.orgId && oc.courseId) pairs.set(`${oc.orgId}|${oc.courseId}`, oc);
    }
    const seats = await Promise.all([...pairs.values()].map(oc => ensureSeatRecord(oc.orgId, oc.courseId)));
    return seats.filter(Boolean).map(seat => {
        const purchased = seat.purchased || 0;
        const used = seat.used || 0;
        return { orgId: String(seat.orgId), courseId: String(seat.courseId), purchased, used, available: Math.max(0, purchased - used) };
    });
}

/**
 * Seats for every course the organization has:
 * [{ courseId, title, level, purchased, used, available, price }].
 * `price` is what the organization paid per learner (from its orders — never the course's
 * current price), or null if it never bought the course.
 */
export async function listOrgSeats(orgId) {
    if (!orgId || !ObjectId.isValid(orgId)) throw httpError(400, 'A valid organization is required.');
    const orgCourses = await OrganizationCourse.find({ orgId: toId(orgId), deletedAt: null })
        .select('courseId').populate('courseId', '_id title level').lean();
    const courseById = new Map();
    for (const oc of orgCourses) {
        const cid = String(oc.courseId?._id ?? oc.courseId ?? '');
        if (cid && !courseById.has(cid)) courseById.set(cid, oc.courseId);
    }
    const seats = await Promise.all([...courseById.keys()].map(cid => ensureSeatRecord(orgId, cid)));
    const prices = await pricesPaid(orgId);
    return seats.map(seat => {
        const purchased = seat?.purchased || 0;
        const used = seat?.used || 0;
        const cid = String(seat.courseId);
        const course = courseById.get(cid);
        return {
            courseId: cid,
            title: course?.title || '—',
            level: course?.level || null,
            purchased, used,
            available: Math.max(0, purchased - used),
            price: prices.get(cid) || null,
        };
    });
}
