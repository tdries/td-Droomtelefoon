// Droomtelefoon — the TV is the board, one phone (or the laptop) is the Droomtelefoon, everyone else's phone is their notebook.
// Plain http + SSE. Game logic lives in act(); ai.js talks to Claude (with scripted fallback).
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
// .env (written by the double-click launchers): KEY=value lines; real environment variables win. Must run before ai.js reads the key.
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); } } catch {}
const { spawn } = require('child_process');
const ai = require('./ai');
const { coFile, photoFile, portraitFile } = require('./portraits');
const { exportXlsx, importXlsx, toRows } = require('./xlsx');

const DATA = process.env.DATA_DIR || __dirname; // tests point this at a temp dir
const FILE = f => path.join(DATA, f);

const PORT = process.env.PORT || 3000, HTTPS_PORT = process.env.HTTPS_PORT || 3443;
let httpsOn = false; // set once the https server listens
const ROUNDS = Number(process.env.ROUNDS || 10);
const CALL_SECONDS = { admirer: 45, co: 20 }, PAUSE_SECONDS = [10, 20], // rust tussen twee gesprekken: willekeurig 10-20 s (Tim 2026-10-31)
  STEAL_MINUTES = +process.env.STEAL_MINUTES || 10, STEAL_SECONDS = 45, STEAL_POINTS = 5, // steelmoment: elke 10 min, 45 s lang (Tim 2026-10-31)
  MAX_EXCHANGES = 4, SMS_PER_ROUND = 3, RING_SECONDS = 45, CARD_WINDOW = 10; // talk time per caller (Tim's choice)
const CO_ROUNDS = new Set([2, 5, 8]);
const TASK_KINDS = [], // geen opdrachten meer: alles wat je moest aanklikken is weg, gesprekken zijn puur gesproken (Tim 2026-10-31); handlers staan er nog
  TASK_CHANCE = 0.67, VOTE_SECONDS = 15;
const media = new Map(); // id -> { buf, type, kind, player, n, round }  (drawings and selfies, kept for the TV)
const COLORS = ['#ff2d9b', '#2ef2ff', '#b4ff3c', '#ffe600', '#ff8a00', '#7b2cff', '#ff4fd8', '#5bd400', '#ff6b6b', '#ffb3e6'];

const slug = s => s.toLowerCase().replace(/[^a-z0-9]/g, '-');
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const shuffle = a => a.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);

let game, timers = {};
const clients = new Set(); // {res, role, id}

