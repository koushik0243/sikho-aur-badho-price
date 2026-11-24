import mongoose from 'mongoose';
import Order from './order.model.js';
import Organization from '../organizations/organization.model.js';
import { createCourseOrder, fulfilCourseOrder } from './order.course_purchase.js';
import { createRazorpayOrder, isValidPaymentSignature, razorpayPublicConfig } from './razorpay.js';

// Store owner cart → Razorpay Checkout.
//  1. start:   the cart is priced here and saved as a 'pending' order; a Razorpay order is
//              created for exactly that amount. Nothing is added to the organization yet.
//  2. confirm: after Checkout, the payment signature is verified, then the order is carried
//              out (learners, courses, invoice). The webhook (handleRazorpayWebhook) does the
//              same if the browser never comes back — whichever arrives first wins, once.
//  3. cancel:  the learner closed Checkout without paying → the pending order is canceled.

const { ObjectId } = mongoose.Types;
const GATEWAY = 'razorpay';

function httpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

/** The organization's pending/finished course order paid through Razorpay. */
async function findOwnOrder(orgId, orderId) {
    if (!orderId || !ObjectId.isValid(orderId)) throw httpError(400, 'A valid order is required.');
    const order = await Order.findOne({ _id: orderId, organizer_id: orgId, order_type: 'course', payment_gateway: GATEWAY, deletedAt: null }).lean();
    if (!order) throw httpError(404, 'Order not found.');
    return order;
}

// A Razorpay checkout left unfinished (tab closed, browser crashed) never tells the server,
// so its order would stay "Pending" for good. After this long it is marked canceled. That is
// safe: if Razorpay later reports a payment for it, it is still completed (fulfilCourseOrder
// ignores the status; the webhook and the browser's confirm both use it).
const STALE_CHECKOUT_MS = 30 * 60 * 1000;

/** Marks unfinished Razorpay checkouts older than 30 minutes as canceled (one org, or all). */
export async function expireStaleCheckouts(orgId = null) {
    const filter = {
        payment_gateway: GATEWAY, order_type: 'course', status: 'pending', fulfilled_at: null,
        createdAt: { $lt: new Date(Date.now() - STALE_CHECKOUT_MS) },
    };
    if (orgId) {
        if (!ObjectId.isValid(String(orgId))) return;
        filter.organizer_id = new ObjectId(String(orgId));
    }
    await Order.updateMany(filter, { $set: { status: 'canceled', updatedAt: new Date() } });
}

/**
 * Name, email and mobile shown pre-filled in Razorpay Checkout (so the payer doesn't have to
 * type them): the organization's own details, else its owner's account details.
 */
async function checkoutPrefill(orgId) {
    const org = await Organization.findById(orgId).select('org_name org_email org_phone ownerId').lean();
    const needOwner = !org?.org_email || !org?.org_phone;
    const owner = needOwner && org?.ownerId
        ? await mongoose.connection.db.collection('users').findOne(
            { _id: new ObjectId(String(org.ownerId)) }, { projection: { email: 1, phone: 1, whatsapp_no: 1 } })
        : null;
    return {
        name: org?.org_name || '',
        email: org?.org_email || owner?.email || '',
        contact: org?.org_phone || owner?.whatsapp_no || owner?.phone || '',
    };
}

/**
 * Starts the payment for the store owner's cart.
 * @returns {Promise<{ paid: true, order: object } | { paid: false, orderId: string, razorpayOrderId: string,
 *   amount: number, currency: string, keyId: string, mode: string, prefill: object }>}
 */
export async function startRazorpayCheckout({ orgId, items }) {
    const config = razorpayPublicConfig();
    await expireStaleCheckouts(orgId);
    const order = await createCourseOrder({ orgId, items, gateway: GATEWAY });

    // Nothing to charge (every course free): Razorpay can't take Rs. 0 — complete it now.
    const amountPaise = Math.round(order.credit_amount * 100);
    if (amountPaise <= 0) {
        const done = await fulfilCourseOrder(order._id, { payment_gateway: 'none' });
        return { paid: true, order: done };
    }
    if (!config.configured) {
        await Order.updateOne({ _id: order._id }, { $set: { status: 'failed', updatedAt: new Date() } });
        throw httpError(503, 'Online payment is not set up yet. Please contact support.');
    }

    let rzpOrder;
    try {
        rzpOrder = await createRazorpayOrder({
            amountPaise,
            receipt: String(order._id),
            notes: { order_id: String(order._id), org_id: String(orgId) },
        });
    } catch (err) {
        await Order.updateOne({ _id: order._id }, { $set: { status: 'failed', updatedAt: new Date() } });
        throw err;
    }
    await Order.updateOne({ _id: order._id }, { $set: { razorpay_order_id: rzpOrder.id, updatedAt: new Date() } });

    const prefill = await checkoutPrefill(orgId);
    return {
        paid: false,
        orderId: String(order._id),
        razorpayOrderId: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        keyId: config.keyId,
        mode: config.mode,
        prefill,
    };
}

/** After Checkout reports success: verify the signature, then carry out the order. */
export async function confirmRazorpayPayment({ orgId, orderId, razorpayOrderId, razorpayPaymentId, signature }) {
    const order = await findOwnOrder(orgId, orderId);
    if (!razorpayOrderId || !razorpayPaymentId || !signature || order.razorpay_order_id !== razorpayOrderId) {
        throw httpError(400, 'The payment details do not match this order.');
    }
    if (!isValidPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature })) {
        throw httpError(400, 'The payment could not be verified. If money was deducted, please contact support with your order number.');
    }
    return fulfilCourseOrder(order._id, {
        razorpay_payment_id: razorpayPaymentId,
        payment_mode: 'online',
        payment_details: `Razorpay payment ${razorpayPaymentId}`,
    });
}

/** Checkout closed without paying: a still-pending order becomes canceled. */
export async function cancelRazorpayCheckout({ orgId, orderId }) {
    const order = await findOwnOrder(orgId, orderId);
    if (order.status === 'pending' && !order.fulfilled_at) {
        await Order.updateOne({ _id: order._id, status: 'pending', fulfilled_at: null }, { $set: { status: 'canceled', updatedAt: new Date() } });
    }
    return { canceled: true };
}

/**
 * Razorpay webhook event (signature already verified). payment.captured / order.paid carry
 * out the matching order if the browser didn't; payment.failed marks a pending order failed.
 */
export async function handleRazorpayWebhook(event) {
    const payment = event?.payload?.payment?.entity;
    const rzpOrderId = payment?.order_id || event?.payload?.order?.entity?.id;
    if (!rzpOrderId) return { ignored: true };
    const order = await Order.findOne({ razorpay_order_id: rzpOrderId, order_type: 'course' }).lean();
    if (!order) return { ignored: true };

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
        if (payment?.amount != null && payment.amount !== Math.round(order.credit_amount * 100)) {
            console.error(`[razorpay] webhook amount mismatch for order ${order._id}: paid ${payment.amount}`);
            return { ignored: true };
        }
        await fulfilCourseOrder(order._id, {
            razorpay_payment_id: payment?.id || order.razorpay_payment_id,
            payment_mode: 'online',
            payment_details: payment?.id ? `Razorpay payment ${payment.id}` : order.payment_details,
        });
        return { fulfilled: true };
    }
    if (event.event === 'payment.failed' && order.status === 'pending' && !order.fulfilled_at) {
        await Order.updateOne({ _id: order._id, status: 'pending', fulfilled_at: null }, { $set: { status: 'failed', updatedAt: new Date() } });
    }
    return { handled: true };
}
