// FILE: netlify/functions/utils/checkout-emails.js
// Shared builders for checkout confirmation emails: the purchaser-facing
// receipt and the store-owner notification. These are used for paid Stripe
// receipts, manually recorded payment receipts, free registrations, and saved
// plans where no payment has been taken yet.

const { SENDER_NAME, SENDER_EMAIL, buildFrom } = require('./email-config');
const fetch = require('node-fetch');

const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value) {
  const num = Number(value);
  return `$${(Number.isFinite(num) ? num : 0).toFixed(2)}`;
}

function parseSessionData(session) {
  try {
    return JSON.parse(session?.fields?.['Items with Variations'] || '{}');
  } catch (_) {
    return {};
  }
}

function getRecordIdsFromSessionData(sessionData) {
  return Object.keys(sessionData?.lockedInItems || {}).filter(id => /^rec[A-Za-z0-9]+$/.test(id));
}

async function loadCheckoutEmailDetails(session) {
  const sessionData = parseSessionData(session);
  const recordIds = getRecordIdsFromSessionData(sessionData);
  const itemRecords = [];

  if (process.env.AIRTABLE_PAT && process.env.BASE_ID && recordIds.length > 0) {
    await Promise.all(recordIds.map(async (recordId) => {
      try {
        const url = `https://api.airtable.com/v0/${process.env.BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}/${recordId}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_PAT}` } });
        if (res.ok) itemRecords.push(await res.json());
      } catch (err) {
        console.warn('[checkout-emails] Could not load receipt item record:', recordId, err.message);
      }
    }));
  }

  return { sessionData, itemRecords };
}

function parseOptions(rawOptionsString) {
  if (!rawOptionsString || typeof rawOptionsString !== 'string') return [];
  const lines = rawOptionsString.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const hasGroupHeaders = lines.some(line => /^\[.+\]\s*(\(.+\))?$/.test(line));
  if (!hasGroupHeaders) {
    const options = lines.map(option => {
      let name = option;
      let price = null;
      let priceChange = null;
      let pricePercent = null;
      const parts = option.split(',').map(part => part.trim());
      name = parts.shift() || '';
      parts.forEach(part => {
        let match;
        if ((match = part.match(/price:\s*(\-?\d+(\.\d{1,2})?)/i))) price = parseFloat(match[1]);
        else if ((match = part.match(/price change:\s*([+\-]?\d+(\.\d{1,2})?)%/i))) pricePercent = parseFloat(match[1]);
        else if ((match = part.match(/price change:\s*(\-?\d+(\.\d{1,2})?)/i))) priceChange = parseFloat(match[1]);
      });
      const namePriceMatch = name.match(/\$(\d+(\.\d{1,2})?)/);
      if (namePriceMatch) {
        price = parseFloat(namePriceMatch[1]);
        name = name.replace(namePriceMatch[0], '').trim();
      }
      return { name: name || 'Unnamed Option', priceOverride: price, priceModifier: priceChange, pricePercent };
    });
    return options.length ? [{ name: 'Options', options }] : [];
  }

  const groups = [];
  let currentGroup = null;
  for (const line of lines) {
    const groupMatch = line.match(/^\[(.+?)\]\s*(?:\((.+?)\))?$/);
    if (groupMatch) {
      currentGroup = { name: groupMatch[1].trim(), options: [] };
      groups.push(currentGroup);
      continue;
    }
    if (!currentGroup) {
      currentGroup = { name: 'Options', options: [] };
      groups.push(currentGroup);
    }
    let name = line;
    let priceModifier = null;
    let priceOverride = null;
    let pricePercent = null;
    const modifierPattern = /\[(\w+):\s*([^\]]+)\]/gi;
    let match;
    while ((match = modifierPattern.exec(line)) !== null) {
      if (match[1].toLowerCase() !== 'price') continue;
      const value = match[2].trim();
      if (value.endsWith('%')) pricePercent = parseFloat(value);
      else if (value.startsWith('+') || value.startsWith('-')) priceModifier = parseFloat(value);
      else priceOverride = parseFloat(value);
    }
    name = line.replace(/\[(\w+):\s*([^\]]+)\]/gi, '').trim();
    const namePriceMatch = name.match(/\$(\d+(\.\d{1,2})?)/);
    if (namePriceMatch && priceOverride === null && priceModifier === null) {
      priceOverride = parseFloat(namePriceMatch[1]);
      name = name.replace(namePriceMatch[0], '').trim();
    }
    currentGroup.options.push({ name: name || 'Unnamed Option', priceOverride, priceModifier, pricePercent });
  }
  return groups;
}