// Signature of a player's setup answers: admirers are regenerated only when these change.
const sig = p => JSON.stringify([p.age, p.gender, p.orientation, p.crushes]);
const readJson = (f, dflt) => (fs.existsSync(FILE(f)) ? JSON.parse(fs.readFileSync(FILE(f), 'utf8')) : dflt);
// Portraits appear while portraits.js is still drawing them: a missing file is re-checked at most every 15 s.
const seen = new Map();
function fileUrl(file) {
  const hit = seen.get(file);
  if (hit && (hit.url || Date.now() - hit.t < 15000)) return hit.url;
  const url = fs.existsSync(path.join(__dirname, 'avatars', file)) ? `/avatars/${file}` : null;
  seen.set(file, { url, t: Date.now() });
  return url;
}
const avatarOf = name => fileUrl(photoFile(name)) || fileUrl(coFile(name)); // real photo first, drawn portrait as fallback
// mouth box per co-player image (from portraits.js / macOS Vision), for the talking face on the Droomtelefoon
let mouthCache = { t: 0, data: {} };
function mouthOf(name) {
  const f = path.join(__dirname, 'avatars', 'mouths.json');
  try { const t = fs.statSync(f).mtimeMs; if (t !== mouthCache.t) mouthCache = { t, data: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return null; }
  const url = avatarOf(name); return url ? mouthCache.data[path.basename(url)] || null : null;
}
const imgOf = a => fileUrl(portraitFile(a.answer));

// Every co-player and admirer gets its own voice slot, counted per gender, so no two characters sound alike.
function voiceSlots(players, content) {
  const next = { f: 0, m: 0 }, slot = v => ({ pitch: 1, rate: 1, ...v, gender: v?.gender === 'f' ? 'f' : 'm', slot: next[v?.gender === 'f' ? 'f' : 'm']++ });
  for (const p of players) {
    const c = content[p.name]; if (!c) continue;
    c.coVoice = slot(c.coVoice);
    c.admirers = c.admirers.map(a => ({ ...a, voice: slot(a.voice) }));
  }
}
function load() {
  const players = readJson('players.json', []);
  const content = readJson('admirers.json', {});
  voiceSlots(players, content);
  const ready = p => content[p.name]?.sig === sig(p);
  game = {
    code: Math.random().toString(36).slice(2, 6).toUpperCase(), round: 0, turnIndex: 0, order: [], call: null, feed: [], gen: null,
    phase: players.length && players.every(ready) ? 'lobby' : 'setup',
    draft: players.map(({ name, age, gender, orientation, crushes }) => ({ name, age, gender, orientation, crushes })),
    players: players.map((p, i) => {
      const c = ready(p) ? content[p.name] : null;
      return {
        ...p, id: slug(p.name), color: COLORS[i % COLORS.length], joined: false, score: 0, wrong: 0, smsLeft: SMS_PER_ROUND,
        cards: { mam: true }, ready: !!c, // Luidspreker and Deel een geheim are gone: one central screen and speaker, everyone hears everything (Tim 2026-10-31)
        co: { name: p.coPlayer, persona: c?.coPersona || '', voice: c?.coVoice || { gender: 'm', pitch: 1, rate: 1 }, avatar: null, thread: [] },
        admirers: shuffle(c ? c.admirers : []).map((a, n) => ({ ...a, n: n + 1, calls: 0, unmasked: false, thread: [] })),
      };
    }),
  };
}

// ---------- setup ----------
const GENDERS = ['man', 'vrouw', 'anders'], ORIENTATIONS = ['mannen', 'vrouwen', 'allebei'];
function validSetup(list) {
  if (!Array.isArray(list) || list.length < 2 || list.length > 12) return 'Kies 2 tot 12 spelers';
  const out = [], ids = new Set();
  for (const [i, raw] of list.entries()) {
    const name = String(raw?.name || '').trim().slice(0, 16), id = slug(name), who = name || `Speler ${i + 1}`;
    if (!name || !/[a-z0-9]/.test(id)) return `Speler ${i + 1}: naam ontbreekt`;
    if (ids.has(id)) return `Naam ${name} staat er twee keer in`;
    ids.add(id);
    const age = Number(raw.age);
    if (!Number.isInteger(age) || age < 16 || age > 99) return `${who}: leeftijd tussen 16 en 99`;
    if (!GENDERS.includes(raw.gender)) return `${who}: kies man, vrouw of anders`;
    if (!ORIENTATIONS.includes(raw.orientation)) return `${who}: kies op wie je valt`;
    const crushes = (Array.isArray(raw.crushes) ? raw.crushes : []).map(c => String(c || '').trim().slice(0, 40));
    if (crushes.length !== 3 || crushes.some(c => !c)) return `${who}: vul 3 crushes in`;
    out.push({ name, age, born: new Date().getFullYear() - age, gender: raw.gender, orientation: raw.orientation, crushes, coPlayer: crushes[0] });
  }
  return out;
}

const busyGen = () => game.gen && Object.values(game.gen).some(v => v === 'wacht' || v === 'bezig');
// plans[name] = { keep, fill } from an imported workbook; without a plan a player is generated only when their answers changed.
async function generateAll(players, plans = {}) {
  const content = readJson('admirers.json', {});
  const todo = players.filter(p => plans[p.name] || content[p.name]?.sig !== sig(p));
  game.gen = Object.fromEntries(players.map(p => [p.name, todo.includes(p) ? 'wacht' : 'klaar']));
  broadcast();
  const worker = async () => { // ponytail: 4 at a time keeps us under API rate limits; raise if your tier allows
    for (let p; (p = todo.shift());) {
      game.gen[p.name] = 'bezig'; broadcast();
      try {
        content[p.name] = { ...(await ai.generatePlayer(p, plans[p.name])), coPlayer: p.coPlayer, sig: sig(p) };
        fs.writeFileSync(FILE('admirers.json'), JSON.stringify(content, null, 2));
        game.gen[p.name] = 'klaar';
      } catch (e) { console.error('[gen]', p.name, e.message); game.gen[p.name] = 'fout: ' + e.message; }
      broadcast();
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  await saveXlsx();
  if (Object.values(game.gen).every(v => v === 'klaar')) { load(); broadcast(); if (isMain) makeAvatars(); }
}

// ---------- spelers.xlsx: always in the project, editable, replaceable ----------
const XLSX = FILE('spelers.xlsx');
let xlsxSeen = 0, xlsxPending = false; // mtime we last wrote or read, so the watcher only reacts to outside edits
const notice = (text, ok = true) => { game.notice = { text, ok, t: Date.now() }; broadcast(); };
const current = () => JSON.stringify(toRows(readJson('players.json', []), readJson('admirers.json', {})));

async function saveXlsx() {
  try {
    if (fs.existsSync(XLSX) && JSON.stringify(await importXlsx(fs.readFileSync(XLSX))) === current()) return; // already up to date: leave an open Excel alone
  } catch { /* unreadable: overwrite */ }
  try { await exportXlsx(XLSX, readJson('players.json', []), readJson('admirers.json', {})); xlsxSeen = fs.statSync(XLSX).mtimeMs; }
  catch (e) { console.error('[excel]', e.message); }
}

// A workbook becomes players.json + admirers: complete rows are kept, name-only rows and missing rows go to Claude.
async function applyWorkbook(buffer) {
  if (!['setup', 'lobby'].includes(game.phase)) return 'Het spel is bezig: Excel inladen kan in de lobby of de setup.';
  if (busyGen()) return 'Claude is nog aan het zoeken';
  let data; try { data = await importXlsx(buffer); } catch (e) { return e.message; }
  if (JSON.stringify(data) === current()) return { ok: true, unchanged: true };
  const players = validSetup(data.players);
  if (typeof players === 'string') return `Blad Spelers: ${players}`;
  const old = readJson('admirers.json', {}), oldPlayers = readJson('players.json', []), content = { ...old }, plans = {};
  for (const p of players) {
    const prev = old[p.name], rows = (data.admirers[p.name] || []).slice(0, 10);
    const was = a => prev?.admirers.find(x => norm(x.answer) === norm(a.answer));
    const keep = rows.filter(r => r.clues.length >= 3).map(r => ({
      answer: r.answer, aliases: r.aliases, profile: r.profile || was(r)?.profile || '', persona: was(r)?.persona || 'charmant en zelfzeker',
      attrs: { ...(was(r)?.attrs || {}), ...Object.fromEntries(Object.entries(r.attrs).filter(([, v]) => v)) },
      clues: [...r.clues, ...Array(5).fill(r.clues.at(-1))].slice(0, 5),
      voice: { pitch: 1, rate: 1, ...(was(r)?.voice || {}), ...(r.voice || {}) },
    }));
    const fill = rows.filter(r => r.clues.length < 3).map(r => r.answer);
    const sameCo = prev?.coPersona && (prev.coPlayer || oldPlayers.find(o => o.name === p.name)?.coPlayer) === p.coPlayer;
    if (keep.length === 10 && sameCo) content[p.name] = { coPersona: prev.coPersona, coVoice: prev.coVoice, coPlayer: p.coPlayer, admirers: keep, sig: sig(p) };
    else plans[p.name] = { keep, fill };
  }
  fs.writeFileSync(FILE('players.json'), JSON.stringify(players, null, 2));
  fs.writeFileSync(FILE('admirers.json'), JSON.stringify(content, null, 2));
  game.phase = 'setup'; game.draft = players.map(({ name, age, gender, orientation, crushes }) => ({ name, age, gender, orientation, crushes }));
  generateAll(players, plans);
  return { ok: true, generating: Object.keys(plans) };
}

async function importFromDisk() {
  xlsxPending = false;
  let buf; try { buf = fs.readFileSync(XLSX); xlsxSeen = fs.statSync(XLSX).mtimeMs; } catch { return; }
  const out = await applyWorkbook(buf);
  if (typeof out === 'string') { console.error('[excel]', out); notice(`spelers.xlsx niet ingelezen: ${out}`, false); }
  else if (!out.unchanged) notice(out.generating.length ? `spelers.xlsx ingelezen. Claude vult aan voor: ${out.generating.join(', ')}.` : 'spelers.xlsx ingelezen.');
}
function watchXlsx() {
  fs.watchFile(XLSX, { interval: 2000 }, cur => {
    if (!cur.mtimeMs || cur.mtimeMs === xlsxSeen) return;
    if (['setup', 'lobby'].includes(game.phase) && !busyGen()) importFromDisk(); else xlsxPending = true; // during a game: after "Reset"
  });
}

function makeAvatars() { // local portraits of co-players and admirers; the board uses initials/silhouettes until they exist
  const child = spawn(process.execPath, [path.join(__dirname, 'portraits.js')], { stdio: 'ignore', env: { ...process.env, DATA_DIR: DATA } });
  child.on('error', e => console.error('[portretten]', e.message));
}

const P = id => game.players.find(p => p.id === id);
const feed = (text, color = '#fff') => { game.feed.unshift({ text, color, t: Date.now() }); game.feed.length = Math.min(game.feed.length, 8); };
const level = (p, a) => Math.min(5, a.calls + 1 + (game.round >= 7 ? 2 : game.round >= 4 ? 1 : 0));
// Co-player texts the player (async, never blocks the game). announce = also spoken by the Droomtelefoon in the lobby.
function coSms(p, reason, target, announce) {
  ai.coSms({ co: p.co, player: p, admirers: p.admirers, target, reason })
    .catch(e => { console.error('ai', e.message); return null; })
    .then(text => {
      if (!text) return;
      p.co.thread.push({ role: 'assistant', text, via: 'sms', round: game.round });
      if (announce && game.phase === 'lobby') game.announce = { text, from: p.co.name, to: p.name, voice: p.co.voice, t: Date.now() };
      broadcast();
    });
}
// every game timer goes through later()/stop(), so the pause button can freeze the pending ones and resume them where they were
const due = {}; // name -> { fn, at }
const later = (name, ms, fn) => { clearTimeout(timers[name]); due[name] = { fn, at: Date.now() + ms }; if (!game.paused) timers[name] = setTimeout(() => { delete due[name]; fn(); broadcast(); }, ms); };
const stop = name => { clearTimeout(timers[name]); delete due[name]; };
function pause() { game.paused = { at: Date.now() }; for (const n of Object.keys(due)) clearTimeout(timers[n]); feed('Pauze: de klok staat stil', '#ffe600'); }
function resume() {
  const shift = Date.now() - game.paused.at, c = game.call; game.paused = null;
  if (c?.endsAt) c.endsAt += shift; if (c?.cardsUntil) c.cardsUntil += shift; if (game.steal) game.steal.until += shift;
  for (const [n, d] of Object.entries(due)) later(n, Math.max(0, d.at + shift - Date.now()), d.fn);
  feed('Verder spelen!', '#ffe600');
}

// ---------- views ----------
function pub() {
  const c = game.call;
  return {
    code: game.code, phase: game.phase, round: game.round, rounds: ROUNDS, turnIndex: game.turnIndex, order: game.order, feed: game.feed,
    ai: ai.enabled(), joinUrl: `http://${lanIp()}:${PORT}/play`, phoneUrl: httpsOn ? `https://${lanIp()}:${HTTPS_PORT}/phone` : `http://${lanIp()}:${PORT}/phone`,
    setup: game.phase === 'setup' ? { draft: game.draft, gen: game.gen } : null,
    greet: game.phase === 'lobby' ? game.announce || null : null,
    notice: game.notice || null, paused: !!game.paused,
    steal: game.steal ? { until: game.steal.until, tried: game.steal.tried } : null,
    phoneOnline: [...clients].some(c => c.role === 'phone'),
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color, joined: p.joined, ready: p.ready, score: p.score, wrong: p.wrong, smsLeft: p.smsLeft, cards: p.cards,
      co: { name: p.co.name, avatar: avatarOf(p.co.name), mouth: mouthOf(p.co.name) },
      slots: p.admirers.map(a => { const shown = a.unmasked || game.phase === 'finale'; return { n: a.n, calls: a.calls, unmasked: a.unmasked, stolen: a.stolenBy || null, name: shown ? a.answer : null, profile: shown ? a.profile : null, img: shown ? imgOf(a) : null }; }),
    })),
    gallery: (game.gallery || []).slice(-24),
    call: c && { task: c.task && { kind: c.task.kind, prompt: c.task.prompt, options: c.task.options, phase: c.task.phase, ok: c.task.ok, voted: Object.keys(c.task.votes || {}), votes: Object.values(c.task.votes || {}).filter(Boolean).length, voteEnds: c.task.voteEnds }, paused: !!c.pausedAt, media: c.media || null,
      playerId: c.playerId, who: c.who, n: c.n, state: c.state, outgoing: !!c.outgoing, level: c.level, speaker: c.speaker, secretTo: c.secretTo, endsAt: c.endsAt, cardsUntil: c.cardsUntil, exchanges: c.history.filter(h => h.role === 'user').length, result: c.result },
  };
}
function privateFor(id) {
  const p = P(id); if (!p) return null;
  return {
    id: p.id, name: p.name, score: p.score, smsLeft: p.smsLeft, cards: p.cards, co: { name: p.co.name, avatar: avatarOf(p.co.name), thread: p.co.thread },
    admirers: p.admirers.map(a => ({ n: a.n, calls: a.calls, unmasked: a.unmasked, name: a.unmasked ? a.answer : null, profile: a.unmasked ? a.profile : null, img: a.unmasked ? imgOf(a) : null, thread: a.thread })),
    liveCall: game.call && (game.call.playerId === id || game.call.secretTo.includes(id)) ? { history: game.call.history, n: game.call.n, who: game.call.who } : null,
  };
}
function view(client) {
  const v = { pub: pub() };
  const c = game.call;
  if (client.role === 'phone' && c) v.call = { history: c.history, suggestions: c.suggestions, voice: c.voice, callerName: c.who === 'co' ? P(c.playerId).co.name : null, playerName: P(c.playerId).name, lockedSlots: P(c.playerId).admirers.filter(a => !a.unmasked).map(a => a.n) };
  if (client.role === 'host' && c && c.speaker) v.call = { history: c.history, voice: c.voice, who: c.who };
  if (client.role === 'player') v.me = privateFor(client.id);
  return v;
}
function broadcast() { for (const cl of clients) cl.res.write(`data: ${JSON.stringify(view(cl))}\n\n`); }

