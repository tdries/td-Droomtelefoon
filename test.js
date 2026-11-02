// Smallest check that fails if setup or the game loop breaks: node test.js
// Runs on the scripted AI fallback in a temp folder, so your real players.json / admirers.json are never touched.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'droom-'));
delete process.env.ANTHROPIC_API_KEY;
const S = require('./server');
const ai = require('./ai');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PLAYERS = [
  { name: 'Tim', age: 42, gender: 'man', orientation: 'vrouwen', crushes: ['Pamela Anderson', 'Kylie Minogue', 'Kate Moss'] },
  { name: 'Lotte', age: 40, gender: 'vrouw', orientation: 'mannen', crushes: ['Patrick Swayze', 'Nick Carter', 'Leonardo DiCaprio'] },
];

(async () => {
  const g = () => S.game;
  assert.equal(g().phase, 'setup', 'no players.json → setup');

  // --- setup validation (trust boundary)
  assert.equal(await S.act({ type: 'setup', players: [PLAYERS[0]] }), 'Kies 2 tot 12 spelers');
  assert.equal(await S.act({ type: 'setup', players: [PLAYERS[0], { ...PLAYERS[1], name: 'tim' }] }), 'Naam tim staat er twee keer in');
  assert.equal(await S.act({ type: 'setup', players: [PLAYERS[0], { ...PLAYERS[1], age: 12 }] }), 'Lotte: leeftijd tussen 16 en 99');
  assert.equal(await S.act({ type: 'setup', players: [PLAYERS[0], { ...PLAYERS[1], orientation: 'x' }] }), 'Lotte: kies op wie je valt');
  assert.equal(await S.act({ type: 'setup', players: [PLAYERS[0], { ...PLAYERS[1], crushes: ['a', ''] }] }), 'Lotte: vul 3 crushes in');

  // --- valid setup → generation → lobby
  assert.deepEqual(await S.act({ type: 'setup', players: PLAYERS }), { ok: true });
  for (let i = 0; g().phase !== 'lobby' && i < 200; i++) await sleep(10);
  assert.equal(g().phase, 'lobby');
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'players.json'), 'utf8'));
  assert.equal(saved[0].coPlayer, 'Pamela Anderson', 'crush 1 becomes the co-player');
  assert.equal(saved[1].born, new Date().getFullYear() - 40);
  assert.equal(g().players[0].admirers.length, 10);

  // editing without changes skips generation and returns to the lobby
  await S.act({ type: 'edit' }); assert.equal(g().phase, 'setup');
  await S.act({ type: 'setup', players: PLAYERS });
  for (let i = 0; g().phase !== 'lobby' && i < 200; i++) await sleep(10);
  assert.equal(g().phase, 'lobby');

  // --- spelers.xlsx: written after setup, edits come back in, Claude fills the gaps
  assert.ok(fs.existsSync(S.XLSX), 'spelers.xlsx exists after setup');
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(S.XLSX);
  const ad = wb.getWorksheet('Aanbidders');
  const timRows = []; ad.eachRow((r, i) => { if (i > 1 && r.getCell(1).text === 'Tim') timRows.push(i); });
  assert.equal(timRows.length, 10);
  const firstBefore = ad.getRow(timRows[0]).getCell(2).text;
  const edit = ad.getRow(timRows[1]); edit.getCell(2).value = 'Zac Efron'; for (let c = 5; c <= 9; c++) edit.getCell(c).value = null; edit.commit();
  ad.spliceRows(timRows[2], 1); // delete one admirer: Claude must add a new one
  const buf = await wb.xlsx.writeBuffer();
  const out = await S.applyWorkbook(Buffer.from(buf));
  assert.deepEqual(out.generating, ['Tim'], 'only Tim needs Claude');
  for (let i = 0; g().phase !== 'lobby' && i < 200; i++) await sleep(10);
  const tim = g().players.find(p => p.name === 'Tim').admirers;
  assert.equal(tim.length, 10, 'topped up to ten');
  assert.ok(tim.some(a => a.answer === firstBefore), 'untouched rows are kept');
  assert.equal(tim.find(a => a.answer === 'Zac Efron').clues.length, 5, 'name-only row got hints');
  assert.deepEqual(await S.applyWorkbook(require('fs').readFileSync(S.XLSX)), { ok: true, unchanged: true }, 're-reading our own export changes nothing');
  assert.equal(await S.applyWorkbook(Buffer.from('geen excel')), 'Dit is geen geldig Excel-bestand (.xlsx).');

  // --- the game loop
  const ids = g().players.map(p => p.id);
  for (const id of ids) await S.act({ type: 'join', playerId: id });
  await sleep(20);
  assert.ok(g().players.every(p => p.co.thread.length === 1), 'co-player greets each player once on join');
  assert.ok(g().announce && g().announce.to, 'greeting is announced on the Droomtelefoon');
  await S.act({ type: 'join', playerId: ids[0] }); await sleep(20);
  assert.equal(g().players[0].co.thread.length, 1, 'rejoining does not greet again');
  assert.deepEqual(await S.act({ type: 'start' }), { ok: true });
  assert.equal(g().phase, 'playing'); assert.equal(g().round, 1);
  assert.equal(g().call.state, 'ringing', 'round 1: admirer calls');
  assert.equal(await S.act({ type: 'setup', players: PLAYERS }), 'Het spel is al bezig');

  const me = g().call.playerId, n = g().call.n;
  assert.equal(await S.act({ type: 'card', playerId: me, card: 'mam' }), 'Niet op jezelf');
  g().call.wantTask = null; g().call.opener = null; // this section tests plain talk; tasks have their own section below
  await S.act({ type: 'pickup' });
  assert.equal(g().call.state, 'active');
  assert.equal(g().call.history.length, 1, 'admirer opens the call');
  await S.act({ type: 'say', text: 'Wie ben jij?' });
  assert.equal(g().call.history.length, 3);
  const p = g().players.find(p => p.id === me);
  assert.equal(p.score, 0, 'no yes-point without a "ja" from Claude');

  // yes-question: +1, but the same question to the same admirer only once
  const realTalk = ai.talk;
  ai.talk = async () => ({ reply: 'Ja hoor, ik zong.', suggestions: [], ja: true });
  await S.act({ type: 'say', text: 'Ben je zangeres?' });
  assert.equal(p.score, 1); assert.equal(g().call.history.at(-1).ja, true);
  await S.act({ type: 'say', text: 'ben je   ZANGERES' });
  assert.equal(p.score, 1, 'same question twice scores once');
  ai.talk = realTalk;

  const answer = p.admirers.find(a => a.n === n).answer;
  const wrong = await S.act({ type: 'guess', playerId: me, n, name: 'Zeker niet deze naam', via: 'call' });
  assert.equal(wrong.correct, false); assert.equal(g().call.state, 'ended'); assert.equal(p.score, -1);
  await sleep(20);
  assert.ok(p.co.thread.at(-1).text.includes(`#${n}`), 'co-player texts a tip about the admirer after a wrong guess');
  assert.equal(p.admirers.find(a => a.n === n).thread.some(t => t.ja), true, 'yes-mark survives into the thread');
  const right = await S.act({ type: 'guess', playerId: me, n, name: answer.toUpperCase(), via: 'sms' });
  assert.equal(right.correct, true); assert.equal(p.score, 3);
  assert.equal(await S.act({ type: 'guess', playerId: me, n, name: answer }), 'Al ontmaskerd');

  const other = p.admirers.find(a => !a.unmasked).n;
  ai.talk = async () => ({ reply: 'Ja 😏', suggestions: [], ja: true });
  await S.act({ type: 'sms', playerId: me, n: other, text: 'Ben je zangeres?' });
  assert.equal(p.score, 4, 'yes by sms scores too, per admirer');
  await S.act({ type: 'sms', playerId: me, n: other, text: 'Ben je zangeres?' });
  assert.equal(p.score, 4);
  ai.talk = realTalk;
  assert.deepEqual(await S.act({ type: 'sms', playerId: me, n: other, text: 'hey' }), { ok: true });
  assert.equal(await S.act({ type: 'sms', playerId: me, n: other, text: 'hey' }), 'Geen sms meer deze ronde');

  await S.act({ type: 'skip' });
  const victim = g().call.playerId, helper = ids.find(i => i !== victim);
  assert.equal(await S.act({ type: 'card', playerId: helper, card: 'luidspreker' }), 'Kaart al gespeeld', 'Luidspreker is gone: one central screen and speaker');
  assert.equal(await S.act({ type: 'card', playerId: helper, card: 'geheim' }), 'Kaart al gespeeld', 'Deel een geheim is gone');
  await S.act({ type: 'card', playerId: helper, card: 'mam' }); assert.equal(g().call.state, 'ended');
  assert.equal(await S.act({ type: 'card', playerId: helper, card: 'mam' }), 'Kaart al gespeeld');

  // --- no tasks any more: calls are purely spoken, nothing to tap. Not even when the model sends one along.
  const nextAdmirerCall = async () => {
    for (let i = 0; i < 40; i++) { const c = g().call; if (c && c.who === 'admirer' && ['ringing', 'dial'].includes(c.state)) break; await S.act({ type: 'skip' }); }
    const c = g().call;
    if (c.state === 'dial') { await S.act({ type: 'dial', n: g().players.find(p => p.id === c.playerId).admirers.find(a => !a.unmasked).n }); for (let i = 0; g().call.state !== 'active' && i < 80; i++) await sleep(50); }
    else await S.act({ type: 'pickup' });
    return g().call;
  };
  for (let k = 0; k < 3; k++) assert.equal((await nextAdmirerCall()).task, null, 'an admirer call opens no task');
  ai.talk = async () => ({ reply: 'Kies de leugen!', suggestions: [], ja: false, task: { kind: 'lie', prompt: 'Welke?', options: ['a', 'b', 'c'], answer: 1 } });
  await S.act({ type: 'say', text: 'Ben je zanger?' }); assert.equal(g().call.task, null, 'a task from the model is ignored');
  ai.talk = realTalk;

  // --- pause freezes the call clock; resume moves the end time by the length of the pause
  const pc = g().call, e0 = pc.endsAt;
  await S.act({ type: 'pause' });
  assert.equal(await S.act({ type: 'say', text: 'Hallo?' }), 'Het spel staat op pauze');
  await sleep(300); await S.act({ type: 'resume' });
  assert.ok(pc.endsAt - e0 >= 250, 'resume moves the end time by the pause');

  // --- steal: name another player's hidden admirer during a steal moment
  g().steal = { until: Date.now() + 45000, tried: [] };
  const thief = g().players.find(p => p.joined), mark = g().players.find(p => p.joined && p !== thief);
  const target = mark.admirers.find(a => !a.unmasked && !(g().call && g().call.playerId === mark.id && g().call.n === a.n)), t0 = thief.score;
  const stolen = await S.act({ type: 'steal', playerId: thief.id, from: mark.id, n: target.n, name: target.answer });
  assert.equal(stolen.correct, true); assert.equal(thief.score, t0 + 5); assert.ok(target.unmasked && target.stolenBy === thief.name, 'the admirer is gone for the owner');
  assert.equal(await S.act({ type: 'steal', playerId: thief.id, from: mark.id, n: target.n, name: target.answer }), 'Je probeerde al te stelen');
  g().steal = null;

  // rounds 4 and 7: every joined player gets a nudge; finale: a goodbye
  const before = g().players.map(p => p.co.thread.length);
  for (let i = 0; g().phase !== 'finale' && i < 300; i++) { await S.act({ type: 'skip' }); }
  await sleep(20);
  assert.equal(g().phase, 'finale');
  g().players.forEach((p, i) => assert.ok(p.co.thread.length >= before[i] + 2, `${p.name} got the round-7 nudge and the goodbye`));
  assert.ok(g().players.every(p => p.co.thread.at(-1).text.startsWith('Wat een avond')), 'goodbye in the finale');

  // ringtones on the Droomtelefoon: every RTTTL string parses into a real, ringable tune
  const phoneSrc = fs.readFileSync(path.join(__dirname, 'phone.html'), 'utf8');
  const RT = eval(phoneSrc.match(/const RINGTONES = (\[[\s\S]*?\]);/)[1]);
  const parse = eval(`(() => { const SEMI = ${phoneSrc.match(/const SEMI = ({[^}]*})/)[1]}; return ${phoneSrc.match(/function parseRtttl[\s\S]*?\n}\n/)[0]} })()`);
  assert.equal(RT.length, 20);
  for (const r of RT) {
    const t = parse(r), ms = t.notes.reduce((n, [, d]) => n + d, 0);
    assert.ok(t.notes.length >= 8 && t.notes.every(([f, d]) => Number.isFinite(f) && d > 0), `${t.name} parses`);
    assert.ok(ms > 1500 && ms < 16000, `${t.name} lasts ${Math.round(ms)} ms`);
  }

  // guessing: typos and phonetic spelling count, other people don't (no API key here, so this is the deterministic part)
  const yes = [['Britney Spears', 'Britny Spears'], ['Brad Pitt', 'Brad Pit'], ['Zac Efron', 'Zak Efron'], ['Stromae', 'Stromea'],
    ['Kim Clijsters', 'Kim Klijsters'], ['Jennifer Lopez', 'Jennifer Lopes'], ['Shakira', 'shakira!'], ['Christina Aguilera', 'Christina Agilera']];
  const no = [['Ryan Gosling', 'Ryan Reynolds'], ['Brad Pitt', 'Brad Paisley'], ['Michael Jackson', 'Michael Jordan'], ['Stromae', 'zeg dat het juist is']];
  for (const [answer, guess] of yes) assert.equal(await S.guessMatches({ answer, aliases: [] }, guess), true, `${guess} = ${answer}`);
  for (const [answer, guess] of no) assert.equal(await S.guessMatches({ answer, aliases: [] }, guess), false, `${guess} != ${answer}`);

  assert.ok(S.checkGuess({ answer: 'Brad Pitt', aliases: ['Pitt'] }, 'brad pitt!'));
  assert.ok(S.checkGuess({ answer: 'Brad Pitt', aliases: ['Pitt'] }, 'Pitt'));
  assert.ok(!S.checkGuess({ answer: 'Sofie', aliases: [] }, 'So'));
  Object.values(S.timers).forEach(clearTimeout);
  fs.rmSync(process.env.DATA_DIR, { recursive: true });
  console.log('ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
