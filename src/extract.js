'use strict';
// Step 2: a vision model reads each picture and writes down the offers it sees.
const API = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages';
const MODEL = process.env.FOLDER_MODEL || 'claude-haiku-4-5-20251001';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROMPT = shop => `This is part of this week's offers from the Dutch supermarket ${shop}. List every offer you can read in the picture.
Reply with only a JSON object: {"validFrom": "YYYY-MM-DD" or null, "validUntil": "YYYY-MM-DD" or null, "offers": [...]}.
Each offer: {"product": product name as printed, including brand, "size": pack size as printed or null, "deal": the offer as printed, for example "1+1 gratis", "2e halve prijs", "25% korting", "2 voor 3.00" or null when it is only a lower price, "price": the offer price in euros as a number or null, "normalPrice": the crossed-out or "van" price as a number or null, "note": conditions such as "met Extra's" or "alleen online" or null}.
Rules: copy what is printed and never guess a price. A price printed as "1 49" or "1.49" is 1.49. Skip navigation, banners, recipes and anything that is not a product offer. The validity dates are only filled in when the picture states them; today is ${new Date().toISOString().slice(0, 10)}, use it to work out the year. If the picture has no offers reply {"validFrom":null,"validUntil":null,"offers":[]}.`;

function looseJson(text) { const a = text.indexOf('{'), b = text.lastIndexOf('}'); return JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text); }

async function readImage(shopName, jpeg, attempt = 1) {
  const body = { model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } }, { type: 'text', text: PROMPT(shopName) }] }] };
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  if ((r.status === 429 || r.status >= 500) && attempt < 4) { await sleep(2000 * attempt * attempt); return readImage(shopName, jpeg, attempt + 1); }
  const j = await r.json(); if (!r.ok) throw new Error('vision API: ' + (j.error && j.error.message || r.status));
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  try { const o = looseJson(text); return { validFrom: o.validFrom || null, validUntil: o.validUntil || null, offers: Array.isArray(o.offers) ? o.offers : [] }; }
  catch { return { validFrom: null, validUntil: null, offers: [], unreadable: true }; }
}

/** Read all pictures, a few at a time. */
async function extract(shopName, shots, { concurrency = 3, log = () => {} } = {}) {
  const out = new Array(shots.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, shots.length) }, async () => {
    while (next < shots.length) { const i = next++; out[i] = await readImage(shopName, shots[i]); log(`  picture ${i + 1}/${shots.length}: ${out[i].offers.length} offers`); }
  }));
  return out;
}
module.exports = { extract };
