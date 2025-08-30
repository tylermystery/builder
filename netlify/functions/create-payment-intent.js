/*
 * Version: 1.1.0
 * Last Modified: 2025-08-30
 * - Added explicit check for the STRIPE_SECRET_KEY environment variable.
 * - Added more specific error handling for JSON parsing.
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Ensure the Stripe key is configured on the server
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

  let amount;
  try {
    const body = JSON.parse(event.body);
    amount = body.amount;
  } catch (error) {
    console.error('Error parsing request body:', error);
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }
  
  // Stripe requires a minimum charge, typically $0.50 (50 cents)
  if (typeof amount !== 'number' || amount < 50) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Invalid amount specified: ${amount}` }),
    };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret }),
    };
  } catch (error) {
    console.error('Stripe API error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to create payment intent.' }),
    };
  }
};
