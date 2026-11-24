import mongoose from 'mongoose';
import Order from './order.model.js';
import Course from '../courses/course.model.js';
// The organization's courses (what My Courses and "organization-course/list" read).
import OrganizationCourse from '../organization_course/organization_course.model.js';
import Organization from '../organizations/organization.model.js';
import Invoice from '../invoices/invoice.model.js';
import { ensureSeatRecord, addPurchasedSeats } from '../course_seats/course_seat.service.js';

// Store owner cart checkout: courses × number of learners. Prices always come from the
// course (course_price = Price Per Learner), never from the request. Payment is skipped
// for now, so the order is recorded as successful straight away.
//
// The order keeps each course's title and price as they were at checkout (items[]), so a
// later change to the course's price never changes what the organization paid. Every
// purchase also adds learner seats (course_seats) and gets a paid invoice.

export const MAX_CART_ITEMS = 50;
export const MAX_LEARNERS_PER_ITEM = 10000;
const PAYMENT_GATEWAY = 'none'; // no payment step yet

const { ObjectId } = mongoose.Types;

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

const toRupees = (decimal) => {
    const n = Number(decimal?.toString?.() ?? decimal ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

/** [{ courseId, learners }] → validated, one entry per course (repeats are added up). */
export function parseCartItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) throw badRequest('Please select at least one course.');
    if (rawItems.length > MAX_CART_ITEMS) throw badRequest(`A single order can have at most ${MAX_CART_ITEMS} courses.`);

    const learnersByCourse = new Map();
    for (const item of rawItems) {
        const courseId = String(item?.courseId ?? '');
        const learners = Number(item?.learners);
        if (!ObjectId.isValid(courseId)) throw badRequest('One of the selected courses is not valid.');
        if (!Number.isInteger(learners) || learners < 1 || learners > MAX_LEARNERS_PER_ITEM) {
            throw badRequest(`Number of learners must be a whole number from 1 to ${MAX_LEARNERS_PER_ITEM}.`);
        }
        learnersByCourse.set(courseId, (learnersByCourse.get(courseId) || 0) + learners);
    }
    for (const learners of learnersByCourse.values()) {
        if (learners > MAX_LEARNERS_PER_ITEM) {
            throw badRequest(`Number of learners must be a whole number from 1 to ${MAX_LEARNERS_PER_ITEM}.`);
        }
    }
    return [...learnersByCourse].map(([courseId, learners]) => ({ courseId, learners }));
}

/** Priced order lines for published, non-deleted courses; throws if any course isn't available. */
async function priceItems(items) {
    const courses = await Course.find({
        _id: { $in: items.map(i => new ObjectId(i.courseId)) },
        status: 'published',
        deletedAt: null,
    }).select('_id title course_price').lean();
    const byId = new Map(courses.map(c => [String(c._id), c]));

    const missing = items.filter(i => !byId.has(i.courseId));
    if (missing.length) {
        throw badRequest(`${missing.length} of the selected courses ${missing.length !== 1 ? 'are' : 'is'} no longer available. Please remove ${missing.length !== 1 ? 'them' : 'it'} and try again.`);
    }

    // No course is free: one without a price above 0 can't be bought until a super admin
    // sets its Price Per Learner in the course builder.
    const unpriced = items.map(i => byId.get(i.courseId)).filter(c => !(toRupees(c.course_price) > 0));
    if (unpriced.length) {
        const titles = unpriced.map(c => `"${c.title}"`).join(', ');
        throw badRequest(`${titles} ${unpriced.length !== 1 ? 'have' : 'has'} no price yet. Set the Price Per Learner in the course builder before selling ${unpriced.length !== 1 ? 'them' : 'it'}.`);
    }

    return items.map(({ courseId, learners }) => {
        const course = byId.get(courseId);
        const unitPrice = toRupees(course.course_price);
        return {
            courseId: course._id,
            title: course.title,
            unit_price: unitPrice,
            learners,
            line_total: round2(unitPrice * learners),
        };
    });
}

