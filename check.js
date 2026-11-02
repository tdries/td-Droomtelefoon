// ./start.sh check [model ...] → the same short call (opener + 2 questions) and one SMS per model, with timings.
// Plays as CHECK_PLAYER (default: the 2nd player, so the host's own admirers stay secret). Never prints the answer.
const fs = require('fs');
const ai = require('./ai');

// a pink heart on white, 512x384 PNG, built with zlib (test image for the drawing jury)
function heartPng() {
  const zlib = require('zlib'), W = 512, H = 384, raw = Buffer.alloc((W * 3 + 1) * H, 255);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const X = (x - 256) / 110, Y = -(y - 190) / 110, f = (X * X + Y * Y - 1) ** 3 - X * X * Y ** 3, g = ((X * .82) ** 2 + (Y * .82) ** 2 - 1) ** 3 - (X * .82) ** 2 * (Y * .82) ** 3; if (f <= 0 && g > 0) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = 255; raw[o + 1] = 45; raw[o + 2] = 155; } } }
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

(async () => {
  if (!ai.enabled()) { console.log('Geen key: niets te meten.'); return; }
  const players = JSON.parse(fs.readFileSync('players.json', 'utf8'));
  const content = JSON.parse(fs.readFileSync('admirers.json', 'utf8'));
  const player = players.find(p => p.name === process.env.CHECK_PLAYER) || players[1] || players[0];
  const admirer = content[player.name].admirers[0];
  const models = process.argv.slice(2).length ? process.argv.slice(2) : [ai.TALK_MODEL];
  for (const model of models) {
    console.log(`\n=== ${model} · ${player.name} ↔ aanbidder #1 ===`);
    const history = [], times = [];
    const turn = async (userText, channel = 'call', hist = history) => {
      const t = Date.now();
      const out = await ai.talk({ channel, admirer, player, level: 1, history: hist, userText, model });
      times.push(Date.now() - t);
      if (userText) console.log(`${player.name}: ${userText}`);
      console.log(`${channel === 'sms' ? 'sms' : '#1'}: ${out.reply}   (${((Date.now() - t) / 1000).toFixed(1)} s)`);
      if (channel === 'call') { if (userText) history.push({ role: 'user', text: userText }); history.push({ role: 'assistant', text: out.reply }); }
    };
    await turn(null);
    await turn('Waar kennen wij elkaar van?');
    await turn('Welke sport deed jij?');
    await turn('Waar ken ik jou van?', 'sms', []);
    console.log(`gemiddeld ${(times.reduce((a, b) => a + b) / times.length / 1000).toFixed(1)} s per antwoord`);

    // Ja-punt: Claude must be strict (generic or name questions never score) and honest (own colour = ja).
    const otherColour = ['rood', 'blauw', 'geel', 'groen', 'roze', 'zwart'].find(k => k !== admirer.attrs.kleur);
    const probes = [
      ['Ben je beroemd?', false, 'Ben je beroemd?'],
      [`Ben je ${admirer.answer}?`, false, 'Ben je <de juiste naam>?'],
      [`Is ${admirer.attrs.kleur} jouw lievelingskleur?`, true, 'Is <eigen kleur> jouw lievelingskleur?'],
      [`Is ${otherColour} jouw lievelingskleur?`, false, 'Is <andere kleur> jouw lievelingskleur?'],
    ];
    console.log('\nOpdrachten (Claude bedenkt ze zelf, met de hints van deze aanbidder):');
    for (const kind of ['ask', 'lie', 'draw', 'selfie', 'act']) {
      const t = Date.now(), o = await ai.talk({ channel: 'call', admirer, player, level: 2, history: [], userText: null, wantTask: kind, model });
      const bad = o.task ? '' : '  ← GEEN OPDRACHT GEGEVEN';
      console.log(`${kind.padEnd(7)} (${((Date.now() - t) / 1000).toFixed(1)} s) ${o.reply}${bad}`);
      if (o.task) console.log(`        → ${o.task.prompt}${o.task.options.length ? ' | ' + o.task.options.map((x, i) => `${i + 1}. ${x}`).join(' | ') : ''}${o.task.kind === 'lie' ? ` | leugen = ${o.task.answer + 1}` : ''}`);
      if (o.task && kind === 'ask') { const r = await ai.talk({ channel: 'call', admirer, player, level: 2, history: [{ role: 'assistant', text: o.reply }], userText: o.task.options[0] || 'geen idee', taskDone: 'ask', model }); console.log(`        beloning: ${r.reply}`); }
    }
    const heart = heartPng(), tj = Date.now();
    const j = await ai.judgeImage({ admirer, player, level: 2, task: { kind: 'draw', prompt: 'Teken een hartje' }, image: heart.split(',')[1], mediaType: 'image/png' });
    console.log(`tekening-jury (${((Date.now() - tj) / 1000).toFixed(1)} s): ok=${j.ok} | gezien: ${j.seen}\n        reactie: ${j.reply}`);

    console.log('\nJury bij twijfel over een gok:');
    for (const [answer, guess, want] of [['Britney Spears', 'Brittnie Spiers', true], ['Kate Moss', 'Kate Bush', false], ['Jessica Alba', 'Jessica Biel', false]]) {
      const ok = await ai.sameName(guess, answer, []);
      console.log(`${ok === want ? 'OK  ' : 'FOUT'} "${guess}" voor ${answer} → ${ok ? 'goed' : 'fout'} (verwacht ${want ? 'goed' : 'fout'})`);
    }
    console.log('\nJa-punten:');
    for (const [q, want, shown] of probes) {
      const out = await ai.talk({ channel: 'call', admirer, player, level: 1, history: [], userText: q, model });
      console.log(`${out.ja === want ? 'OK  ' : 'FOUT'} ${shown} → punt: ${out.ja ? 'ja' : 'nee'} (verwacht ${want ? 'ja' : 'nee'})`);
    }
  }
})().catch(e => { console.error(e.message); process.exit(1); });