function flattenOptionGroups(groups) {
  return Array.isArray(groups) ? groups.flatMap(group => Array.isArray(group.options) ? group.options : []) : [];
}

function getRecordPrice(record, selectionsOrIndex = null) {
  let price = parseFloat(String(record?.fields?.Price || '0').replace(/[^0-9.-]+/g, ''));
  if (!Number.isFinite(price)) price = 0;
  if (selectionsOrIndex === null || selectionsOrIndex === undefined) return price;

  const groups = parseOptions(record?.fields?.Options);
  if (typeof selectionsOrIndex === 'number') {
    const option = flattenOptionGroups(groups)[selectionsOrIndex];
    if (!option) return price;
    if (option.priceOverride !== null && !isNaN(option.priceOverride)) return option.priceOverride;
    if (option.priceModifier !== null && !isNaN(option.priceModifier)) price += option.priceModifier;
    if (option.pricePercent !== null && !isNaN(option.pricePercent)) price += price * (option.pricePercent / 100);
    return price;
  }

  if (typeof selectionsOrIndex === 'object') {
    let percentSum = 0;
    const sortedGroupKeys = Object.keys(selectionsOrIndex).sort((a, b) => {
      return (parseInt(a.replace('group', ''), 10) || 0) - (parseInt(b.replace('group', ''), 10) || 0);
    });
    for (const groupKey of sortedGroupKeys) {
      const groupIndexMatch = groupKey.match(/^group(\d+)$/);
      if (!groupIndexMatch) continue;
      const group = groups[parseInt(groupIndexMatch[1], 10)];
      if (!group?.options) continue;
      const optionIndices = Array.isArray(selectionsOrIndex[groupKey]) ? selectionsOrIndex[groupKey] : [selectionsOrIndex[groupKey]];
      for (const optionIndex of optionIndices) {
        const option = group.options[optionIndex];
        if (!option) continue;
        if (option.priceOverride !== null && !isNaN(option.priceOverride)) {
          price = option.priceOverride;
          continue;
        }
        if (option.priceModifier !== null && !isNaN(option.priceModifier)) price += option.priceModifier;
        if (option.pricePercent !== null && !isNaN(option.pricePercent)) percentSum += option.pricePercent;
      }
    }
    if (percentSum) price += price * (percentSum / 100);
  }

  return Number.isFinite(price) ? price : 0;
}