/** Adds the purchased courses to the organization's courses (and re-activates inactive ones). */
async function addCoursesToOrg({ orgId, courseIds }) {
    const orgOid = new ObjectId(orgId);
    const existing = await OrganizationCourse.find({ orgId: orgOid, courseId: { $in: courseIds }, deletedAt: null })
        .select('courseId status').lean();
    const have = new Set(existing.map(a => String(a.courseId)));
    const inactive = existing.filter(a => a.status !== 'active').map(a => a._id);
    if (inactive.length) {
        await OrganizationCourse.updateMany({ _id: { $in: inactive } }, { $set: { status: 'active', updatedAt: new Date() } });
    }
    const toAdd = courseIds.filter(id => !have.has(String(id)));
    if (toAdd.length) {
        await OrganizationCourse.insertMany(toAdd.map(courseId => ({ orgId: orgOid, courseId, status: 'active' })));
    }
}

export const PAYMENT_MODES = ['online', 'offline'];
const MAX_PAYMENT_DETAILS = 2000;

/** Payment mode + details entered by the super admin: both required. */
export function parsePayment({ paymentMode, paymentDetails } = {}) {
    const mode = String(paymentMode ?? '').trim().toLowerCase();
    if (!PAYMENT_MODES.includes(mode)) throw badRequest('Please select a payment mode (Online or Offline).');
    const details = String(paymentDetails ?? '').trim();
    if (!details) throw badRequest('Please enter the payment details.');
    if (details.length > MAX_PAYMENT_DETAILS) throw badRequest(`Payment details can be at most ${MAX_PAYMENT_DETAILS} characters.`);
    return { mode, details };
}

/**
 * Saves a course order for a cart, priced from the courses (not yet carried out — see
 * fulfilCourseOrder). `status` is 'pending' while it waits for an online payment.
 * @param {{ orgId: string, items: Array<{ courseId: string, learners: number }>, gateway: string,
 *           payment?: { mode: string, details: string } | null }} input
 */
export async function createCourseOrder({ orgId, items: rawItems, gateway, payment = null }) {
    if (!orgId || !ObjectId.isValid(orgId)) throw badRequest('Your account is not linked to an organization.');
    const items = await priceItems(parseCartItems(rawItems));
    const total = round2(items.reduce((sum, i) => sum + i.line_total, 0));

    // Seat records first: one created later would count this order's learners from the
    // order AND from fulfilCourseOrder's increment.
    await Promise.all(items.map(i => ensureSeatRecord(orgId, i.courseId)));

    return (await new Order({
        organizer_id: orgId,
        order_type: 'course',
        items,
        credit_amount: total,
        purchase_date: new Date(),
        payment_gateway: gateway,
        payment_mode: payment?.mode || null,
        payment_details: payment?.details || null,
        status: 'pending',
    }).save()).toObject();
}

/**
 * Carries out a paid course order: marks it successful, adds the learners and courses to the
 * organization, and creates the paid invoice. Runs at most once per order (fulfilled_at), so a
 * payment confirmed by both the browser and the webhook is never added twice.
 * @param {string} orderId
 * @param {object} [set] extra order fields to save (e.g. the Razorpay payment id)
 * @returns {Promise<object|null>} the order, or null if it doesn't exist
 */
export async function fulfilCourseOrder(orderId, set = {}) {
    const now = new Date();
    const order = await Order.findOneAndUpdate(
        { _id: orderId, order_type: 'course', deletedAt: null, fulfilled_at: null },
        { $set: { ...set, status: 'success', fulfilled_at: now, purchase_date: now, updatedAt: now } },
        { returnDocument: 'after' },
    ).lean();
    if (!order) return Order.findById(orderId).lean(); // already carried out (or not found)

    const orgId = String(order.organizer_id);
    await Promise.all(order.items.map(i => addPurchasedSeats(orgId, i.courseId, i.learners)));
    await addCoursesToOrg({ orgId, courseIds: order.items.map(i => i.courseId) });
    await createPaidInvoice(order);
    return order;
}

