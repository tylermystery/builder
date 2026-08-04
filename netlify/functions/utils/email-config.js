const fetch = require('node-fetch');

const SENDER_EMAIL = 'info@tylersmysterytours.com';
const SENDER_NAME = 'WhatTheFun';

const DEFAULT_FROM = { name: SENDER_NAME, email: SENDER_EMAIL };
const AUTH_FROM = {
  name: process.env.AUTH_EMAIL_FROM_NAME || SENDER_NAME,
  email: process.env.AUTH_EMAIL_FROM || process.env.SENDGRID_FROM_EMAIL || 'info@whatthefun.wtf'
};

function buildFrom(storeName, email) {
  const name = storeName ? `${storeName} on WhatTheFun` : SENDER_NAME;
  return { name, email: email || SENDER_EMAIL };
}

async function fetchStoreName(storeId) {
  if (!storeId) return null;
  try {
    const { AIRTABLE_PAT, BASE_ID } = process.env;
    const url = `https://api.airtable.com/v0/${BASE_ID}/Stores/${storeId}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });
    if (!res.ok) return null;
    const store = await res.json();
    return store.fields?.Name || null;
  } catch (e) {
    console.warn('[email-config] Failed to fetch store name:', e.message);
    return null;
  }
}

module.exports = { SENDER_EMAIL, SENDER_NAME, DEFAULT_FROM, AUTH_FROM, buildFrom, fetchStoreName };