function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return '';
  const raw = Array.isArray(value) ? value[0] : value;
  try {
    const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T00:00:00`)
      : new Date(raw);
    if (!isNaN(date.getTime())) return date.toLocaleDateString('en-US', options);
  } catch (_) {}
  return typeof raw === 'string' ? raw : '';
}

function formatTimeRange(startTime, endTime) {
  const start = (startTime == null ? '' : String(startTime)).trim();
  const end = (endTime == null ? '' : String(endTime)).trim();
  if (!start) return '';
  return end && end !== start ? `${start} - ${end}` : start;
}

function formatItemSchedule(itemInfo, record) {
  const itemDate = formatDate(itemInfo?.itemDate, { month: 'short', day: 'numeric' });
  const itemTime = formatTimeRange(itemInfo?.itemStartTime, itemInfo?.itemEndTime);
  const itemDuration = Number(itemInfo?.itemDuration || 0);
  const duration = itemDuration > 0
    ? `${Math.floor(itemDuration / 60) ? `${Math.floor(itemDuration / 60)}h` : ''}${itemDuration % 60 ? ` ${itemDuration % 60}m` : ''}`.trim()
    : '';
  const savedSchedule = [itemDate, itemTime, duration].filter(Boolean).join(' · ');
  if (savedSchedule) return savedSchedule;

  const fields = record?.fields || {};
  const eventDate = formatDate(fields.Date, { month: 'short', day: 'numeric', year: 'numeric' });
  const eventTime = formatTimeRange(fields.Start_time, fields.End_time) || fields.Time || '';
  return [eventDate, eventTime].filter(Boolean).join(' · ');
}

function getPlanContext(session, sessionData) {
  const details = sessionData?.eventDetails || {};
  const name = session?.fields?.Name || details.eventName || '';
  const goals = session?.fields?.Goals || details.goals || '';
  const date = formatDate(session?.fields?.Date || details.date);
  const time = formatTimeRange(session?.fields?.Start_time || details.startTime, session?.fields?.End_time || details.endTime) || session?.fields?.Time || '';
  return { name, goals, schedule: [date, time].filter(Boolean).join(' · ') };
}

function getSelectedOptionLines(record, itemInfo) {
  const groups = parseOptions(record?.fields?.Options);
  const lines = [];
  if (itemInfo?.selections && typeof itemInfo.selections === 'object') {
    const sortedKeys = Object.keys(itemInfo.selections).sort((a, b) => {
      return (parseInt(a.replace('group', ''), 10) || 0) - (parseInt(b.replace('group', ''), 10) || 0);
    });
    for (const groupKey of sortedKeys) {
      const match = groupKey.match(/^group(\d+)$/);
      if (!match) continue;
      const group = groups[parseInt(match[1], 10)];
      if (!group?.options) continue;
      const optionIndices = Array.isArray(itemInfo.selections[groupKey]) ? itemInfo.selections[groupKey] : [itemInfo.selections[groupKey]];
      for (const optionIndex of optionIndices) {
        const option = group.options[optionIndex];
        if (!option?.name) continue;
        const groupLabel = group.name && group.name !== 'Options' ? `${group.name}: ` : '';
        lines.push(`${groupLabel}${option.name}`);
      }
    }
  } else if (itemInfo?.selectedOptionIndex != null) {
    const option = flattenOptionGroups(groups)[itemInfo.selectedOptionIndex];
    if (option?.name) lines.push(option.name);
  }
  return lines;
}

function getCheckoutItems(sessionData, itemRecords = []) {
  const recordsById = new Map(itemRecords.map(record => [record.id, record]));
  const customRecords = sessionData?.aiRecords || {};
  return Object.entries(sessionData?.lockedInItems || {}).map(([recordId, itemInfo]) => {
    const record = recordsById.get(recordId) || customRecords[recordId] || null;
    const fields = record?.fields || {};
    const quantity = Number(itemInfo?.quantity || 1);
    const selections = itemInfo?.selections && Object.keys(itemInfo.selections).length > 0
      ? itemInfo.selections
      : itemInfo?.selectedOptionIndex;
    const unitPrice = itemInfo?.overridePrice != null ? Number(itemInfo.overridePrice) : getRecordPrice(record, selections);
    return {
      id: recordId,
      name: fields.Name || itemInfo?.itemName || itemInfo?.name || 'Item',
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      optionLines: getSelectedOptionLines(record, itemInfo),
      schedule: formatItemSchedule(itemInfo, record),
      rsvpType: itemInfo?.rsvpType || '',
      note: itemInfo?.note || '',
    };
  });
}

function buildPlanContextHtml(plan) {
  if (!plan.name && !plan.goals && !plan.schedule) return '';
  return `
          <div style="border-bottom: 1px solid #e5e7eb; padding-bottom: 14px; margin-bottom: 14px;">
            ${plan.name ? `<div style="font-size: 14px; color: #888; margin-bottom: 4px;">Plan</div><div style="font-size: 16px; font-weight: 700; color: #333; margin-bottom: 10px;">${escapeHtml(plan.name)}</div>` : ''}
            ${plan.goals ? `<div style="font-size: 14px; color: #888; margin-bottom: 4px;">Goals</div><div style="font-size: 14px; color: #444; line-height: 1.45; margin-bottom: 10px;">${escapeHtml(plan.goals)}</div>` : ''}
            ${plan.schedule ? `<div style="font-size: 14px; color: #888; margin-bottom: 4px;">Plan Date &amp; Time</div><div style="font-size: 14px; color: #333;">${escapeHtml(plan.schedule)}</div>` : ''}
          </div>
  `;
}

function buildItemizedHtml(items) {
  if (!items.length) return '';
  const itemRows = items.map(item => {
    const lineTotal = item.unitPrice * item.quantity;
    const details = [
      item.rsvpType === 'yes' ? 'RSVP: Going' : '',
      item.rsvpType === 'maybe' ? 'RSVP: Maybe' : '',
      ...item.optionLines.map(line => escapeHtml(line)),
      item.schedule ? `Date/Time: ${escapeHtml(item.schedule)}` : '',
      item.note ? `Note: ${escapeHtml(item.note)}` : '',
    ].filter(Boolean);
    return `
            <div style="padding: 12px 0; border-top: 1px solid #eceff3;">
              <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 15px; color: #333;">
                <strong>${escapeHtml(item.name)} <span style="font-weight: 500; color: #666;">x${item.quantity}</span></strong>
                <strong>${money(lineTotal)}</strong>
              </div>
              ${details.length ? `<div style="font-size: 13px; color: #667085; line-height: 1.45; margin-top: 4px;">${details.join('<br>')}</div>` : ''}
            </div>
    `;
  }).join('');
  const subtotal = items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
  return `
          <div style="margin-top: 4px;">
            <div style="font-size: 14px; color: #888; margin-bottom: 2px;">Items</div>
            ${itemRows}
            <div style="display: flex; justify-content: space-between; padding: 12px 0 0; border-top: 1px solid #d9dee7; font-size: 15px; font-weight: 700; color: #333;">
              <span>Subtotal</span><span>${money(subtotal)}</span>
            </div>
          </div>
  `;
}

/**
 * Purchaser-facing email.
 * @param {object} session  Airtable Sessions record
 * @param {object} payment  { amount, method, status, customerEmail, date }
 * @param {object} store    Airtable Stores record (may be null)
 * @param {string} baseUrl  Site base URL
 * @param {object} [options] { unpaid:boolean, amountDue:number }
 */
function buildReceiptEmail(session, payment, store, baseUrl, options = {}) {
  const { unpaid = false, amountDue = payment.amount || 0, signInUrl = null } = options;
  const sessionData = options.sessionData || parseSessionData(session);
  const planContext = getPlanContext(session, sessionData);
  const checkoutItems = getCheckoutItems(sessionData, options.itemRecords || []);
  const planContextHtml = buildPlanContextHtml(planContext);
  const itemizedHtml = buildItemizedHtml(checkoutItems);
  const sessionName = session.fields.Name || 'Your Booking';
  const storeName = store?.fields?.Name || SENDER_NAME;
  const contactEmail = store?.fields?.ContactEmail || SENDER_EMAIL;
  const senderName = store?.fields?.SenderName || storeName;
  const planUrl = `${baseUrl}/?session=${session.id}`;

  const shownAmount = unpaid ? amountDue : (payment.amount || 0);
  const amountStr = money(shownAmount || 0);
  const dateStr = new Date(payment.date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Wording differs only for the "saved plan / no payment taken yet" case.
  const headerKicker = unpaid ? 'Plan Saved' : 'Payment Receipt';
  const introLine = unpaid
    ? `Your plan with <strong>${storeName}</strong> is saved. No payment has been taken yet — open it any time to review and pay.`
    : `Thank you for your payment to <strong>${storeName}</strong>!`;
  const amountLabel = unpaid ? 'Amount Due' : 'Amount Paid';
  const amountColor = unpaid ? '#b8860b' : '#28a745';
  const ctaLabel = unpaid ? 'Open Plan &amp; Pay' : 'View Your Plan';

  const isProcessing = payment.status === 'processing';
  const processingNote = isProcessing
    ? `<div style="padding: 12px 16px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px; margin: 16px 0; font-size: 14px; color: #856404;">Your bank transfer is processing — funds typically clear in 3–5 business days. We'll update your booking when it's confirmed.</div>`
    : '';

  const feeStr = payment.processingFee ? money(payment.processingFee) : null;
  const baseAmountStr = payment.baseAmount ? money(payment.baseAmount) : null;

  // For a guest who isn't signed in, offer a one-click sign-in so this plan and
  // their RSVPs are saved to an account. Clicking signs them in on the tab they
  // started checkout from.
  const signInBlock = signInUrl ? `
        <div style="margin: 4px 0 8px; padding: 16px; background: #f4f6ff; border: 1px solid #dfe3ff; border-radius: 10px; text-align: center;">
          <div style="font-size: 14px; color: #444; margin-bottom: 10px;">Want to keep this plan and manage it later?</div>
          <a href="${signInUrl}" style="display: inline-block; padding: 10px 24px; background: #ffffff; border: 1px solid #667eea; color: #667eea; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">🔑 Sign in to save &amp; manage your plan</a>
          <div style="font-size: 12px; color: #999; margin-top: 8px;">Open this from the tab you started checkout in. Link expires in 15 minutes.</div>
        </div>
  ` : '';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 28px 32px; border-radius: 12px 12px 0 0; text-align: center;">
        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: rgba(255,255,255,0.8); margin-bottom: 10px;">${headerKicker}</div>
        <div style="font-size: 28px; font-weight: 800; color: white; line-height: 1.2;">${storeName}</div>
      </div>
      <div style="padding: 28px 32px; background: white; border: 1px solid #eee; border-top: none;">
        <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">${introLine}</p>

        <div style="background: #f8f9fb; border-radius: 10px; padding: 20px; margin-bottom: 20px;">
          ${planContextHtml}
          ${itemizedHtml}

          <div style="font-size: 14px; color: #888; margin-bottom: 4px;">Booking</div>
          <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 16px;">${sessionName}</div>

          <div style="font-size: 14px; color: #888; margin-bottom: 4px;">Receipt Date</div>
          <div style="font-size: 15px; color: #333; margin-bottom: 16px;">${dateStr}</div>

          <div style="font-size: 14px; color: #888; margin-bottom: 4px;">Method</div>
          <div style="font-size: 15px; color: #333; margin-bottom: 16px;">${payment.method || 'Card'}</div>

          ${baseAmountStr && feeStr ? `
          <div style="display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid #eee; font-size: 14px; color: #555;">
            <span>Subtotal</span><span>${baseAmountStr}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #555;">
            <span>Processing fee</span><span>${feeStr}</span>
          </div>
          ` : ''}

          <div style="display: flex; justify-content: space-between; padding: 12px 0; border-top: 2px solid #ddd; margin-top: 4px; font-size: 18px; font-weight: 700; color: ${amountColor};">
            <span>${amountLabel}</span><span>${amountStr}</span>
          </div>
        </div>

        ${processingNote}

        <div style="text-align: center; margin: 24px 0;">
          <a href="${planUrl}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">${ctaLabel}</a>
        </div>

        ${signInBlock}

        <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 20px 0 0; text-align: center;">
          Need help with your order? Contact us at
          <a href="mailto:${contactEmail}" style="color: #667eea;">${contactEmail}</a>
        </p>
      </div>
      <div style="padding: 16px 32px; background: #f8f9fb; border: 1px solid #eee; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
        <span style="font-size: 12px; color: #aaa;">${storeName} · Powered by WhatTheFun</span>
      </div>
    </div>
  `;

  return {
    subject: unpaid ? `${storeName}: Your plan is saved — ${sessionName}` : `${storeName}: Payment Receipt — ${sessionName}`,
    html,
    from: buildFrom(senderName, contactEmail),
  };
}

