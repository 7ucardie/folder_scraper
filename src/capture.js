'use strict';
// Step 1: look at the folder the way a person does, and take pictures of it.
// Working from pictures instead of the page's code is deliberate: shops redesign their sites all the time,
// but a folder page always shows a product, a deal and a price. That part does not break.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }

const COOKIE_BUTTONS = ['Alles accepteren', 'Accepteer alles', 'Alle cookies accepteren', 'Accepteren', 'Akkoord', 'Ja, ik accepteer', 'Accept all', 'OK'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = buf => crypto.createHash('md5').update(buf).digest('hex');

async function dismissCookies(page) {
  for (const label of COOKIE_BUTTONS) {
    const btn = page.getByRole('button', { name: label, exact: false }).first();
    try { if (await btn.isVisible({ timeout: 400 })) { await btn.click({ timeout: 1500 }); await sleep(600); return; } } catch {}
  }
}

/** A long page: scroll one screen at a time and photograph each screen. */
async function captureScroll(page, shop, max) {
  const shots = [], seen = new Set(); const step = 1400;
  for (let i = 0; i < max; i++) {
    await page.evaluate(y => window.scrollTo(0, y), i * step); await sleep(shop.waitMs || 900);   // let lazy images load
    const buf = await page.screenshot({ type: 'jpeg', quality: 72 }), h = hash(buf);
    if (seen.has(h)) break; seen.add(h); shots.push(buf);
    const done = await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4);
    if (done) break;
  }
  return shots;
}

/** A page-turning folder: photograph, press "next", stop when the picture no longer changes. */
async function captureFlipbook(page, shop, max) {
  const shots = []; let last = '';
  for (let i = 0; i < max; i++) {
    await sleep(shop.waitMs || 1200);
    const buf = await page.screenshot({ type: 'jpeg', quality: 72 }), h = hash(buf);
    if (h === last) break; last = h; shots.push(buf);
    if (shop.nextSelector) { const n = page.locator(shop.nextSelector).first(); if (!(await n.isVisible().catch(() => false))) break; await n.click().catch(() => {}); }
    else await page.keyboard.press('ArrowRight');
  }
  return shots;
}

/** A PDF folder: find the link, download it, turn each page into a picture (needs poppler's pdftoppm). */
async function capturePdf(page, shop, max) {
  const href = shop.pdfUrl || await page.evaluate(re => { const rx = re ? new RegExp(re, 'i') : null; const a = [...document.querySelectorAll('a[href]')].find(a => /\.pdf(\?|$)/i.test(a.href) && (!rx || rx.test(a.href + ' ' + a.textContent))); return a && a.href; }, shop.pdfLinkPattern || '');
  if (!href) throw new Error('no PDF link found on ' + shop.url);
  const res = await page.request.get(href); if (!res.ok()) throw new Error('PDF download failed: ' + res.status());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-')), file = path.join(dir, 'folder.pdf'); fs.writeFileSync(file, await res.body());
  execFileSync('pdftoppm', ['-jpeg', '-r', '90', '-l', String(max), file, path.join(dir, 'p')]);
  return fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort().map(f => fs.readFileSync(path.join(dir, f)));
}

const MONTHS = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };
/** "geldig van 14 september t/m 20 september" on the page, turned into dates near today. */
function validity(text) {
  const m = String(text).toLowerCase().match(/geldig[^.\n]{0,40}?(\d{1,2})\s+([a-z]+)\s+(?:t\/m|tot en met|-)\s+(\d{1,2})\s+([a-z]+)/); if (!m || !MONTHS[m[2]] || !MONTHS[m[4]]) return {};
  const now = new Date(), near = (d, mo) => { let best = null; for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) { const t = new Date(Date.UTC(y, mo - 1, d)); if (!best || Math.abs(t - now) < Math.abs(best - now)) best = t; } return best.toISOString().slice(0, 10); };
  return { validFrom: near(+m[1], MONTHS[m[2]]), validUntil: near(+m[3], MONTHS[m[4]]) };
}
async function capture(shop, { maxPages = 40, debugDir } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
    const page = await ctx.newPage();
    const resp = await page.goto(shop.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (resp && resp.status() >= 400) throw new Error('page answered ' + resp.status() + ' (blocked or moved?)');
    await sleep(2500); await dismissCookies(page);
    const hint = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 20000) : '').then(validity).catch(() => ({}));
    if (shop.follow) {   // the shop's page only embeds the real folder (for example a Publitas viewer): go to the folder itself
      const target = await page.evaluate(re => { const rx = new RegExp(re, 'i'); for (const el of document.querySelectorAll('iframe[src], a[href]')) { const u = el.src || el.href; if (rx.test(u)) return u; } return null; }, shop.follow);
      if (!target) throw new Error('no embedded folder matching "' + shop.follow + '" on ' + shop.url);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(3000); await dismissCookies(page); hint.folderUrl = target;
    }
    const max = Math.min(shop.maxPages || maxPages, 80);
    const shots = shop.mode === 'flipbook' ? await captureFlipbook(page, shop, max) : shop.mode === 'pdf' ? await capturePdf(page, shop, max) : await captureScroll(page, shop, max);
    if (debugDir) { fs.mkdirSync(debugDir, { recursive: true }); shots.forEach((b, i) => fs.writeFileSync(path.join(debugDir, String(i + 1).padStart(2, '0') + '.jpg'), b)); }
    return { shots, hint };
  } finally { await browser.close(); }
}
module.exports = { capture, validity };