// ---------- turn flow ----------
function startTurn() {
  if (game.turnIndex >= game.order.length) {
    game.turnIndex = 0; game.round++;
    for (const p of game.players) p.smsLeft = SMS_PER_ROUND;
    if ((game.round === 4 || game.round === 7) && game.round <= ROUNDS) for (const p of game.players.filter(p => p.joined)) {
      const target = p.admirers.filter(a => !a.unmasked).sort((a, b) => b.thread.length - a.thread.length)[0]; // the one they know most about
      if (target) coSms(p, `Ronde ${game.round} begint. Geef een duwtje richting aanbidder #${target.n}: één nieuwe, concrete tip.`, target);
    }
  }
  if (game.round > ROUNDS) return finale();
  const p = P(game.order[game.turnIndex]);
  const locked = p.admirers.filter(a => !a.unmasked);
  if (!locked.length) { game.turnIndex++; return startTurn(); }
  const base = { playerId: p.id, history: [], suggestions: [], secretTo: [], speaker: false, result: null, cardsUntil: Date.now() + CARD_WINDOW * 1000 };
  if (CO_ROUNDS.has(game.round)) {
    const target = locked.sort((a, b) => a.calls - b.calls)[0];
    game.call = { ...base, who: 'co', n: target.n, state: 'ringing', voice: p.co.voice, level: 0 };
  } else if (game.round % 2 === 1) {
    const a = shuffle(locked).sort((x, y) => x.calls - y.calls)[0];
    game.call = { ...base, who: 'admirer', n: a.n, state: 'ringing', voice: a.voice, level: level(p, a), wantTask: pickTask(p) };
  } else {
    game.call = { ...base, who: 'admirer', n: null, state: 'dial', voice: null, level: 0, wantTask: pickTask(p) };
  }
  if (game.call.state === 'ringing') game.call.opener = fetchReply(game.call);
  later('ring', RING_SECONDS * 1000, () => { if (game.call && ['ringing', 'dial'].includes(game.call.state)) endCall('Niet opgenomen'); });
}
function nextTurn() { game.call = null; game.turnIndex++; startTurn(); }
function endCall(reason) {
  const c = game.call; if (!c || c.state === 'ended') return;
  stop('call'); stop('ring'); stop('vote');
  c.state = 'ended'; c.result = c.result || reason; c.endsAt = null;
  const p = P(c.playerId);
  if (c.history.length) {
    const entry = c.history.map(h => ({ ...h, via: 'call', round: game.round }));
    (c.who === 'co' ? p.co.thread : p.admirers.find(a => a.n === c.n).thread).push(...entry);
  }
  // result stays on the board 4 s, then the board rests until the next call rings
  later('next', 4000, () => { game.call = null; later('next', (PAUSE_SECONDS[0] - 4 + Math.random() * (PAUSE_SECONDS[1] - PAUSE_SECONDS[0])) * 1000, nextTurn); });
}
// ---------- steelmoment: every STEAL_MINUTES all phones may steal one admirer of another player by naming it ----------
function scheduleSteal() { later('steal', STEAL_MINUTES * 60000, openSteal); }
function openSteal() {
  if (game.phase !== 'playing') return;
  game.steal = { until: Date.now() + STEAL_SECONDS * 1000, tried: [] };
  feed(`STEEL AANBIDDER! Ken je de naam van andermans aanbidder? Steel hem: +${STEAL_POINTS}`, '#ffe600');
  notice(`STEEL AANBIDDER! ${STEAL_SECONDS} seconden: kijk op je gsm`);
  later('stealEnd', STEAL_SECONDS * 1000, () => { game.steal = null; scheduleSteal(); });
}
function finale() {
  game.phase = 'finale'; game.call = null;
  for (const p of game.players) if (p.admirers.every(a => a.unmasked)) { p.score += 10; feed(`${p.name}: alles ontmaskerd, +10`, p.color); }
  for (const p of game.players.filter(p => p.joined)) p.co.thread.push({ role: 'assistant', text: `Wat een avond! Je ontmaskerde ${p.admirers.filter(a => a.unmasked).length} van de 10. Ik ben trots op je, ${p.name}.`, via: 'sms', round: game.round });
}

