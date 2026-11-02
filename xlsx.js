// spelers.xlsx: the whole lineup in one editable workbook. Written after every change, read back when edited or uploaded.
const fs = require('fs');
const ExcelJS = require('exceljs');

const PLAYER_COLS = [['Naam', 'name', 16], ['Leeftijd', 'age', 10], ['Is een', 'gender', 12], ['Valt op', 'orientation', 12], ['Crush 1 (teamgenoot)', 'c1', 24], ['Crush 2', 'c2', 24], ['Crush 3', 'c3', 24]];
const ADMIRER_COLS = [['Speler', 'player', 14], ['Aanbidder', 'answer', 22], ['Andere namen', 'aliases', 20], ['Wie', 'profile', 40],
  ['Hint 1 (vaag)', 'h1', 36], ['Hint 2', 'h2', 36], ['Hint 3', 'h3', 36], ['Hint 4', 'h4', 36], ['Hint 5 (bijna weggegeven)', 'h5', 36],
  ['Hangplek', 'hangout', 14], ['Sport', 'sport', 12], ['Eten', 'eten', 14], ['Kleur', 'kleur', 10], ['Stem (m/v)', 'voice', 10]];
const UITLEG = [
  'Droomtelefoon: spelers en aanbidders',
  '',
  'Dit bestand wordt na elke wijziging in het spel bijgewerkt. Je mag het zelf aanpassen en bewaren.',
  'Staat het spel in de lobby of de setup, dan leest het je wijzigingen meteen in. Tijdens een spel pas na "Reset".',
  '',
  'Blad Spelers: één rij per speler (2 tot 12). Is een: man, vrouw of anders. Valt op: mannen, vrouwen of allebei.',
  'Crush 1 wordt de teamgenoot van die speler.',
  '',
  'Blad Aanbidders: tien rijen per speler. De kolom Speler moet exact de naam uit blad Spelers bevatten.',
  'Rij volledig ingevuld: blijft zoals hij is.',
  'Alleen een naam bij Aanbidder, hints leeg: Claude schrijft de hints voor die ster.',
  'Minder dan tien rijen: Claude vult aan met nieuwe sterren.',
  'Andere namen: varianten die ook als juist gelden bij het raden, gescheiden door komma\'s.',
  '',
  'Het nummer van een aanbidder in het spel wordt bij elk spel opnieuw geschud.',
  '',
  'Voorbeeld Spelers:    Lotte | 31 | vrouw | mannen | Patrick Swayze | Nick Carter | Leonardo DiCaprio',
  'Voorbeeld Aanbidders: Lotte | Zac Efron | Efron | Amerikaanse acteur die doorbrak als zingende basketbalster. | Hint 1 … Hint 5 | de sporthal | volleybal | pizza | blauw | m',
  '',
  'Een ander bestand inladen: knop "Excel inladen" op de tv, of dit bestand vervangen in de projectmap.',
];

const FONT = { name: 'Arial', size: 11 };
function sheet(wb, name, cols) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width, style: { font: FONT, alignment: { vertical: 'top', wrapText: true } } }));
  const head = ws.getRow(1);
  head.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF3EA5' } };
  head.alignment = { vertical: 'middle' };
  return ws;
}

// The workbook's content in the same shape importXlsx returns, so "did anything change?" is a string compare.
function toRows(players, content) {
  return {
    players: players.map(p => ({ name: p.name, age: Number(p.age), gender: p.gender, orientation: p.orientation, crushes: [...p.crushes] })),
    admirers: Object.fromEntries(players.filter(p => content[p.name]?.admirers?.length).map(p => [p.name, content[p.name].admirers.map(a => ({
      answer: a.answer, aliases: a.aliases || [], profile: a.profile || '', clues: a.clues.filter(Boolean),
      attrs: { hangout: a.attrs?.hangout || '', sport: a.attrs?.sport || '', eten: a.attrs?.eten || '', kleur: a.attrs?.kleur || '' },
      voice: { gender: a.voice?.gender === 'f' ? 'f' : 'm' },
    }))])),
  };
}

