'use strict';
// Step 3: tidy up, remove doubles (overlapping pictures show the same offer twice), and refuse bad results.
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const num = v => { if (typeof v === 'number') return isFinite(v) && v > 0 && v < 1000 ? +v.toFixed(2) : null; if (typeof v === 'string') { const n = parseFloat(v.replace(',', '.').replace(/[^0-9.]/g, '')); return isFinite(n) && n > 0 && n < 1000 ? +n.toFixed(2) : null; } return null; };
const str = (v, n) => typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, n) : null;
const key = o => (o.product + '|' + (o.deal || '') + '|' + (o.price ?? '')).toLowerCase().replace(/[^a-z0-9|.]+/g, '');

function merge(pages, today = new Date().toISOString().slice(0, 10)) {
  const seen = new Map(); let validFrom = null, validUntil = null, unreadable = 0;
  for (const pg of pages) {
    if (pg.unreadable) unreadable++;
    if (isDate(pg.validFrom) && !validFrom) validFrom = pg.validFrom;
    if (isDate(pg.validUntil) && !validUntil) validUntil = pg.validUntil;
    for (const raw of pg.offers || []) {
      const o = { product: str(raw && raw.product, 120), size: str(raw && raw.size, 40), deal: str(raw && raw.deal, 60), price: num(raw && raw.price), normalPrice: num(raw && raw.normalPrice), note: str(raw && raw.note, 80) };
      if (!o.product || (!o.deal && o.price == null)) continue;                 // an "offer" with no deal and no price is noise
      if (o.normalPrice != null && o.price != null && o.normalPrice <= o.price) o.normalPrice = null;
      if (!seen.has(key(o))) seen.set(key(o), o);
    }
  }
  // a folder never runs longer than two weeks; anything else is a misread date
  const span = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  if (validUntil && (span(today, validUntil) < -1 || span(today, validUntil) > 16)) validUntil = null;
  if (validFrom && (span(validFrom, today) < -8 || span(validFrom, today) > 16)) validFrom = null;
  return { validFrom, validUntil, offers: [...seen.values()], unreadable };
}
module.exports = { merge };