// The reply is fetched as early as possible: the opener while the phone still rings, so pickup is instant.
function pickTask(p) { // two calls out of three carry a task, never the same kind twice in a row for this player
  if (Math.random() > TASK_CHANCE) return null;
  const kind = shuffle(TASK_KINDS.filter(k => k !== p.lastTask))[0];
  p.lastTask = kind; return kind;
}
function fetchReply(c, userText, extra = {}) {
  const p = P(c.playerId);
  if (c.who === 'co') return ai.coTalk({ co: p.co, player: p, admirers: p.admirers, target: p.admirers.find(a => a.n === c.n), history: c.history, userText })
    .catch(e => { console.error('ai', e.message); return { reply: 'Krrrr... slechte verbinding. Vraag het nog eens.', suggestions: ['Hallo?', 'Ben je er nog?', 'Wie is dit?'] }; });
  const a = p.admirers.find(a => a.n === c.n);
  const wantTask = !userText && !c.task && c.wantTask ? c.wantTask : null; // the task comes with the opener
  return ai.talk({ channel: 'call', admirer: a, player: p, level: c.level, history: c.history, userText, playerCalled: !!c.outgoing, past: a.thread, wantTask, ...extra })
    .catch(e => { console.error('ai', e.message); return { reply: 'Krrrr... slechte verbinding. Vraag het nog eens.', suggestions: ['Hallo?', 'Ben je er nog?', 'Wie is dit?'], task: null }; });
}
async function admirerSpeaks(c, userText, extra) {
  const out = await (userText || extra ? fetchReply(c, userText, extra) : (c.opener || fetchReply(c)));
  if (game.call !== c || c.state !== 'active') return;
  const p = P(c.playerId);
  const ja = !!userText && !extra && c.who === 'admirer' && yesPoint(p, p.admirers.find(a => a.n === c.n), userText, out.ja);
  c.history.push({ role: 'assistant', text: out.reply, ja, task: out.task ? out.task.kind : undefined });
  c.suggestions = out.suggestions || [];
  if (out.task && TASK_KINDS.includes(out.task.kind) && !c.task) openTask(c, out.task); // only kinds that are switched on
}