async function exportXlsx(file, players, content) {
  const wb = new ExcelJS.Workbook();
  const sp = sheet(wb, 'Spelers', PLAYER_COLS);
  for (const p of players) sp.addRow({ name: p.name, age: p.age, gender: p.gender, orientation: p.orientation, c1: p.crushes[0], c2: p.crushes[1], c3: p.crushes[2] });
  sp.dataValidations.add('C2:C13', { type: 'list', allowBlank: true, formulae: ['"man,vrouw,anders"'] });
  sp.dataValidations.add('D2:D13', { type: 'list', allowBlank: true, formulae: ['"mannen,vrouwen,allebei"'] });
  const ad = sheet(wb, 'Aanbidders', ADMIRER_COLS);
  for (const p of players) for (const a of content[p.name]?.admirers || []) {
    ad.addRow({ player: p.name, answer: a.answer, aliases: (a.aliases || []).join(', '), profile: a.profile,
      h1: a.clues[0], h2: a.clues[1], h3: a.clues[2], h4: a.clues[3], h5: a.clues[4],
      hangout: a.attrs?.hangout, sport: a.attrs?.sport, eten: a.attrs?.eten, kleur: a.attrs?.kleur, voice: a.voice?.gender === 'f' ? 'v' : 'm' });
  }
  ad.dataValidations.add('A2:A200', { type: 'list', allowBlank: true, formulae: ['Spelers!$A$2:$A$13'] });
  ad.dataValidations.add('N2:N200', { type: 'list', allowBlank: true, formulae: ['"m,v"'] });
  const ui = wb.addWorksheet('Uitleg');
  ui.getColumn(1).width = 120;
  UITLEG.forEach((line, i) => { const c = ui.getCell(i + 1, 1); c.value = line; c.font = { ...FONT, bold: i === 0, size: i === 0 ? 14 : 11 }; });
  const tmp = `${file}.tmp`;
  await wb.xlsx.writeFile(tmp);
  fs.renameSync(tmp, file); // atomic: a reader never sees half a file
}

const key = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const GENDER = { man: 'man', m: 'man', vrouw: 'vrouw', v: 'vrouw', f: 'vrouw', anders: 'anders', x: 'anders' };
const ORIENT = { mannen: 'mannen', vrouwen: 'vrouwen', allebei: 'allebei', beide: 'allebei', bi: 'allebei' };

// Reads rows by header name, so reordered, renamed-ish or extra columns don't break it.
const ALIASES = {
  name: ['naam'], age: ['leeftijd', 'age'], gender: ['iseen', 'geslacht', 'gender'], orientation: ['valtop', 'orientatie', 'orientation'], c1: ['crush1'], c2: ['crush2'], c3: ['crush3'],
  player: ['speler'], answer: ['aanbidder', 'ster'], aliases: ['anderenamen', 'alias'], profile: ['wie', 'profiel'],
  h1: ['hint1'], h2: ['hint2'], h3: ['hint3'], h4: ['hint4'], h5: ['hint5'], hangout: ['hangplek'], sport: ['sport'], eten: ['eten'], kleur: ['kleur'], voice: ['stem'],
};
function rows(ws, cols) {
  const header = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = key(cell.text);
    const hit = cols.find(([, k]) => ALIASES[k].some(a => h.startsWith(a)));
    if (hit && !Object.values(header).includes(hit[1])) header[col] = hit[1];
  });
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const r = { _row: n };
    row.eachCell({ includeEmpty: false }, (cell, col) => { if (header[col]) r[header[col]] = String(cell.text ?? '').trim(); });
    if (Object.keys(r).length > 1) out.push(r);
  });
  return out;
}

async function importXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new Error('Dit is geen geldig Excel-bestand (.xlsx).'); }
  const find = name => wb.worksheets.find(w => key(w.name) === key(name));
  const sp = find('Spelers'), ad = find('Aanbidders');
  if (!sp) throw new Error('Blad "Spelers" ontbreekt in het Excel-bestand.');
  const players = rows(sp, PLAYER_COLS).filter(r => r.name).map(r => ({
    name: r.name, age: Number(r.age), gender: GENDER[key(r.gender)] || r.gender, orientation: ORIENT[key(r.orientation)] || r.orientation, crushes: [r.c1, r.c2, r.c3].map(c => c || ''),
  }));
  const admirers = {};
  for (const r of ad ? rows(ad, ADMIRER_COLS) : []) {
    if (!r.player || !r.answer) continue;
    const p = players.find(p => key(p.name) === key(r.player));
    if (!p) throw new Error(`Blad Aanbidders, rij ${r._row}: speler "${r.player}" staat niet in blad Spelers.`);
    (admirers[p.name] = admirers[p.name] || []).push({
      answer: r.answer, aliases: (r.aliases || '').split(',').map(s => s.trim()).filter(Boolean), profile: r.profile || '',
      clues: ['h1', 'h2', 'h3', 'h4', 'h5'].map(k => r[k]).filter(Boolean),
      attrs: { hangout: r.hangout || '', sport: r.sport || '', eten: r.eten || '', kleur: r.kleur || '' },
      voice: r.voice ? { gender: key(r.voice) === 'v' || key(r.voice) === 'f' ? 'f' : 'm' } : null,
    });
  }
  return { players, admirers };
}

module.exports = { exportXlsx, importXlsx, toRows };
