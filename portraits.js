// node portraits.js → local neon pop-art portraits with mflux (~11 s each), one uniform style for everyone.
// Co-players get public file names (they're on the board all game). Admirers get secret file names,
// so nobody can probe /avatars/<name>.png to find out which stars are in the game.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DATA = process.env.DATA_DIR || __dirname;
const DIR = path.join(__dirname, 'avatars');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]/g, '-');

let key;
function secret() {
  if (key) return key;
  const f = path.join(__dirname, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(16).toString('hex'));
  return (key = fs.readFileSync(f, 'utf8').trim());
}
const coFile = name => `${slug(name)}.png`; // drawn neon portrait (fallback)
const photoFile = name => `co-${slug(name)}.jpg`; // real profile photo from Wikipedia (preferred)
const portraitFile = name => `a-${crypto.createHash('sha256').update(`${secret()}|${slug(name)}`).digest('hex').slice(0, 20)}.png`;
module.exports = { coFile, photoFile, portraitFile };

// ---------- real photos of the co-players, from Wikipedia ----------
const UA = { 'User-Agent': 'Droomtelefoon/1.0 (private party game; local use) node-fetch' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(q, lang = 'en') { // Wikipedia rate-limits bursts: wait and retry instead of failing
  for (let i = 0; ; i++) {
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', redirects: '1', ...q })}`, { headers: UA });
    if (r.ok) return r.json();
    if (i === 3) throw new Error(`Wikipedia antwoordt ${r.status}`);
    await sleep(2000 * (i + 1));
  }
}
const usable = f => f && /\.(jpe?g|png)$/i.test(f) && !/logo|poster|cover|title|signature|wordmark/i.test(f);

async function wikiPhoto(query, lang = 'en') {
  const r = await api({ action: 'query', generator: 'search', gsrsearch: query, gsrlimit: '1', prop: 'pageimages|info', piprop: 'thumbnail|name', pithumbsize: '700', inprop: 'url' }, lang);
  const pg = Object.values(r.query?.pages || {})[0];
  return pg && usable(pg.pageimage) && pg.thumbnail ? { title: pg.title, page: pg.fullurl, file: pg.pageimage, src: pg.thumbnail.source } : null;
}
async function whoToShow(name) { // a fictional character or a nickname: ask Claude which real person to show
  let ai; try { ai = require('./ai'); } catch { return null; }
  if (!ai.enabled()) return null;
  const out = await ai.ask('Je helpt een partyspel aan profielfoto\'s. Antwoord strikt in JSON.',
    `Welke echte, bekende persoon hoort bij "${name}" als profielfoto? Bij een fictief personage: de acteur of actrice die het speelde. Geef de titel van het Engelstalige Wikipedia-artikel, of een lege string als je het niet zeker weet.`,
    { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } }, 200);
  return out.title || null;
}
const CREDITS = path.join(DIR, 'credits.json'), MOUTHS = path.join(DIR, 'mouths.json');
const readJ = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
async function knownPhoto(name) { // the photo picked earlier for this co-player, straight from Commons
  const c = readJ(CREDITS)[photoFile(name)]; if (!c) return null;
  const file = decodeURIComponent(c.file.split('File:')[1] || '');
  const r = await api({ action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '900' });
  const ii = Object.values(r.query?.pages || {})[0]?.imageinfo?.[0];
  return ii ? { title: c.shows.replace(/ \(via .*\)$/, ''), page: c.page, file, src: ii.thumburl || ii.url, via: c.shows.includes('(via') ? name : null } : null;
}
// Vision through osascript: face box and mouth box per image, normalised from the top-left
function faces(files) {
  if (!files.length) return {};
  try {
    const out = execFileSync('osascript', ['-l', 'JavaScript', path.join(__dirname, 'mouth.js'), ...files], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return Object.fromEntries(out.split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(f => !f.error).map(f => [f.file, f]));
  } catch { return {}; }
}
async function fetchPhoto(name) {
  const out = path.join(DIR, photoFile(name));
  let hit = await knownPhoto(name).catch(() => null), via = hit?.via || null;
  // Dutch Wikipedia first: Flemish stars often only live there, or rank wrong on the English one
  if (!hit) hit = await wikiPhoto(name, 'nl') || await wikiPhoto(name);
  if (!hit) { via = await whoToShow(name).catch(() => null); if (via) hit = await wikiPhoto(via, 'nl') || await wikiPhoto(via); }
  if (!hit) return false;
  const img = Buffer.from(await (await fetch(hit.src, { headers: UA })).arrayBuffer());
  const raw = `${out}.raw`;
  fs.writeFileSync(raw, img);
  // one uniform format: a square centred on the face (hair and chin included), 512 px
  const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', raw]).toString();
  const w = +dims.match(/pixelWidth: (\d+)/)[1], h = +dims.match(/pixelHeight: (\d+)/)[1];
  const f = faces([raw])[raw]?.face;
  let side, x, y;
  if (f) {
    side = Math.round(Math.min(w, h, f.h * h * 2.2));
    x = Math.round(Math.min(Math.max(0, (f.x + f.w / 2) * w - side / 2), w - side));
    y = Math.round(Math.min(Math.max(0, (f.y + f.h * 0.42) * h - side / 2), h - side));
  } else { side = Math.min(w, h); x = Math.round((w - side) / 2); y = 0; }
  execFileSync('sips', ['-s', 'format', 'jpeg', '--cropToHeightWidth', String(side), String(side), '--cropOffset', String(y), String(x), raw, '--out', out], { stdio: 'ignore' });
  execFileSync('sips', ['-Z', '512', out], { stdio: 'ignore' });
  fs.unlinkSync(raw);
  const meta = await api({ action: 'query', titles: `File:${hit.file}`, prop: 'imageinfo', iiprop: 'extmetadata|url' }).catch(() => ({}));
  const ext = Object.values(meta.query?.pages || {})[0]?.imageinfo?.[0]?.extmetadata || {};
  const credits = readJ(CREDITS);
  credits[photoFile(name)] = { for: name, shows: via ? `${hit.title} (via ${name})` : hit.title, page: hit.page, file: `https://commons.wikimedia.org/wiki/File:${hit.file}`,
    license: ext.LicenseShortName?.value || '', artist: (ext.Artist?.value || '').replace(/<[^>]+>/g, '').trim() };
  fs.writeFileSync(CREDITS, JSON.stringify(credits, null, 2));
  return true;
}

if (require.main === module) (async () => {
  const read = f => (fs.existsSync(path.join(DATA, f)) ? JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) : null);
  const players = read('players.json') || [], content = read('admirers.json') || {};
  fs.mkdirSync(DIR, { recursive: true });
  // 1. real photos for the co-players; whoever gets one needs no drawn portrait
  const photos = new Set();
  for (const co of [...new Set(players.map(p => p.coPlayer))]) {
    if (fs.existsSync(path.join(DIR, photoFile(co)))) { photos.add(co); continue; }
    try { if (await fetchPhoto(co)) { photos.add(co); console.log(`foto: ${co}`); } else console.log(`geen foto gevonden: ${co} (neonportret)`); }
    catch (e) { console.error(`foto mislukt: ${co}: ${e.message}`); }
  }
  // 2. drawn portraits: co-players without a photo first, then admirers round-robin so every player gets some early
  const jobs = players.filter(p => !photos.has(p.coPlayer)).map(p => [p.coPlayer, coFile(p.coPlayer)]);
  const lists = players.map(p => (content[p.name]?.admirers || []).map(a => [a.answer, portraitFile(a.answer)]));
  for (let i = 0; i < 10; i++) for (const l of lists) if (l[i]) jobs.push(l[i]);
  const todo = jobs.filter(([, f], i) => !fs.existsSync(path.join(DIR, f)) && jobs.findIndex(j => j[1] === f) === i);
  // --recrop: crop the chosen photos again (same photo, new crop), e.g. after changing the crop rules
  if (process.argv.includes('--recrop')) for (const co of photos) { fs.rmSync(path.join(DIR, photoFile(co)), { force: true }); await fetchPhoto(co).catch(e => console.error(co, e.message)); }
  console.log(`${todo.length} portretten te tekenen (namen van aanbidders blijven geheim)`);
  todo.forEach(([name, file], i) => {
    try {
      execFileSync('mflux-generate-flux2', ['--model', 'mflux-community/flux2-klein-4b-mflux-q4',
        '--prompt', `clean neon pop-art portrait bust of ${name} at the height of their fame, duotone hot pink and cyan on pure black background, bold flat shapes, 90s poster screenprint style, centered, looking at camera, no text`,
        '--width', '512', '--height', '512', '--steps', '4', '--seed', '7', '--output', path.join(DIR, file)], { stdio: 'ignore' });
      console.log(`${i + 1}/${todo.length}`);
    } catch (e) { console.error(e.code === 'ENOENT' ? 'mflux niet gevonden: geen getekende portretten' : `${i + 1}/${todo.length} mislukt`); if (e.code === 'ENOENT') process.exit(0); }
  });
  const coImgs = [...new Set(players.map(p => p.coPlayer))].map(co => [photoFile(co), coFile(co)].find(f => fs.existsSync(path.join(DIR, f)))).filter(Boolean);
  const mouths = readJ(MOUTHS), found = faces(coImgs.map(f => path.join(DIR, f)));
  for (const f of coImgs) { const m = found[path.join(DIR, f)]; if (m) mouths[f] = { x: m.x, y: m.y, w: m.w, h: m.h, chin: m.chin }; }
  fs.writeFileSync(MOUTHS, JSON.stringify(mouths, null, 2));
  console.log(`monden gevonden: ${Object.keys(found).length}/${coImgs.length}`);
})();