// ---------- tasks: the admirer asks the player (and the room) to do something; the clock stops meanwhile ----------
function openTask(c, t) {
  c.task = { ...t, phase: 'open', since: Date.now(), votes: {} };
  c.pausedAt = Date.now(); stop('call');
  if (c.task.kind === 'lie') c.task.secret = c.task.answer; // never sent to clients
  delete c.task.answer;
}
function resumeClock(c) {
  if (!c.pausedAt) return;
  c.endsAt += Date.now() - c.pausedAt; c.pausedAt = null;
  later('call', Math.max(500, c.endsAt - Date.now()), () => endCall('Tijd om'));
}
async function finishTask(c, ok, userText) {
  const p = P(c.playerId), t = c.task, kind = t.kind;
  t.phase = 'done'; t.ok = ok; stop('vote');
  if (ok) { p.score += 1; p.tasks = (p.tasks || 0) + 1; feed(`${p.name} deed de opdracht van #${c.n} (${TASK_NAMES[kind]}) · +1`, p.color); }
  else feed(`${p.name} faalde voor #${c.n}: ${TASK_NAMES[kind]}`, '#ff6b6b');
  resumeClock(c); broadcast();
  await admirerSpeaks(c, userText || '(opdracht)', ok ? { taskDone: kind } : { taskFailed: kind });
  if (game.call === c) c.task = null;
}
const TASK_NAMES = { ask: 'wedervraag', draw: 'tekening', selfie: 'selfie', lie: 'leugendetector', act: 'doe-opdracht' };
function resolveVote(c) {
  const t = c.task; if (!t || t.phase !== 'voting') return;
  const v = Object.values(t.votes), up = v.filter(Boolean).length;
  return finishTask(c, v.length === 0 || up * 2 >= v.length, '(de kamer stemde)');
}
function storeMedia(c, dataUrl, kind) {
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > 1.5e6) return null;
  const id = Math.random().toString(36).slice(2, 10), p = P(c.playerId);
  media.set(id, { buf: Buffer.from(m[2], 'base64'), type: m[1], kind, player: p.name, n: c.n, round: game.round, t: Date.now() });
  if (media.size > 150) media.delete(media.keys().next().value); // ponytail: ~10 MB cap, oldest out
  (game.gallery = game.gallery || []).push({ id, kind, player: p.name, color: p.color, n: c.n, round: game.round });
  return { id, data: m[2], type: m[1] };
}

// +1 when a yes/no question about the admirer is truthfully answered "ja" (Claude judges it in the same reply).
// The same question to the same admirer only scores once, in calls and texts together.
function yesPoint(p, a, question, ja) {
  if (!ja || !a) return false;
  const key = norm(question);
  a.yesAsked = a.yesAsked || new Set();
  if (!key || a.yesAsked.has(key)) return false;
  a.yesAsked.add(key);
  p.score += 1; p.yes = (p.yes || 0) + 1;
  feed(`${p.name} kreeg "ja" van #${a.n} · +1`, p.color);
  return true;
}

function checkGuess(a, name) {
  const g = norm(name); if (g.length < 2) return false;
  return [a.answer, ...(a.aliases || [])].some(x => { const n = norm(x); return n === g || g.includes(n) || (g.length >= 4 && n.includes(g)); });
}
// Spelling that sounds the same collapses to one form (Dutch ears): ph=f, c=k/s, y=ij=i, z=s, th=t, double letters single.
const phon = s => norm(s).replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/qu/g, 'kw')
  .replace(/ij/g, 'i').replace(/y/g, 'i').replace(/z/g, 's').replace(/th/g, 't').replace(/dt\b/g, 't').replace(/(.)\1+/g, '$1');
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// A guess counts when it is the name (or part of it), sounds the same, or has a few typos.
// Close-but-unsure guesses go to Claude; anything far from the name never reaches Claude (no talking it into a "yes").
async function guessMatches(a, name) {
  if (checkGuess(a, name)) return true;
  const g = phon(name), names = [a.answer, ...(a.aliases || [])].map(phon).filter(Boolean);
  if (g.length < 3) return false;
  if (names.some(n => lev(g, n) <= (n.length <= 5 ? 1 : n.length <= 10 ? 2 : 3))) return true;
  if (!ai.enabled()) return false; // ponytail: every miss goes to the Claude jury (~1 s), so a phonetic spelling never fails on string distance (Tim 2026-10-31)
  return ai.sameName(String(name).slice(0, 60), a.answer, a.aliases || []).catch(e => { console.error('ai', e.message); return false; });
}

