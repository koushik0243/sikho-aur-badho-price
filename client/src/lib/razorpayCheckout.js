'use client';

// Razorpay Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/):
// loads checkout.js once and opens the payment window for a Razorpay order created by the server.

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let scriptPromise = null;

function loadCheckoutScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Not in a browser.'));
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => (window.Razorpay ? resolve() : reject(new Error('Payment window failed to load.')));
      script.onerror = () => { scriptPromise = null; reject(new Error('Could not load the payment window. Check your connection and try again.')); };
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * Opens Checkout and settles when it ends:
 *  - resolves { status: 'paid', razorpayOrderId, razorpayPaymentId, signature } on success
 *  - resolves { status: 'dismissed', lastError } when the window is closed without paying
 * @param {{ keyId: string, razorpayOrderId: string, amount: number, currency: string,
 *           name: string, description: string, prefill?: object }} options
 */
export async function openRazorpayCheckout({ keyId, razorpayOrderId, amount, currency, name, description, prefill }) {
  await loadCheckoutScript();
  return new Promise((resolve) => {
    let lastError = null;
    const rzp = new window.Razorpay({
      key: keyId,
      order_id: razorpayOrderId,
      amount,
      currency,
      name,
      description,
      prefill,
      theme: { color: '#0b7b7b' },
      handler: (resp) => resolve({
        status: 'paid',
        razorpayOrderId: resp.razorpay_order_id,
        razorpayPaymentId: resp.razorpay_payment_id,
        signature: resp.razorpay_signature,
      }),
      modal: { ondismiss: () => resolve({ status: 'dismissed', lastError }) },
    });
    // A failed attempt keeps the window open so the payer can retry; remember the reason.
    rzp.on('payment.failed', (resp) => { lastError = resp?.error?.description || 'The payment failed.'; });
    rzp.open();
  });
}