/**
 * Checks out a cart of courses for an organization straight away (no online payment):
 * the super admin's purchase with the payment it recorded.
 * @param {{ orgId: string, items: Array<{ courseId: string, learners: number }>, payment?: { mode: string, details: string } }} input
 */
export async function purchaseCourses({ orgId, items, payment = null }) {
    const order = await createCourseOrder({ orgId, items, gateway: payment ? payment.mode : PAYMENT_GATEWAY, payment });
    return fulfilCourseOrder(order._id);
}

/** A paid invoice for a course order, billed to the organization (same as credit purchases). */
async function createPaidInvoice(order) {
    const org = await Organization.findById(order.organizer_id).lean();
    const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    await new Invoice({
        org_id:         order.organizer_id,
        order_id:       order._id,
        invoice_no:     `INV-${Date.now()}-${rand}`,
        currency:       'INR',
        sub_total:      order.credit_amount,
        discount:       0,
        tax:            0,
        total_amount:   order.credit_amount,
        payment_status: 'paid',
        payment_method: order.razorpay_payment_id ? 'razorpay' : (order.payment_mode || PAYMENT_GATEWAY),
        payment_details: order.payment_details || null,
        transaction_id: order.razorpay_payment_id || null,
        payment_date:   order.purchase_date,
        bill_name:      org?.org_name     || null,
        bill_email:     org?.org_email    || null,
        bill_phone:     org?.org_phone    || null,
        bill_addr:      org?.org_address1 || org?.org_address2 || null,
        bill_city:      org?.org_city     || null,
        bill_state:     org?.org_state    || null,
        bill_country:   org?.org_country  || null,
        bill_pincode:   org?.org_zipcode  || null,
        status:         'active',
    }).save();
}

/**
 * Super admin "Edit Organization Course": changes how a course order was paid. Only the
 * payment mode and details change — never the courses, learners or amounts. The order's
 * invoice is updated to match.
 * @param {{ orderId: string, paymentMode: string, paymentDetails: string }} input
 */
export async function updateCourseOrderPayment({ orderId, paymentMode, paymentDetails }) {
    if (!orderId || !ObjectId.isValid(orderId)) throw badRequest('A valid order is required.');
    const payment = parsePayment({ paymentMode, paymentDetails });
    const order = await Order.findOneAndUpdate(
        { _id: orderId, order_type: 'course', deletedAt: null },
        { $set: { payment_mode: payment.mode, payment_details: payment.details, payment_gateway: payment.mode, updatedAt: new Date() } },
        { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!order) {
        const err = new Error('Course order not found.');
        err.statusCode = 404;
        throw err;
    }
    await Invoice.updateMany(
        { order_id: order._id, deletedAt: null },
        { $set: { payment_method: payment.mode, payment_details: payment.details, updatedAt: new Date() } },
    );
    return order;
}

/**
 * Super admin "Add / Edit Organization Course" → Payment page: buys the courses for `orgId`
 * exactly as if the organization had checked out its own cart — same order, seats and
 * invoice; nothing on them records the super admin. The payment mode and details are required.
 * @param {{ orgId: string, items: Array<{ courseId: string, learners: number }>, paymentMode: string, paymentDetails: string }} input
 */
export async function purchaseCoursesForOrganization({ orgId, items, paymentMode, paymentDetails }) {
    if (!orgId || !ObjectId.isValid(orgId)) throw badRequest('Please select an organization.');
    const payment = parsePayment({ paymentMode, paymentDetails });
    const org = await Organization.findOne({ _id: orgId, deletedAt: null, status: { $ne: 'deleted' } })
        .select('_id').lean();
    if (!org) throw badRequest('This organization was not found. Please select another one.');
    return purchaseCourses({ orgId: String(org._id), items, payment });
}