// ---------- actions ----------
async function act(body) {
  const c = game.call, p = body.playerId && P(body.playerId);
  if (game.paused && !['resume', 'reset', 'join'].includes(body.type)) return 'Het spel staat op pauze';
  switch (body.type) {
    case 'setup': {
      if (!['setup', 'lobby'].includes(game.phase)) return 'Het spel is al bezig';
      if (busyGen()) return 'Claude is nog aan het zoeken';
      const players = validSetup(body.players);
      if (typeof players === 'string') return players;
      fs.writeFileSync(FILE('players.json'), JSON.stringify(players, null, 2));
      game.phase = 'setup'; game.draft = players.map(({ name, age, gender, orientation, crushes }) => ({ name, age, gender, orientation, crushes }));
      generateAll(players);
      break;
    }
    case 'edit': if (game.phase !== 'lobby') return 'Kan nu niet'; game.phase = 'setup'; game.gen = null; break;
    case 'join':
      if (!p) return 'Onbekende speler';
      if (!p.joined && game.phase === 'lobby') coSms(p, `Begroet ${p.name} in de lobby: vanavond ben jij de teamgenoot die helpt de geheime aanbidders te ontmaskeren. Gebruik je catchphrase.`, null, true);
      p.joined = true; break;
    case 'start': {
      const joined = game.players.filter(p => p.joined);
      if (game.phase !== 'lobby' || !joined.length) return 'Nog geen spelers';
      if (joined.some(p => !p.ready)) return `Nog geen aanbidders voor: ${joined.filter(p => !p.ready).map(p => p.name).join(', ')}`;
      game.phase = 'playing'; game.round = 1; game.order = shuffle(joined.map(p => p.id)); game.turnIndex = 0;
      feed('Het spel is begonnen. Wie is jouw Geheime Aanbidder?', '#ffe600');
      startTurn(); scheduleSteal(); break;
    }
    case 'dial': {
      if (!c || c.state !== 'dial') return 'Niet aan het bellen';
      const pl = P(c.playerId), a = pl.admirers.find(a => a.n === Number(body.n));
      if (!a || a.unmasked) return 'Ongeldig nummer';
      Object.assign(c, { n: a.n, voice: a.voice, level: level(pl, a), state: 'ringing', outgoing: true, cardsUntil: Date.now() });
      c.opener = fetchReply(c);
      // ponytail: the admirer "picks up" once the opener is ready (min 2 rings), so the ringback tone hides the wait
      const pick = () => { if (game.call !== c || c.state !== 'ringing') return; if (game.paused) return later('autopick', 1000, pick); act({ type: 'pickup' }).then(broadcast); };
      Promise.all([c.opener, new Promise(r => setTimeout(r, 2500))]).then(pick);
      break;
    }
    case 'pickup': {
      if (!c || c.state !== 'ringing') return 'Er belt niemand';
      stop('ring');
      const pl = P(c.playerId);
      const talk = CALL_SECONDS[c.who] * 1000;
      c.state = 'active'; c.endsAt = Date.now() + talk;
      if (c.who === 'admirer') pl.admirers.find(a => a.n === c.n).calls++;
      later('call', talk, () => endCall('Tijd om'));
      broadcast();
      await admirerSpeaks(c);
      break;
    }
    case 'say': {
      if (!c || c.state !== 'active') return 'Geen gesprek';
      const text = String(body.text || '').trim().slice(0, 200); if (!text) return 'Zeg iets';
      if (c.history.filter(h => h.role === 'user').length >= MAX_EXCHANGES) return 'Genoeg gepraat, raad of hang op';
      c.history.push({ role: 'user', text }); c.suggestions = [];
      broadcast();
      if (c.task?.kind === 'ask' && c.task.phase === 'open') { await finishTask(c, true, text); break; }
      if (c.task && c.task.phase !== 'done') { // another task is waiting: no hints until it's done (or passed)
        c.history.push({ role: 'assistant', text: { lie: 'Eerst de leugen eruit halen, schat. Welke van de drie?', draw: 'Eerst tekenen, dan praten we verder.', selfie: 'Eerst die selfie, dan krijg je meer van mij.', act: 'Doe het eerst voor de kamer, dan laat ik de kamer stemmen.' }[c.task.kind] });
        break;
      }
      await admirerSpeaks(c, text);
      break;
    }
    case 'hangup': if (!c || c.state === 'ended') return 'Geen gesprek'; endCall('Opgehangen'); break;
    case 'pick': { // lie detector: which statement is the lie?
      if (!c || c.state !== 'active' || c.task?.kind !== 'lie' || c.task.phase !== 'open') return 'Geen leugendetector bezig';
      const i = Number(body.i); if (![0, 1, 2].includes(i)) return 'Kies 1, 2 of 3';
      c.history.push({ role: 'user', text: `Gelogen: "${c.task.options[i]}"` });
      await finishTask(c, i === c.task.secret, `Ik denk dat "${c.task.options[i]}" gelogen is.`);
      break;
    }
    case 'image': { // drawing or selfie, as a data URL from the Droomtelefoon
      if (!c || c.state !== 'active' || c.who !== 'admirer') return 'Geen gesprek';
      const forTask = c.task && ['draw', 'selfie'].includes(c.task.kind) && c.task.phase === 'open';
      const m = storeMedia(c, body.image, forTask ? c.task.kind : 'selfie'); if (!m) return 'Geen bruikbare foto';
      const p = P(c.playerId), a = p.admirers.find(a => a.n === c.n);
      c.media = { id: m.id, kind: forTask ? c.task.kind : 'selfie' };
      c.history.push({ role: 'user', text: forTask ? (c.task.kind === 'draw' ? '🎨 (tekening gestuurd)' : '🤳 (selfie gestuurd)') : '🤳 (selfie gestuurd)', media: m.id });
      broadcast();
      let out;
      try { out = await ai.judgeImage({ admirer: a, player: p, level: c.level, task: forTask ? c.task : null, image: m.data, mediaType: m.type, spontaneous: !forTask }); }
      catch (e) { console.error('ai', e.message); out = { reply: 'Krrrr... de foto kwam niet door. Probeer nog eens.', ok: false }; }
      if (game.call !== c || c.state !== 'active') return { ok: true };
      if (forTask) {
        const t = c.task; t.phase = 'done'; t.ok = !!out.ok;
        if (out.ok) { p.score += 1; p.tasks = (p.tasks || 0) + 1; feed(`${p.name} deed de opdracht van #${c.n} (${TASK_NAMES[t.kind]}) · +1`, p.color); }
        else feed(`${p.name}: #${c.n} vond de ${TASK_NAMES[t.kind]} niet goed genoeg`, '#ff6b6b');
        resumeClock(c);
      }
      c.history.push({ role: 'assistant', text: out.reply, seen: out.seen }); c.suggestions = [];
      if (forTask && out.ok) c.task = null; // a failed task may be retried
      else if (forTask) c.task.phase = 'open';
      break;
    }
    case 'done': { // act: the player performed for the room, now the room votes
      if (!c || c.state !== 'active' || c.task?.kind !== 'act' || c.task.phase !== 'open') return 'Geen doe-opdracht bezig';
      const others = game.players.filter(p => p.joined && p.id !== c.playerId);
      if (!others.length) { await finishTask(c, true, '(gedaan)'); break; }
      c.task.phase = 'voting'; c.task.voteEnds = Date.now() + VOTE_SECONDS * 1000;
      later('vote', VOTE_SECONDS * 1000, () => resolveVote(c));
      break;
    }
    case 'vote': {
      if (!p) return 'Onbekende speler';
      if (!c || c.task?.phase !== 'voting') return 'Er wordt nu niet gestemd';
      if (p.id === c.playerId) return 'Niet op jezelf';
      c.task.votes[p.id] = !!body.up;
      if (Object.keys(c.task.votes).length >= game.players.filter(q => q.joined && q.id !== c.playerId).length) { stop('vote'); await resolveVote(c); }
      break;
    }
    case 'pass': { // the player skips the task: no point, the clock runs again, the admirer teases
      if (!c || c.state !== 'active' || !c.task || c.task.phase === 'done') return 'Geen opdracht bezig';
      const t = c.task; t.phase = 'done'; t.ok = false; stop('vote');
      feed(`${P(c.playerId).name} sloeg de ${TASK_NAMES[t.kind]} van #${c.n} over`, '#aaa');
      resumeClock(c);
      c.history.push({ role: 'assistant', text: 'Jammer... dan ook geen extra hint. Stel me maar een vraag.' }); c.suggestions = [];
      c.task = null; break;
    }
    case 'guess': {
      if (!p) return 'Onbekende speler';
      const a = p.admirers.find(a => a.n === Number(body.n));
      if (!a || a.unmasked) return 'Al ontmaskerd';
      const viaCall = c && c.state === 'active' && c.playerId === p.id && c.who === 'admirer' && c.n === a.n;
      if (!viaCall && body.via === 'call') return 'Niet in gesprek met dit nummer';
      if (await guessMatches(a, body.name)) {
        a.unmasked = true;
        const pts = viaCall ? (a.calls <= 1 ? 10 : a.calls === 2 ? 7 : 5) : 4;
        p.score += pts;
        feed(`${p.name} ontmaskerde #${a.n}: ${a.answer} · +${pts}`, p.color);
        p.co.thread.push({ role: 'assistant', text: `Yes! #${a.n} was ${a.answer}. Ik wist dat je het kon.`, via: 'sms', round: game.round });
        if (viaCall) { c.history.push({ role: 'assistant', text: `Ja... je hebt me door. Het is ${a.answer}. Eindelijk.` }); c.result = `Juist! +${pts}`; endCall(c.result); }
        return { ok: true, correct: true, pts, answer: a.answer };
      }
      p.score -= 2; p.wrong++;
      feed(`${p.name} gokte fout op #${a.n}: "${String(body.name).trim().slice(0, 30)}" · −2`, '#ff6b6b');
      coSms(p, `${p.name} gokte net fout op #${a.n} (gok: "${String(body.name).slice(0, 40)}"). Troost kort en geef een nieuwe, concrete tip over #${a.n}.`, a);
      if (viaCall) { c.history.push({ role: 'assistant', text: 'Haha, nee. Zo makkelijk ben ik niet. Dag!' }); c.result = 'Fout · −2'; endCall(c.result); }
      return { ok: true, correct: false };
    }
    case 'sms': {
      if (!p) return 'Onbekende speler';
      if (game.phase !== 'playing') return 'Spel niet bezig';
      const a = p.admirers.find(a => a.n === Number(body.n));
      if (!a || a.unmasked) return 'Ongeldig nummer';
      if (p.smsLeft <= 0) return 'Geen sms meer deze ronde';
      const text = String(body.text || '').trim().slice(0, 200); if (!text) return 'Typ iets';
      p.smsLeft--;
      a.thread.push({ role: 'user', text, via: 'sms', round: game.round });
      broadcast();
      const lvl = Math.max(1, level(p, a) - 1);
      let out;
      try { out = await ai.talk({ channel: 'sms', admirer: a, player: p, level: lvl, history: a.thread.filter(h => h.via === 'sms'), userText: text }); }
      catch (e) { console.error('ai', e.message); out = { reply: '...' }; }
      a.thread.push({ role: 'assistant', text: out.reply, via: 'sms', round: game.round, ja: yesPoint(p, a, text, out.ja) });
      break;
    }
    case 'card': {
      if (!p || !p.cards[body.card]) return 'Kaart al gespeeld';
      if (!c || c.state === 'ended' || c.state === 'dial') return 'Er is geen gesprek';
      if (c.playerId === p.id) return 'Niet op jezelf';
      p.cards[body.card] = false;
      const target = P(c.playerId).name;
      if (body.card === 'luidspreker') { c.speaker = true; feed(`${p.name}: Luidspreker! Iedereen hoort ${target}`, p.color); }
      if (body.card === 'geheim') { c.secretTo.push(p.id); feed(`${p.name} speelde Deel een geheim op ${target}`, p.color); }
      if (body.card === 'mam') { c.result = 'Mam zegt: ophangen!'; feed(`Mam zegt: ophangen! ${target} verliest de beurt (${p.name})`, '#ff2d9b'); endCall(c.result); }
      break;
    }
    case 'steal': {
      const s = game.steal;
      if (!p || !s || Date.now() > s.until) return 'Geen steelmoment';
      if (s.tried.includes(p.id)) return 'Je probeerde al te stelen';
      const v = P(body.from), a = v && v.admirers.find(a => a.n === Number(body.n));
      if (!v || v.id === p.id || !v.joined) return 'Kies een andere speler';
      if (!a || a.unmasked) return 'Die is al ontmaskerd';
      if (c && c.who === 'admirer' && c.playerId === v.id && c.n === a.n && c.state !== 'ended') return 'Die is nu aan de lijn';
      s.tried.push(p.id);
      if (await guessMatches(a, body.name)) {
        if (a.unmasked) return 'Te laat, die is net ontmaskerd';
        a.unmasked = true; a.stolenBy = p.name; p.score += STEAL_POINTS;
        feed(`${p.name} STAL #${a.n} van ${v.name}: ${a.answer} · +${STEAL_POINTS}`, p.color);
        coSms(v, `${p.name} stal net jouw aanbidder #${a.n} (${a.answer}). Troost ${v.name} kort en plaag ${p.name} een beetje.`, null);
        return { ok: true, correct: true, pts: STEAL_POINTS, answer: a.answer };
      }
      p.score -= 2; p.wrong++;
      feed(`${p.name} wou #${a.n} van ${v.name} stelen: "${String(body.name).trim().slice(0, 30)}" · −2`, '#ff6b6b');
      return { ok: true, correct: false };
    }
    case 'pause': if (game.phase !== 'playing') return 'Pauzeren kan alleen tijdens het spel'; pause(); break;
    case 'resume': if (!game.paused) return 'Het spel loopt al'; resume(); break;
    case 'skip': if (c && c.state !== 'ended') endCall('Overgeslagen'); else if (game.phase === 'playing') { stop('next'); nextTurn(); } break;
    case 'reset': Object.keys(timers).forEach(stop); load(); if (xlsxPending) importFromDisk(); break;
    default: return 'Onbekende actie';
  }
  return { ok: true };
}

