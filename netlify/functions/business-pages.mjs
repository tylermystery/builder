// Public business introductions. Store configuration remains the source of truth.
export function businesses() {
  return [
    { slug: 'tylers-mystery-tours', name: "Tyler's Mystery Tours", theme: 'tours' },
    { slug: 'union-machine-works', name: 'Union Machine Works', theme: 'works' },
  ];
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function webUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  // Permit bare hostnames but never reinterpret a different protocol as HTTPS.
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

async function airtable(table, params) {
  const { AIRTABLE_PAT, BASE_ID } = process.env;
  if (!AIRTABLE_PAT || !BASE_ID) throw new Error('Store configuration unavailable');
  const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${table}?${params}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Store lookup unavailable');
  return (await response.json()).records || [];
}

export async function loadBusiness(business) {
  const params = new URLSearchParams({ filterByFormula: `{Name}=${JSON.stringify(business.name)}`, maxRecords: '1' });
  for (const field of ['Name', 'Description', 'Pillars', 'Location or service area', 'Store Details json']) params.append('fields[]', field);
  const [record] = await airtable('Stores', params);
  if (!record) return null;
  const f = record.fields;
  const raw = Array.isArray(f.Pillars) ? f.Pillars : String(f.Pillars || '').split(',');
  const values = raw.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean);
  const ids = values.filter(v => /^rec[A-Za-z0-9]{14}$/.test(v)).slice(0, 30);
  let names = new Map();
  if (ids.length) {
    const query = new URLSearchParams({ filterByFormula: `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})` });
    query.append('fields[]', 'Name');
    const categories = await airtable('tblUA4uuS8IYlhKpD', query);
    names = new Map(categories.map(r => [r.id, r.fields.Name]));
  }
  let info = {};
  try { info = JSON.parse(f['Store Details json'] || '{}')?.businessInfo || {}; } catch { /* Optional public details. */ }
  const email = typeof info.contact?.supportEmail === 'string' ? info.contact.supportEmail.trim() : '';
  const phone = typeof info.contact?.phone === 'string' ? info.contact.phone.trim() : '';
  // Explicit public allowlist; never send the original store JSON to a visitor.
  return {
    ...business, id: record.id,
    description: typeof f.Description === 'string' ? f.Description.trim() : '',
    area: typeof f['Location or service area'] === 'string' ? f['Location or service area'].trim() : '',
    offerings: [...new Set(values.map(v => /^rec[A-Za-z0-9]{14}$/.test(v) ? names.get(v) : v).filter(v => typeof v === 'string' && v.trim()))],
    website: webUrl(info.websiteUrl),
    email: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : '',
    phone: /^[+\d\s().-]{5,40}$/.test(phone) ? phone : '',
    socials: [...new Set(['instagram', 'facebook', 'twitter', 'youtube', 'tiktok'].map(key => webUrl(info.socialMedia?.[key])).filter(Boolean))],
  };
}

