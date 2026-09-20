# supermarkt-folders

Downloads this week's folders and offer pages of Dutch supermarkets, reads the offers from them, and publishes one JSON file: `data/offers.json`.

It works the way a person does: open the folder, look at every page, write down product, deal and price. A headless browser takes pictures of the pages, and a vision model (Claude) reads the pictures. There is no per-shop parsing code, so a redesigned website does not break it. What can break it is a shop blocking automated visitors or moving its folder to another address, and the health checks below make that loud.

## Run it

```
npm install
npx playwright install chromium        # once
export ANTHROPIC_API_KEY=...
node src/run.js --shop hoogvliet --debug   # one shop, keeps the pictures in debug/hoogvliet/
node src/run.js                            # every shop in sources.json
npm test                                   # offline dry run with a fake site, no key needed
```

Look at the pictures in `debug/` first. If they show the offers, the rest works. If they show a cookie wall, a login or an error page, fix `sources.json`.

## sources.json

| field | meaning |
|---|---|
| `url` | the page a customer opens to see this week's offers or folder |
| `mode` | `scroll`: a long page. `flipbook`: a page-turning viewer (arrow-right turns the page; set `nextSelector` if it needs a click). `pdf`: the page links to a PDF (`pdfLinkPattern` picks the right link, or give `pdfUrl`) |
| `minOffers` | fewer offers than this means the run failed |
| `maxPages`, `waitMs` | how many pictures at most, and how long to wait for images to load |

The five addresses in the file are starting points that were **not checked from a live run**. Open each in a browser, and swap in the folder viewer's own address if the shop has one: those are usually the most complete.

## Every day, for free, on GitHub

`.github/workflows/scrape.yml` runs daily. Add the repository secret `ANTHROPIC_API_KEY` (Settings, Secrets and variables, Actions). The run commits `data/offers.json`, so its raw link is your API:

```
https://raw.githubusercontent.com/<you>/supermarkt-folders/main/data/offers.json
```

A shop whose folder is still valid is skipped, so most days read nothing and cost nothing.

## Health checks

- Fewer than `minOffers` offers, an error page, or too many unreadable pictures: the shop is marked `"ok": false`, **last week's good data is kept**, and the run ends red, so GitHub emails you.
- Doubles from overlapping pictures are removed. Offers with neither a deal nor a price are dropped. Prices are never guessed: the model is told to copy what is printed.
- Validity dates are read from the folder when printed. Otherwise six days are assumed (`validUntilGuessed: true`) and the shop is read again after two days.
- `data/history/<date>/<shop>.json` keeps every week, which gives you price history for free.

## The file

```json
{ "format": 1, "generated": "2026-09-21T04:31:07Z",
  "shops": { "jumbo": { "name": "Jumbo", "ok": true, "scraped": "2026-09-21", "validFrom": null, "validUntil": "2026-09-27", "pages": 12,
    "offers": [ { "product": "Calvé Pindakaas", "size": "650 g", "deal": "1+1 gratis", "price": 4.99, "normalPrice": 9.98, "note": null } ] } } }
```

## Cost

One picture costs roughly half a euro cent with Claude Haiku 4.5. Five shops at 10 to 40 pictures a week is about one to two euros a month. Set `FOLDER_MODEL` to a larger model if small print is misread; judge that on your first few folders.

## Limits, honestly

- A folder holds the offers, not the whole assortment. Regular shelf prices need a different source.
- The pipeline is tested offline only (`npm test`). Whether a shop serves its folder to a visitor from GitHub's network can only be found out by running it. If one blocks you, run this from your own server with cron instead: same command.
- A vision model can misread. Treat the output as a good shopping hint, and keep `normalPrice` and `deal` next to each other in any app so a person can sanity-check.
- The shops' terms generally do not welcome automated visitors. This visits one page per shop, once per folder, like a person would. Keep it that way.

MIT licence.
