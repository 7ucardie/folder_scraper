#!/usr/bin/env node
'use strict';
/* node src/prices.js
   Step 3: the normal shelf prices, for everything that is not on offer this week.
   These are not scraped here: the open data set of checkjebon.nl (MIT, github.com/supermarkt/checkjebon) already has them.
   Writes data/prices.json with only the shops from sources.json, and adds "products" to each offer in data/offers.json:
   the links of the products in prices.json that the offer is about. One offer is often many products ("Kwekkeboom, alle soorten").
   Exit code 1 when the download failed or a shop lost most of its products; the last good prices are kept. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const URL_ = process.env.PRICES_URL || 'https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json';
const MAX_LINKS = 40;   // an offer that matches more products than this is too vague to link ("Kaas")
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STOP = new Set('de het een van met in op voor per stuk stuks alle soorten diverse varianten smaken of en a'.split(' '));
const words = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w && !STOP.has(w));
// equal, or a plural or diminutive of it: one word starts with the other and is at most two letters longer ("multi" is not "multikorn")
const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 2 && (a.startsWith(b) || b.startsWith(a)));

/** "0,75 l", "33 CL", "500 milliliter", "6 x 0,33 l", "16 stuks" -> "750ml", "330ml", "500ml", "6x330ml", "16st". null when it is not one plain size. */
function parseSize(s) {
  const m = /^\s*(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|kilo|gram|gr|g|liter|litre|lt|l|ml|milliliter|cl|centiliter|dl|stuks|stuk|st|rollen|rol)\.?\s*$/i.exec(String(s || ''));
  if (!m) return null;
  const n = parseFloat(m[2].replace(',', '.')), u = m[3].toLowerCase();
  const [value, unit] = /^(kg|kilo)$/.test(u) ? [n * 1000, 'g'] : /^g/.test(u) ? [n, 'g'] : /^(l|lt|liter|litre)$/.test(u) ? [n * 1000, 'ml'] : /^(cl|centiliter)$/.test(u) ? [n * 10, 'ml'] : u === 'dl' ? [n * 100, 'ml'] : /^m/.test(u) ? [n, 'ml'] : [n, 'st'];
  return (m[1] ? m[1] + 'x' : '') + Math.round(value) + unit;
}

/** "Unox of Conimex soep in zak" -> [[unox, soep, zak], [unox], [conimex, soep, zak]]: what follows the last brand belongs to the earlier ones too, when that finds something. */
function alternatives(product) {
  const parts = String(product || '').split(/\s*(?:,|\/|\bof\b|\ben\b)\s*/i).map(words).filter(w => w.length);
  if (parts.length < 2) return parts.map(p => [p]);
  const tail = parts[parts.length - 1].slice(1);
  return parts.map((p, i) => i < parts.length - 1 && p.length === 1 && tail.length ? [p.concat(tail), p] : [p]);
}

/** The products an offer is about. `indexed` is [{ link, size, w: words(name) }]. Returns links, [] when nothing or too much matched. */
function matchOffer(offer, indexed) {
  // one word on its own is a brand or the product itself, and those stand at the front ("Monster Energy", "Hoogvliet Sperziebonen"); anywhere else it is a chance hit ("... extra fijn")
  const found = new Map(), hit = q => indexed.filter(p => q.every(t => (q.length === 1 ? p.w.slice(0, 2) : p.w).some(w => same(t, w))));
  for (const tries of alternatives(offer.product)) for (const q of tries) { const h = hit(q); if (h.length) { h.forEach(p => found.set(p.link, p)); break; } }
  let list = [...found.values()]; const size = parseSize(offer.size);
  if (size) list = list.filter(p => p.size === size);   // a printed pack size must agree: "Spruiten 500 gram" is not "Spruiten panklaar 350 gram"
  return list.length > MAX_LINKS ? [] : list.map(p => p.link).sort();
}

async function download(attempt = 1) {
  try { const r = await fetch(URL_); if (!r.ok) throw new Error('answered ' + r.status); const j = await r.json(); if (!Array.isArray(j)) throw new Error('not the expected list of shops'); return j; }
  catch (e) { if (attempt < 3) { await sleep(3000 * attempt); return download(attempt + 1); } throw new Error('price list ' + URL_ + ': ' + e.message); }
}

// one product per line, so the daily commit shows which prices moved
const write = (file, o) => fs.writeFileSync(file, JSON.stringify({ ...o, shops: '@' }, null, 1).replace('"@"', () => '{\n' + Object.entries(o.shops).map(([id, s]) =>
  `  ${JSON.stringify(id)}: ${JSON.stringify({ ...s, products: '@' }).replace('"@"', () => '[\n' + s.products.map(p => '   ' + JSON.stringify(p)).join(',\n') + '\n  ]')}`).join(',\n') + '\n }'));

async function main() {
  const OUT = path.join(DATA, 'prices.json'), OFFERS = path.join(DATA, 'offers.json');
  const wanted = Object.keys(JSON.parse(fs.readFileSync(process.env.SOURCES || path.join(ROOT, 'sources.json'), 'utf8')).shops);
  const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { shops: {} };
  const shops = {}, missing = []; let failed = 0, list = [];
  try { list = await download(); } catch (e) { failed++; console.error('FAILED: ' + e.message); }
  for (const id of wanted) {
    const src = list.find(s => s.n === id), old = previous.shops[id];
    const products = ((src && src.d) || []).filter(p => p.n && typeof p.p === 'number' && p.l).map(p => ({ name: p.n, price: p.p, size: p.s || null, link: p.l })).sort((a, b) => a.link < b.link ? -1 : a.link > b.link ? 1 : 0);
    if (old && products.length < old.products.length / 2) {   // keep the last good list rather than publishing half a shop
      if (list.length) { failed++; console.error(`FAILED: ${id} has ${products.length} products, last time ${old.products.length}; kept the old list`); }
      shops[id] = { ...old, stale: true }; continue;
    }
    if (!products.length) { missing.push(id); continue; }
    shops[id] = { name: src.c || id, productUrl: src.u || null, products };
  }
  const changed = JSON.stringify(shops) !== JSON.stringify(previous.shops) || JSON.stringify(missing) !== JSON.stringify(previous.missing || []);
  if (changed) { fs.mkdirSync(DATA, { recursive: true }); write(OUT, { format: 1, generated: new Date().toISOString(), source: 'https://github.com/supermarkt/checkjebon', missing, shops }); }
  console.log(`${changed ? 'Wrote' : 'No change in'} ${path.relative(ROOT, OUT)}: ` + Object.entries(shops).map(([k, v]) => `${k} ${v.products.length}${v.stale ? ' (old)' : ''}`).join(', ') + (missing.length ? `; no normal prices for ${missing.join(', ')}` : ''));

  if (fs.existsSync(OFFERS)) {
    const offers = JSON.parse(fs.readFileSync(OFFERS, 'utf8')), before = JSON.stringify(offers);
    for (const [id, shop] of Object.entries(offers.shops || {})) {
      const indexed = shops[id] ? shops[id].products.map(p => ({ link: p.link, size: parseSize(p.size), w: words(p.name) })) : null; let linked = 0;
      for (const o of shop.offers || []) { const links = indexed ? matchOffer(o, indexed) : []; if (links.length) { o.products = links; linked++; } else delete o.products; }
      if (indexed && (shop.offers || []).length) console.log(`  ${id}: ${linked} of ${shop.offers.length} offers linked to products`);
    }
    if (JSON.stringify(offers) !== before) fs.writeFileSync(OFFERS, JSON.stringify(offers, null, 1));
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { parseSize, alternatives, matchOffer, words };
