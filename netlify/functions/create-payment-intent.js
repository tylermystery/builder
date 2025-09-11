const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

  let amount;
  try {
    const body = JSON.parse(event.body);
    amount = body.amount;
  } catch (error) {
    console.error('Error parsing request body:', error);
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }
  
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
      // --- THIS IS THE CORRECTED LINE ---
      payment_method_types: ['card'], 
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
