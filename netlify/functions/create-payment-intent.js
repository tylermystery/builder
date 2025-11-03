const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Define a simplified fee structure for demonstration (adjust these rates)
// Standard Card: 2.9% + $0.30
// ACH Direct Debit: 0.8% (capped at $5.00)
// Wallet (Apple/Google Pay): Typically same as card (2.9% + $0.30)
function calculateProcessingFee(baseAmountInCents, paymentMethodType) {
  // 🐛 DEBUG: Log the input to the calculation function
  console.log(`[FeeCalc] Starting calculation for type: ${paymentMethodType}, amount: ${baseAmountInCents} cents.`);
  
  const baseAmount = baseAmountInCents / 100;
  let fee = 0;

  switch (paymentMethodType) {
    case 'ach_debit':
      // ACH Direct Debit: 0.8%, capped at $5.00
      fee = baseAmount * 0.008;
      // Apply max cap of $5.00.
      fee = Math.min(fee, 5.00); 
      break;
      
    case 'card':
    case 'google_pay':
    case 'apple_pay':
    default:
      // Standard card/wallet fee: 2.9% + $0.30
      const fixedFee = 0.30;
      const percentageRate = 0.029; // 2.9%
      fee = baseAmount * percentageRate + fixedFee;
      break;
  }
  
  const feeInCents = Math.round(fee * 100);
  // 🐛 DEBUG: Log the final calculated fee
  console.log(`[FeeCalc] Final fee calculated: ${feeInCents} cents (Rate: ${(fee*100/baseAmount).toFixed(2)}%)`);
  return feeInCents;
}

exports.handler = async (event) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('Stripe secret key is not configured.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Payment provider is not configured correctly.' }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let baseAmountInCents, paymentMethodType;
  try {
    const body = JSON.parse(event.body);
    baseAmountInCents = body.amount; // This is the subtotal + tip (excluding fee)
    // Client must send the selected payment type for accurate fee calculation
    paymentMethodType = body.paymentMethodType || 'card'; 
  } catch (error) {
    console.error('Error parsing request body:', error);
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }
  
  // 🐛 DEBUG: Log the request received by the handler
  console.log(`[Handler] Received request. Base amount: ${baseAmountInCents} cents, Payment Type: ${paymentMethodType}`);
  
  if (typeof baseAmountInCents !== 'number' || baseAmountInCents < 50) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Invalid amount specified: ${baseAmountInCents}` }),
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
          // --- NEW: Return the calculated fee ---
          processingFeeInCents: processingFeeInCents 
      }),
    };
  } catch (error) {
    console.error('Stripe API error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to create payment intent.' }),
    };
  }
};
