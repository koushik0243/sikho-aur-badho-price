import { isValidWebhookSignature } from './razorpay.js';
import { handleRazorpayWebhook } from './order.razorpay_checkout.js';

// POST /razorpay/webhook — set this URL in Razorpay Dashboard → Webhooks with the events
// payment.captured, order.paid and payment.failed, and put the webhook secret in
// RAZORPAY_WEBHOOK_SECRET. Mounted with express.raw() so req.body is the raw Buffer.
export async function razorpayWebhook(req, res) {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET || /x{6,}|choose_a_secret/i.test(process.env.RAZORPAY_WEBHOOK_SECRET)) {
        return res.status(503).json({ status: 503, message: 'Razorpay webhook is not configured.' });
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!isValidWebhookSignature(raw, req.get('X-Razorpay-Signature'))) {
        return res.status(400).json({ status: 400, message: 'Invalid signature.' });
    }
    let event;
    try {
        event = JSON.parse(raw.toString('utf8'));
    } catch {
        return res.status(400).json({ status: 400, message: 'Invalid body.' });
    }
    try {
        await handleRazorpayWebhook(event);
        return res.status(200).json({ status: 200, message: 'OK' });
    } catch (err) {
        // 5xx makes Razorpay retry the event later.
        console.error('[razorpay] webhook handling failed:', err.message);
        return res.status(500).json({ status: 500, message: 'Could not process the event.' });
    }
}
