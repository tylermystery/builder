const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Define a simplified fee structure for demonstration (adjust these rates)
// Standard Card: 2.9% + $0.30
// ACH Direct Debit: 0.8% (capped at $5.00)
// Wallet (Apple/Google Pay): Typically same as card (2.9% + $0.30)
function calculateProcessingFee(baseAmountInCents, paymentMethodType) {
  // Defensive: validate inputs
  if (typeof baseAmountInCents !== 'number' || isNaN(baseAmountInCents) || baseAmountInCents < 0) {
    console.warn(`[FeeCalc] Invalid baseAmountInCents: ${baseAmountInCents}, using 0`);
    baseAmountInCents = 0;
  }

  console.log(`[FeeCalc] Starting calculation for type: ${paymentMethodType}, amount: ${baseAmountInCents} cents.`);

  const baseAmount = baseAmountInCents / 100;
  let fee = 0;

  switch (paymentMethodType) {
    // ACH Direct Debit: 0.8%, capped at $5.00
    case 'ach_debit':
    case 'us_bank_account':
      fee = baseAmount * 0.008;
      // Apply max cap of $5.00.
      fee = Math.min(fee, 5.00);
      break;

    // Standard card/wallet fee: 2.9% + $0.30
    case 'cashapp':
    case 'card':
    case 'google_pay':
    case 'apple_pay':
    default:
      const fixedFee = 0.30;
      const percentageRate = 0.029; // 2.9%
      fee = baseAmount * percentageRate + fixedFee;
      break;
  }

  const feeInCents = Math.round(fee * 100);
  console.log(`[FeeCalc] Final fee calculated: ${feeInCents} cents (Rate: ${baseAmount > 0 ? (fee*100/baseAmount).toFixed(2) : 0}%)`);
  return feeInCents;
}

exports.handler = async (event) => {
  // Validate environment variables
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[create-payment-intent] Stripe secret key is not configured.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Payment provider is not configured correctly.' }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let baseAmountInCents, paymentMethodType;
  try {
    // Defensive: validate request body exists
    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body.' }) };
    }

    const body = JSON.parse(event.body);
    baseAmountInCents = body.amount; // This is the subtotal + tip (excluding fee)
    // Client must send the selected payment type for accurate fee calculation
    paymentMethodType = body.paymentMethodType || 'card';
  } catch (error) {
    console.error('[create-payment-intent] Error parsing request body:', error);
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  console.log(`[create-payment-intent] Received request. Base amount: ${baseAmountInCents} cents, Payment Type: ${paymentMethodType}`);

  // Validate amount
  if (typeof baseAmountInCents !== 'number' || isNaN(baseAmountInCents)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Invalid amount specified: ${baseAmountInCents}` }),
    };
  }

  // Stripe minimum is 50 cents
  if (baseAmountInCents < 50) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Amount must be at least 50 cents. Received: ${baseAmountInCents}` }),
    };
  }

  // Cap maximum amount to prevent extreme values (e.g., $1,000,000 = 100000000 cents)
  const MAX_AMOUNT_CENTS = 100000000;
  if (baseAmountInCents > MAX_AMOUNT_CENTS) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Amount exceeds maximum allowed.` }),
    };
  }

  try {
    // Calculate the fee and the new total amount (including fee)
    const processingFeeInCents = calculateProcessingFee(baseAmountInCents, paymentMethodType);
    const finalAmountInCents = baseAmountInCents + processingFeeInCents;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: finalAmountInCents, // Charge the full amount including the fee
      currency: 'usd',
      // Allow Stripe to determine the best method types based on the user's element display
      automatic_payment_methods: { enabled: true },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
          clientSecret: paymentIntent.client_secret,
          processingFeeInCents: processingFeeInCents
      }),
    };
  } catch (error) {
    console.error('[create-payment-intent] Stripe API error:', error.message);
    // Provide more helpful error messages based on Stripe error types
    let userMessage = 'Failed to create payment intent.';
    if (error.type === 'StripeCardError') {
      userMessage = 'There was an issue with the payment method.';
    } else if (error.type === 'StripeInvalidRequestError') {
      userMessage = 'Invalid payment request.';
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: userMessage }),
    };
  }
};
