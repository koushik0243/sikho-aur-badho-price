// Checks the Razorpay keys in server/.env:  npm run razorpay:check
// Creates one unpaid Rs. 1 order on Razorpay (test keys only) — nothing is charged, and
// nothing is written to this app's database. Never prints the key secret.
import 'dotenv/config';
import { razorpaySetup, createRazorpayOrder } from '../orders/razorpay.js';

const setup = razorpaySetup();
if (!setup.configured) {
    console.log(`✗ Not set up: ${setup.problem}.`);
    console.log('  Put your Test-mode key in server/.env (Razorpay Dashboard → Test Mode → API Keys), then run this again.');
    process.exit(1);
}
if (setup.mode === 'live' && !process.argv.includes('--live')) {
    console.log('✗ These are LIVE keys. Run with --live to check them anyway (creates an unpaid Rs. 1 order on your live account).');
    process.exit(1);
}
try {
    const order = await createRazorpayOrder({ amountPaise: 100, receipt: `key-check-${Date.now()}`, notes: { purpose: 'key check' } });
    console.log(`✓ Razorpay accepted the keys (${setup.mode} mode). Test order ${order.id} created for Rs. 1 (unpaid; safe to ignore).`);
    console.log(process.env.RAZORPAY_WEBHOOK_SECRET ? '  Webhook secret: set.' : '  Webhook secret: not set (optional for local testing).');
} catch (err) {
    console.log(`✗ ${err.message}`);
    process.exit(1);
}