// ---------- http ----------
function lanIp() { for (const ifs of Object.values(os.networkInterfaces())) for (const i of ifs) if (i.family === 'IPv4' && !i.internal) return i.address; return 'localhost'; }
const PAGES = { '/': 'host.html', '/phone': 'phone.html', '/play': 'play.html' };

const handler = (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
  // the Droomtelefoon needs the microphone, which browsers only allow on https (or localhost): send plain-http visits over
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (url.pathname === '/phone' && httpsOn && !req.socket.encrypted && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) { res.writeHead(302, { Location: `https://${host}:${HTTPS_PORT}/phone${url.search}` }); return res.end(); }
  if (PAGES[url.pathname]) return send(200, fs.readFileSync(path.join(__dirname, PAGES[url.pathname])), 'text/html');
  if (url.pathname.startsWith('/media/')) {
    const m = media.get(url.pathname.slice(7).replace(/\W/g, ''));
    return m ? send(200, m.buf, m.type) : send(404, 'nope', 'text/plain');
  }
  if (url.pathname.startsWith('/avatars/')) {
    const f = path.join(__dirname, 'avatars', path.basename(url.pathname));
    return fs.existsSync(f) && /\.(png|jpe?g)$/i.test(f) ? send(200, fs.readFileSync(f), /\.png$/i.test(f) ? 'image/png' : 'image/jpeg') : send(404, 'nope', 'text/plain');
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const cl = { res, role: url.searchParams.get('role') || 'host', id: url.searchParams.get('id') };
    clients.add(cl); res.write(`data: ${JSON.stringify(view(cl))}\n\n`);
    if (cl.role === 'phone') broadcast();
    req.on('close', () => { clients.delete(cl); if (cl.role === 'phone') broadcast(); });
    return;
  }
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (url.pathname === '/upload' && req.method === 'POST') { // replace the lineup with another workbook (laptop only)
    if (!local) return send(403, JSON.stringify({ error: 'Excel inladen kan alleen op de laptop zelf.' }));
    const chunks = []; let size = 0;
    req.on('data', ch => { size += ch.length; if (size > 5e6) req.destroy(); else chunks.push(ch); });
    req.on('end', async () => {
      const out = await applyWorkbook(Buffer.concat(chunks));
      if (typeof out === 'string') return send(400, JSON.stringify({ error: out }));
      if (!out.unchanged) notice(out.generating.length ? `Excel ingeladen. Claude vult aan voor: ${out.generating.join(', ')}.` : 'Excel ingeladen.');
      broadcast(); send(200, JSON.stringify(out));
    });
    return;
  }
  if (url.pathname === '/open-excel' && req.method === 'POST') {
    if (!local) return send(403, JSON.stringify({ error: 'Alleen op de laptop zelf.' }));
    if (!fs.existsSync(XLSX)) return send(404, JSON.stringify({ error: 'spelers.xlsx bestaat nog niet.' }));
    spawn('open', [XLSX], { stdio: 'ignore' }).on('error', () => {});
    return send(200, JSON.stringify({ ok: true }));
  }
  if (url.pathname === '/ca.pem') { // the iPhone installs this once, then trusts the https Droomtelefoon (microphone)
    try { return send(200, fs.readFileSync(path.join(__dirname, 'certs', 'rootCA.pem')), 'application/x-x509-ca-cert'); } catch { return send(404, 'certs/rootCA.pem ontbreekt (zie start.sh)', 'text/plain'); }
  }
  if (url.pathname === '/tts') { // the voice server (voice_server.py) renders the line, the Droomtelefoon plays it
    return http.get({ host: '127.0.0.1', port: process.env.VOICE_PORT || 8792, path: '/tts' + url.search }, up => { res.writeHead(up.statusCode, up.headers); up.pipe(res); })
      .on('error', e => send(502, JSON.stringify({ error: 'Stemserver niet bereikbaar: ' + e.message })));
  }
  if (url.pathname === '/action' && req.method === 'POST') {
    let raw = '';
    req.on('data', ch => { raw += ch; if (raw.length > 2.5e6) req.destroy(); }); // drawings and selfies travel as data URLs
    req.on('end', async () => {
      let body; try { body = JSON.parse(raw); } catch { return send(400, JSON.stringify({ error: 'Ongeldige JSON' })); }
      try {
        const out = await act(body);
        broadcast();
        send(typeof out === 'string' ? 400 : 200, JSON.stringify(typeof out === 'string' ? { error: out } : out));
      } catch (e) { console.error(e); send(500, JSON.stringify({ error: e.message })); }
    });
    return;
  }
  send(404, 'not found', 'text/plain');
};
const server = http.createServer(handler);

