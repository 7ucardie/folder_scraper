'use strict';
// A dry run without the internet: a fake folder site and a fake vision API on localhost.
// It proves the plumbing (scroll, page-turning, PDF, de-duplication, health checks, skipping). It cannot prove that a real shop's site lets us in.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn, execFileSync } = require('child_process');
const card = (i) => `<div style="height:330px;margin:20px;padding:20px;border:2px solid #c00;font:28px sans-serif">Product ${i}<br><b>1+1 gratis</b><br>${(1 + i / 10).toFixed(2)}</div>`;
const scrollPage = `<html><body style="margin:0"><button onclick="this.remove()">Alles accepteren</button><h1>Aanbiedingen geldig t/m zondag</h1>${Array.from({ length: 14 }, (_, i) => card(i + 1)).join('')}</body></html>`;
const flipPage = `<html><body style="margin:0;font:120px sans-serif"><div id="p">Folder pagina 1</div><script>let n=1;document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'&&n<5){n++;document.getElementById('p').textContent='Folder pagina '+n}})</script></body></html>`;
let pdf = process.env.TEST_PDF ? fs.readFileSync(process.env.TEST_PDF) : null; if (!pdf) try { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-')); fs.writeFileSync(path.join(tmp, 'a.ps'), '%!PS\n/Helvetica findfont 40 scalefont setfont 72 700 moveto (Folder) show showpage\n72 700 moveto (Pagina 2) show showpage\n'); execFileSync('ps2pdf', [path.join(tmp, 'a.ps'), path.join(tmp, 'a.pdf')]); pdf = fs.readFileSync(path.join(tmp, 'a.pdf')); } catch {}
let calls = 0, openaiCalls = 0;
const site = http.createServer((q, r) => {
  if (q.url === '/scroll') return r.end(scrollPage); if (q.url === '/flip') return r.end(flipPage); if (q.url === '/blocked') { r.statusCode = 403; return r.end('no'); }
  if (q.url === '/landing') { const d = new Date(Date.now() + 2 * 864e5), mo = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']; return r.end(`<html><body><h4>Onderstaande folder is geldig van 1 ${mo[d.getMonth()]} t/m ${d.getDate()} ${mo[d.getMonth()]}</h4><iframe src="/flip?viewer=publitas-like"></iframe></body></html>`); }
  if (q.url.startsWith('/flip?')) return r.end(flipPage);
  if (q.url === '/pdfpage') return r.end('<a href="/folder.pdf">Download de folder (pdf)</a>'); if (q.url === '/folder.pdf') { r.setHeader('content-type', 'application/pdf'); return r.end(pdf); }
  // the same fake model behind both API shapes: Anthropic's /v1/messages and OpenAI's /v1/chat/completions
  if (q.url === '/v1/messages' || q.url === '/v1/chat/completions') { const openai = q.url !== '/v1/messages'; let b = ''; q.on('data', c => b += c); return q.on('end', () => { calls++; if (openai) openaiCalls++; const img = JSON.parse(b).messages[0].content[0];
    const ok = openai ? img.type === 'image_url' && img.image_url.url.startsWith('data:image/jpeg;base64,') && img.image_url.url.length > 1000 && q.headers.authorization === 'Bearer test-openai' : img.type === 'image' && img.source.data.length > 1000;
    // every picture "shows" two offers it shares with its neighbour and one of its own, like overlapping screenshots do
    const offers = ok ? [{ product: 'Calvé Pindakaas', size: '650 g', deal: '1+1 gratis', price: '4,99', normalPrice: 9.98 }, { product: 'Eigen product ' + calls, deal: null, price: 1.49 }, { product: 'Ruis zonder prijs', deal: null, price: null }] : [];
    const text = 'Here you go:\n```json\n' + JSON.stringify({ validFrom: null, validUntil: calls === 1 ? new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) : null, offers }) + '\n```';
    r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(openai ? { choices: [{ message: { role: 'assistant', content: text } }] } : { content: [{ type: 'text', text }] })); }); }
  r.statusCode = 404; r.end();
}).listen(0, async () => {
  const base = 'http://localhost:' + site.address().port, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-')), src = path.join(dir, 'sources.json');
  const shops = { scrollshop: { name: 'Scroll', url: base + '/scroll', mode: 'scroll', minOffers: 3, waitMs: 100 }, flipshop: { name: 'Flip', url: base + '/flip', mode: 'flipbook', minOffers: 3, waitMs: 150 }, embedshop: { name: 'Embed', url: base + '/landing', follow: 'viewer=publitas', mode: 'flipbook', minOffers: 3, waitMs: 150 }, blocked: { name: 'Blocked', url: base + '/blocked', mode: 'scroll', minOffers: 3 } };
  if (pdf) shops.pdfshop = { name: 'Pdf', url: base + '/pdfpage', mode: 'pdf', minOffers: 2 };
  fs.writeFileSync(src, JSON.stringify({ shops }));
  const out = path.join(__dirname, '..', 'data', 'offers.json'), keep = fs.readFileSync(out);
  const env = { ...process.env, SOURCES: src, ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: base };
  // not spawnSync: this process also serves the fake site, so it must stay responsive while the scraper runs
  const run = (extra, e = env) => new Promise(res => { const c = spawn('node', [path.join(__dirname, '..', 'src', 'run.js'), ...extra], { env: e }); let stdout = ''; c.stdout.on('data', d => stdout += d); c.stderr.on('data', d => stdout += d); c.on('close', status => res({ status, stdout })); });
  const a = await run(['--force']); console.log(a.stdout);
  const data = JSON.parse(fs.readFileSync(out, 'utf8')), s = data.shops, problems = [];
  for (const k of ['scrollshop', 'flipshop']) if (!s[k].offers || !s[k].offers.length) { console.log('TEST FAILED: ' + k + ' produced nothing'); fs.writeFileSync(out, keep); process.exit(1); }
  if (!s.scrollshop.ok || s.scrollshop.pages < 3) problems.push('scroll capture');
  if (s.scrollshop.offers.filter(o => o.product === 'Calvé Pindakaas').length !== 1) problems.push('doubles not removed');
  if (s.scrollshop.offers[0].price !== 4.99) problems.push('price "4,99" not read as 4.99');
  if (s.scrollshop.offers.some(o => o.product.startsWith('Ruis'))) problems.push('noise kept');
  if (!s.flipshop.ok || s.flipshop.pages !== 5) problems.push('flipbook should have 5 pages, got ' + s.flipshop.pages);
  if (pdf && (!s.pdfshop.ok || s.pdfshop.pages < 1)) problems.push('pdf folder not read');
  const in2 = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  if (!s.embedshop.ok || s.embedshop.pages !== 5 || s.embedshop.validUntil !== in2 || s.embedshop.validUntilGuessed) problems.push('embedded folder or printed dates: ' + JSON.stringify({ ok: s.embedshop.ok, pages: s.embedshop.pages, until: s.embedshop.validUntil }));
  const { validity } = require('../src/capture'), at = new Date('2026-09-21T12:00:00Z'), dates = t => JSON.stringify(validity(t, at));
  if (dates('Nu in de aanbieding\nTot en met dinsdag 22 sep\n') !== '{"validUntil":"2026-09-22"}') problems.push('"Tot en met dinsdag 22 sep" not read: ' + dates('Nu in de aanbieding\nTot en met dinsdag 22 sep\n'));
  if (dates('wo 16 t/m di 22 sep') !== '{}' || dates('de actie loopt tot en met 25 sep') !== '{}' || dates('\nTot en met zondag 31 dec') !== '{}') problems.push('an end date read from the wrong text');
  if (s.blocked.ok !== false || a.status !== 1) problems.push('a blocked shop must fail the run');
  const before = calls, b = await run([]); if (calls !== before || !/skipped/.test(b.stdout)) problems.push('valid folders should be skipped on the next run');
  // without an Anthropic key the OpenAI key is used; without either the run stops before opening anything
  const { ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, OPENAI_API_KEY, ...bare } = env;
  const c = await run(['--force', '--shop', 'scrollshop'], { ...bare, OPENAI_API_KEY: 'test-openai', OPENAI_BASE_URL: base }), viaOpenai = JSON.parse(fs.readFileSync(out, 'utf8')).shops.scrollshop;
  if (!openaiCalls || !viaOpenai.ok || !/\(openai\)/.test(c.stdout)) problems.push('OpenAI fallback: ' + JSON.stringify({ openaiCalls, ok: viaOpenai.ok }));
  const beforeNone = calls, d = await run(['--force'], bare); if (d.status !== 2 || calls !== beforeNone || !/ANTHROPIC_API_KEY or OPENAI_API_KEY/.test(d.stdout)) problems.push('no key must stop the run with exit code 2, got ' + d.status);
  fs.writeFileSync(out, keep); for (const k of Object.keys(shops)) fs.rmSync(path.join(__dirname, '..', 'data', 'history', new Date().toISOString().slice(0, 10), k + '.json'), { force: true });   // only the test's own files: real history stays
  console.log(problems.length ? 'TEST FAILED: ' + problems.join('; ') : `TEST PASSED (${calls} pictures read${pdf ? '' : ', PDF part skipped: ps2pdf not installed'})`);
  site.close(); process.exit(problems.length ? 1 : 0);
});
