import crypto from 'crypto';

// Razorpay (https://razorpay.com/docs/api/): creating an order and checking signatures — the
// two calls the cart checkout needs, made directly with fetch + crypto (no SDK).
//
// Configuration (server .env):
//   RAZORPAY_KEY_ID          rzp_test_… (sandbox) or rzp_live_… (live) — the key decides the mode
//   RAZORPAY_KEY_SECRET      the key's secret (never sent to the browser)
//   RAZORPAY_WEBHOOK_SECRET  optional; the secret set on the webhook in the Razorpay dashboard

const API_BASE = 'https://api.razorpay.com/v1';
const REQUEST_TIMEOUT_MS = 15000;

function httpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

// Real key ids look like rzp_test_XXXXXXXXXXXXXX / rzp_live_XXXXXXXXXXXXXX. The example values
// from the setup notes (rzp_test_xxxxxxxx, xxxxxxxxxxxxxxxx, choose_a_secret) are placeholders,
// not keys — treat them as "not set up" instead of sending them to Razorpay.
const KEY_ID_PATTERN = /^rzp_(test|live)_[A-Za-z0-9]{8,}$/;
const isPlaceholder = (value) => /x{6,}|choose_a_secret|your_|change_?me/i.test(String(value || ''));

/**
 * Whether the Razorpay keys in .env are usable, and why not.
 * @returns {{ configured: boolean, mode: 'test' | 'live', problem: string | null }}
 */
export function razorpaySetup() {
    const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
    const mode = keyId.startsWith('rzp_live_') ? 'live' : 'test';
    let problem = null;
    if (!keyId || !keySecret) problem = 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set';
    else if (isPlaceholder(keyId) || isPlaceholder(keySecret)) problem = 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET still hold the example placeholder values';
    else if (!KEY_ID_PATTERN.test(keyId)) problem = 'RAZORPAY_KEY_ID should look like rzp_test_… or rzp_live_…';
    return { configured: !problem, mode, problem };
}

/** Key id + mode for the browser; `configured` false when the keys aren't set. */
export function razorpayPublicConfig() {
    const { configured, mode } = razorpaySetup();
    return { configured, keyId: configured ? String(process.env.RAZORPAY_KEY_ID).trim() : null, mode };
}

/** One line for the server log at start-up (never prints a key or secret). */
export function describeRazorpaySetup() {
    const { configured, mode, problem } = razorpaySetup();
    if (!configured) return `Razorpay: not set up (${problem}) — online checkout is disabled.`;
    const webhook = process.env.RAZORPAY_WEBHOOK_SECRET && !isPlaceholder(process.env.RAZORPAY_WEBHOOK_SECRET) ? 'webhook on' : 'webhook off';
    return `Razorpay: ${mode === 'live' ? 'LIVE mode (real money)' : 'test mode (sandbox)'}, ${webhook}.`;
}

function credentials() {
    if (!razorpaySetup().configured) throw httpError(503, 'Online payment is not set up yet. Please contact support.');
    return { keyId: String(process.env.RAZORPAY_KEY_ID).trim(), keySecret: String(process.env.RAZORPAY_KEY_SECRET).trim() };
}

/**
 * Creates a Razorpay order. `amountPaise` is the amount in paise (Rs. 1 = 100), at least 100.
 * @returns {Promise<{ id: string, amount: number, currency: string }>}
 */
export async function createRazorpayOrder({ amountPaise, receipt, notes = {} }) {
    const { keyId, keySecret } = credentials();
    let res;
    try {
        res = await fetch(`${API_BASE}/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
            },
            body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: String(receipt).slice(0, 40), notes }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        console.error('[razorpay] create order request failed:', err.message);
        throw httpError(502, 'Could not reach the payment gateway. Please try again.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.id) {
        // Razorpay's own description (e.g. bad key); never includes the secret.
        console.error('[razorpay] create order rejected:', res.status, body?.error?.description || '');
        // While testing, say plainly that the keys are wrong; in live mode keep it generic.
        if (res.status === 401 && razorpaySetup().mode === 'test') {
            throw httpError(502, 'Razorpay rejected the API keys. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server/.env (both from the same Test-mode key) and restart the server.');
        }
        throw httpError(502, 'The payment gateway could not start the payment. Please try again.');
    }
    return { id: body.id, amount: body.amount, currency: body.currency };
}

function safeEqualHex(expectedHex, givenHex) {
    const a = Buffer.from(String(expectedHex), 'utf8');
    const b = Buffer.from(String(givenHex || ''), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Checkout success: HMAC-SHA256(order_id + "|" + payment_id, key secret) must equal the signature. */
export function isValidPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature }) {
    const { keySecret } = credentials();
    const expected = crypto.createHmac('sha256', keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
    return safeEqualHex(expected, signature);
}

/** Webhook: HMAC-SHA256(raw request body, webhook secret) must equal X-Razorpay-Signature. */
export function isValidWebhookSignature(rawBody, signature) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw httpError(503, 'Razorpay webhook is not configured.');
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEqualHex(expected, signature);
}