const isMain = require.main === module;
load();
if (isMain) {
  const mtime = f => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
  const newerXlsx = mtime(XLSX) > Math.max(mtime(FILE('players.json')), mtime(FILE('admirers.json'))) + 1000;
  (newerXlsx ? importFromDisk() : saveXlsx()).then(watchXlsx);
  setInterval(broadcast, 5000); // keep SSE alive and timers visible
  server.on('error', e => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error(`\nPoort ${PORT} is al in gebruik: er draait al een Droomtelefoon-server.\nStop die eerst met Ctrl-C in zijn terminal (of kies een andere poort: PORT=3001 ./start.sh).`);
    process.exit(1);
  });
  server.listen(PORT, '0.0.0.0', () => console.log(`TV: http://localhost:${PORT}\nDroomtelefoon: http://${lanIp()}:${PORT}/phone\nSpelers: http://${lanIp()}:${PORT}/play\nAI: ${ai.enabled() ? ai.MODEL + ' (gesprekken: ' + ai.TALK_MODEL + ')' : 'uit (geen ANTHROPIC_API_KEY)'}`));
  // Safari only opens the microphone (speech recognition) on https: serve the same app with the mkcert certificate from start.sh
  try {
    const tls = { key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')), cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem')) };
    https.createServer(tls, handler).listen(HTTPS_PORT, '0.0.0.0', () => (httpsOn = true) && console.log(`Droomtelefoon met microfoon: https://${lanIp()}:${HTTPS_PORT}/phone   (eerst op de iPhone: http://${lanIp()}:${PORT}/ca.pem installeren en vertrouwen)`));
  } catch { console.log(`Droomtelefoon op deze laptop (microfoon werkt): http://localhost:${PORT}/phone\n  (Een iPhone als Droomtelefoon met microfoon kan ook: zie docs/HANDLEIDING.md, "iPhone als Droomtelefoon".)`); }
}
module.exports = { act, get game() { return game; }, load, checkGuess, guessMatches, timers, applyWorkbook, XLSX };