export function renderBusiness(b) {
  const e = escapeHtml;
  const canonical = `https://whatthefun.wtf/shops/${b.slug}/`;
  const shop = `/?shopId=${encodeURIComponent(b.id)}`;
  const description = [b.description, b.area].filter(Boolean).join(' — ');
  const schema = {
    '@context': 'https://schema.org', '@type': 'Organization', '@id': `${canonical}#business`,
    name: b.name, url: canonical, description: b.description || undefined,
    areaServed: b.area || undefined, email: b.email || undefined, telephone: b.phone || undefined,
    sameAs: [...new Set([b.website, ...b.socials].filter(url => url && url !== canonical))],
  };
  const offerings = b.offerings.map((name, i) => `<li><span class="number">${String(i + 1).padStart(2, '0')}</span><a href="${e(shop)}&amp;category=${encodeURIComponent(name)}">${e(name)}<span aria-hidden="true">↗</span></a></li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(b.name)} | WTFun</title><meta name="description" content="${e(description.slice(0, 160))}">
<link rel="canonical" href="${canonical}"><meta name="robots" content="index, follow">
<meta property="og:type" content="website"><meta property="og:title" content="${e(b.name)}"><meta property="og:description" content="${e(description.slice(0, 300))}"><meta property="og:url" content="${canonical}"><meta property="og:site_name" content="WTFun">
<meta name="twitter:card" content="summary"><link rel="stylesheet" href="/css/business-pages.css">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script></head>
<body class="${b.theme}"><a class="skip" href="#main">Skip to content</a>
<header><a class="platform" href="/">WTFun<span>Independent businesses. Shared possibilities.</span></a><a href="/shops/">Explore businesses <span aria-hidden="true">↗</span></a></header>
<main id="main"><section class="intro"><div class="eyebrow">A business on WTFun <span aria-hidden="true">/ ${b.theme === 'tours' ? '01' : '02'}</span></div>
<h1>${e(b.name)}</h1><div class="intro-bottom"><div>${b.description ? `<p class="description">${e(b.description)}</p>` : ''}${b.area ? `<p class="area"><span>Location / service area</span>${e(b.area)}</p>` : ''}</div><a class="button" href="${e(shop)}">Explore the shop <span aria-hidden="true">↗</span></a></div></section>
${offerings ? `<section class="offerings" aria-labelledby="offerings-title"><div><p class="eyebrow">Find your starting point</p><h2 id="offerings-title">What we offer</h2><p>Explore a category in our shop.</p></div><ol>${offerings}</ol></section>` : ''}
<section class="contact" aria-labelledby="contact-title"><div><p class="eyebrow">Keep in touch</p><h2 id="contact-title">Connect with<br>${e(b.name)}</h2></div><div class="contact-links">${b.website ? `<a href="${e(b.website)}">Visit official website <span aria-hidden="true">↗</span></a>` : ''}${b.email ? `<a href="mailto:${e(b.email)}">${e(b.email)}</a>` : ''}${b.phone ? `<a href="tel:${e(b.phone.replace(/[^+\d]/g, ''))}">${e(b.phone)}</a>` : ''}<a href="${e(shop)}">Browse the shop <span aria-hidden="true">↗</span></a></div></section>
</main><footer><a class="platform" href="/">WTFun</a><span>${e(b.name)} on WTFun</span><a href="/shops/">All businesses</a></footer></body></html>`;
}

function directory() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Businesses on WTFun</title><meta name="description" content="Explore Tyler's Mystery Tours and Union Machine Works on WTFun."><link rel="canonical" href="https://whatthefun.wtf/shops/"><link rel="stylesheet" href="/css/business-pages.css"></head><body><header><a class="platform" href="/">WTFun</a><a href="/">Open the app ↗</a></header><main id="main"><section class="intro"><p class="eyebrow">Meet the businesses</p><h1>Different shops.<br>Shared possibilities.</h1><p class="description">Explore independent businesses on WTFun.</p></section><nav class="business-list" aria-label="Businesses">${businesses().map((b, i) => `<a href="/shops/${b.slug}/"><span class="number">0${i + 1}</span><h2>${escapeHtml(b.name)}</h2><span aria-hidden="true">↗</span></a>`).join('')}</nav></main><footer><a class="platform" href="/">WTFun</a><span>Explore. Connect. Make a plan.</span></footer></body></html>`;
}

export default async function handler(request) {
  const path = new URL(request.url).pathname;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const business = businesses().find(b => path === `/shops/${b.slug}/` || path === `/shops/${b.slug}`);
  if (!business && path !== '/shops/' && path !== '/shops') return new Response('Not Found', { status: 404 });
  if (!path.endsWith('/')) return new Response(null, { status: 301, headers: { Location: `${path}/${new URL(request.url).search}` } });
  try {
    const data = business ? await loadBusiness(business) : null;
    if (business && !data) return new Response('Business not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : data ? renderBusiness(data) : directory(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', 'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return new Response(request.method === 'HEAD' ? null : 'This business page is temporarily unavailable. Please try again shortly.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  }
}

export const config = { path: ['/shops', '/shops/*'] };
