#!/usr/bin/env node
'use strict';
/* node src/run.js [--shop jumbo] [--force] [--debug]
   Writes data/offers.json (the file other projects read) and data/history/<date>/<shop>.json.
   Exit code 1 when any shop failed its health check, so a scheduled run shows up red and sends an email. */
const fs = require('fs'), path = require('path');
const { capture, weekUrl } = require('./capture'), { extract, provider } = require('./extract'), { merge } = require('./merge');
const args = process.argv.slice(2), flag = n => args.includes('--' + n), opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'data', 'offers.json');
const sources = JSON.parse(fs.readFileSync(process.env.SOURCES || path.join(ROOT, 'sources.json'), 'utf8')).shops;
const today = new Date().toISOString().slice(0, 10);
const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { shops: {} };

(async () => {
  try { const p = provider(); console.log(`Vision model: ${p.model} (${p.name})`); } catch (e) { console.error(e.message); process.exit(2); }
  const result = { format: 1, generated: new Date().toISOString(), shops: { ...previous.shops } }; let failed = 0;
  for (const [id, source] of Object.entries(sources)) {
    const shop = { ...source, url: weekUrl(source.url) };
    if (opt('shop') && opt('shop') !== id) continue;
    const old = previous.shops[id];
    // A folder we already read is not read (and paid for) again. When the end date was a guess, look again after two days.
    const age = old && old.scraped ? (Date.parse(today) - Date.parse(old.scraped)) / 864e5 : 99;
    if (!flag('force') && old && old.ok && old.validUntil >= today && (!old.validUntilGuessed || age < 2)) { console.log(`${shop.name}: folder read on ${old.scraped} runs until ${old.validUntil}, skipped`); continue; }
    console.log(`${shop.name}: opening ${shop.url}`);
    try {
      const { shots, hint } = await capture(shop, { debugDir: flag('debug') ? path.join(ROOT, 'debug', id) : null });
      if (hint.folderUrl) console.log('  folder: ' + hint.folderUrl);
      console.log(`  ${shots.length} pictures taken`);
      if (!shots.length) throw new Error('nothing captured');
      const m = merge(await extract(shop.name, shots, { log: console.log }), today);
      if (hint.validUntil) { m.validFrom = hint.validFrom || m.validFrom; m.validUntil = hint.validUntil; }   // dates printed on the shop's own page beat dates read from a picture
      const min = shop.minOffers || 10;
      if (m.offers.length < min) throw new Error(`only ${m.offers.length} offers read, expected at least ${min}: the page probably changed or blocked us`);
      if (m.unreadable > shots.length / 3) throw new Error(`${m.unreadable} of ${shots.length} pictures could not be read`);
      const until = m.validUntil || new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
      result.shops[id] = { name: shop.name, ok: true, source: shop.url, scraped: today, validFrom: m.validFrom, validUntil: until, validUntilGuessed: !m.validUntil, pages: shots.length, offers: m.offers };
      const hist = path.join(ROOT, 'data', 'history', today); fs.mkdirSync(hist, { recursive: true }); fs.writeFileSync(path.join(hist, id + '.json'), JSON.stringify(result.shops[id], null, 1));
      console.log(`  OK: ${m.offers.length} offers, valid until ${until}${m.validUntil ? '' : ' (guessed)'}`);
    } catch (e) {
      failed++; console.error(`  FAILED: ${e.message}`);
      // keep last week's good data, clearly marked, rather than publishing rubbish or nothing
      result.shops[id] = { ...(old || { name: shop.name, offers: [] }), ok: false, error: String(e.message).slice(0, 200), failedOn: today };
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ` + Object.entries(result.shops).map(([k, v]) => `${k} ${v.ok ? v.offers.length : 'FAILED'}`).join(', '));
  process.exit(failed ? 1 : 0);
})();
