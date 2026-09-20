'use strict';
// The normal prices without the internet: a fake checkjebon file on localhost and a temporary data folder.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { parseSize, matchOffer, words } = require('../src/prices');
const problems = [], eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); };

eq(['0,75 l', '33 CL', '500 milliliter', '1.5 liter', '6 x 0,33 l', '16 stuks', '1 kilo', '0.3-0.25 liter', 'Alle soorten', null].map(parseSize), ['750ml', '330ml', '500ml', '1500ml', '6x330ml', '16st', '1000g', null, null, null], 'sizes');
const shelf = [['Calvé Pindakaas creamy', '350 gram', 'calve-creamy'], ['Calvé Pindakaas creamy', '650 gram', 'calve-creamy-650'], ['Unox Soep in zak tomaat', '570 milliliter', 'unox-tomaat'], ['Conimex Soep in zak kip', '570 milliliter', 'conimex-kip'], ['Unox Rookworst', '275 gram', 'unox-rookworst'],
  ['Hoogvliet Multikorn', '1 stuk', 'multikorn'], ['Dubro Multi ontvetter', '650 milliliter', 'dubro'], ['Hoogvliet Sperziebonen', '500 gram', 'sperziebonen'], ['Bonduelle Doperwten extra fijn', '400 gram', 'bonduelle'], ['Hoogvliet Spruiten panklaar', '350 gram', 'spruiten']];
const indexed = shelf.map(([n, s, link]) => ({ link, size: parseSize(s), w: words(n) })), links = (product, size) => matchOffer({ product, size: size || null }, indexed);
eq(links('Calvé pindakaas', '650 g'), ['calve-creamy-650'], 'the pack size picks the product');
eq(links('Calvé pindakaas'), ['calve-creamy', 'calve-creamy-650'], 'without a size every variety is linked');
eq(links('Unox of Conimex soep in zak', '570 ml'), ['conimex-kip', 'unox-tomaat'], 'what follows the last brand counts for the first brand too');
eq(links('Multikorn of Sallands Zonnepit'), ['multikorn'], '"multikorn" is not "multi"');
eq(links('Sperziebonen', '500 gram'), ['sperziebonen'], 'one word finds the house-brand product');
eq(links('Fijne of Italiaanse roerbakgroenten'), [], 'one word deep inside a name is a chance hit');
eq(links('Spruiten', '500 gram'), [], 'another pack size is another product');

const list = [{ n: 'ah', c: 'AH', u: 'https://ah.example/', d: [{ n: 'AH Pindakaas $& naturel', l: 'b-pindakaas', p: 2.19, s: '350 g' }, { n: 'AH Halfvolle melk', l: 'a-melk', p: 1.15, s: '1 l' }, { n: 'Zonder prijs', l: 'x', s: '1 l' }] }, { n: 'aldi', c: 'ALDI', u: '', d: [] }, { n: 'plus', c: 'PLUS', u: '', d: [{ n: 'Niet gevraagd', l: 'p', p: 1, s: '' }] }];
let serve = list;
const site = http.createServer((q, r) => { if (!serve) { r.statusCode = 500; return r.end(); } r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(serve)); }).listen(0, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-')), src = path.join(dir, 'sources.json'), out = path.join(dir, 'prices.json'), offersFile = path.join(dir, 'offers.json');
  fs.writeFileSync(src, JSON.stringify({ shops: { ah: {}, aldi: {}, nettorama: {} } }));
  fs.writeFileSync(offersFile, JSON.stringify({ format: 1, shops: { ah: { name: 'AH', ok: true, offers: [{ product: 'AH pindakaas', size: '350 gram', price: 1.79 }, { product: 'Iets onbekends', products: ['old-link'] }] }, aldi: { name: 'Aldi', ok: true, offers: [{ product: 'Melk' }] } } }));
  const env = { ...process.env, SOURCES: src, DATA_DIR: dir, PRICES_URL: 'http://localhost:' + site.address().port + '/supermarkets.json' };
  const run = () => new Promise(res => { const c = spawn('node', [path.join(__dirname, '..', 'src', 'prices.js')], { env }); let stdout = ''; c.stdout.on('data', d => stdout += d); c.stderr.on('data', d => stdout += d); c.on('close', status => res({ status, stdout })); });

  const a = await run(); console.log(a.stdout); const p = JSON.parse(fs.readFileSync(out, 'utf8')), o = JSON.parse(fs.readFileSync(offersFile, 'utf8'));
  eq(a.status, 0, 'exit code'); eq(Object.keys(p.shops), ['ah'], 'only the shops from sources.json that have products'); eq(p.missing, ['aldi', 'nettorama'], 'shops without normal prices are named');
  eq(p.shops.ah.products, [{ name: 'AH Halfvolle melk', price: 1.15, size: '1 l', link: 'a-melk' }, { name: 'AH Pindakaas $& naturel', price: 2.19, size: '350 g', link: 'b-pindakaas' }], 'products: sorted, and without the one that has no price');
  eq(o.shops.ah.offers.map(x => x.products || null), [['b-pindakaas'], null], 'offers are linked, and a link that no longer holds is removed'); eq(o.shops.ah.offers[0].price, 1.79, 'the rest of the offer is untouched');
  if (fs.readFileSync(out, 'utf8').split('\n').length < 8) problems.push('one product per line');

  const stamp = fs.statSync(out).mtimeMs, b = await run(); if (fs.statSync(out).mtimeMs !== stamp || !/No change/.test(b.stdout)) problems.push('an unchanged price list must not be written again (no empty daily commits)');
  serve = [{ ...list[0], d: [] }]; const c = await run(); eq([c.status, JSON.parse(fs.readFileSync(out, 'utf8')).shops.ah.products.length], [1, 2], 'a shop that lost its products: red run, old list kept');
  serve = null; const d = await run(); eq([d.status, JSON.parse(fs.readFileSync(out, 'utf8')).shops.ah.products.length], [1, 2], 'download failed: red run, old list kept');
  console.log(problems.length ? 'TEST FAILED:\n  ' + problems.join('\n  ') : 'TEST PASSED (normal prices)');
  site.close(); process.exit(problems.length ? 1 : 0);
});