/**
 * Store-owner-facing email.
 * @param {object} session  Airtable Sessions record
 * @param {object} payment  { amount, method, status, customerEmail }
 * @param {object} store    Airtable Stores record (may be null)
 * @param {string} baseUrl  Site base URL
 * @param {object} [options] { unpaid:boolean, amountDue:number }
 */
function buildMerchantNotificationEmail(session, payment, store, baseUrl, options = {}) {
  const { unpaid = false, amountDue = payment.amount || 0 } = options;
  const sessionData = options.sessionData || parseSessionData(session);
  const planContext = getPlanContext(session, sessionData);
  const checkoutItems = getCheckoutItems(sessionData, options.itemRecords || []);
  const planContextHtml = buildPlanContextHtml(planContext);
  const itemizedHtml = buildItemizedHtml(checkoutItems);
  const sessionName = session.fields.Name || 'A Booking';
  const storeName = store?.fields?.Name || SENDER_NAME;
  const contactEmail = store?.fields?.ContactEmail || SENDER_EMAIL;
  const shownAmount = unpaid ? amountDue : (payment.amount || 0);
  const amountStr = money(shownAmount || 0);
  const customerEmail = payment.customerEmail || 'Unknown';
  const customerName = payment.customerName ? `${payment.customerName} (${customerEmail})` : customerEmail;
  const dashboardUrl = store?.fields?.OwnerDashboardID
    ? `${baseUrl}/store-dashboard.html?id=${encodeURIComponent(store.fields.OwnerDashboardID)}`
    : baseUrl;

  const bannerColor = unpaid ? '#667eea' : '#28a745';
  const bannerTitle = unpaid ? 'New Saved Plan' : 'New Payment Received';
  const bodyLine = unpaid
    ? `A plan was saved for <strong>${sessionName}</strong>. No payment has been collected yet — the customer received a link to open the plan and pay.`
    : `A payment of <strong>${amountStr}</strong> was received for <strong>${sessionName}</strong>.`;
  const statusLine = unpaid ? 'Saved — awaiting payment' : (payment.status === 'processing' ? 'Processing (ACH)' : 'Succeeded');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: ${bannerColor}; padding: 20px 28px; border-radius: 10px 10px 0 0; text-align: center;">
        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: rgba(255,255,255,0.85); margin-bottom: 6px;">${bannerTitle}</div>
        <div style="font-size: 22px; font-weight: 800; color: white; line-height: 1.2;">${storeName}</div>
      </div>
      <div style="padding: 24px 28px; background: white; border: 1px solid #eee; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; color: #333; margin: 0 0 16px;">${bodyLine}</p>
        <div style="background: #f8f9fb; padding: 14px; border-radius: 8px; font-size: 14px; color: #555; margin-bottom: 16px;">
          <div><strong>Customer:</strong> ${customerName}</div>
          <div><strong>Amount ${unpaid ? 'due' : 'paid'}:</strong> ${amountStr}</div>
          <div><strong>Method:</strong> ${payment.method || 'Card'}</div>
          <div><strong>Status:</strong> ${statusLine}</div>
        </div>
        <div style="background: #f8f9fb; padding: 14px; border-radius: 8px; margin-bottom: 16px;">
          ${planContextHtml}
          ${itemizedHtml}
        </div>
        <div style="text-align: center;">
          <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 24px; background: ${bannerColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">View Dashboard</a>
        </div>
      </div>
    </div>
  `;

  return {
    subject: unpaid
      ? `📝 ${storeName} — Plan saved: ${sessionName}`
      : `💰 ${storeName} — Payment received: ${amountStr} for ${sessionName}`,
    html,
    to: contactEmail,
    from: buildFrom(storeName, contactEmail),
  };
}

module.exports = { buildReceiptEmail, buildMerchantNotificationEmail, loadCheckoutEmailDetails };
