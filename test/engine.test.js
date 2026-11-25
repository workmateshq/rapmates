const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GameRoom, generateRoomCode, standingsOf, turnLengthMs, TICK_RATE, LEAD_MS, VOTE_SECONDS, SCORE_MS, MIC_DROP_MS, INTRO_MS, MAX_PLAYERS, NAME_MAX, sanitizeName,
} = require('../public/js/engine.js');
const Words = require('../public/js/words.js');
const Tracks = require('../public/js/tracks.js');

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A room with a manual clock and loop that records every message it sends. The existing tests cover
// Freestyle; Write Bars (the default mode) has its own tests in writebars.test.js.
function makeRoom(mode = 'freestyle', maxPlayers) {
  const sent = [];
  let tickFn = null;
  let clock = 1000;
  const room = new GameRoom('TEST', {
    broadcast: (ev, data) => sent.push({ to: '*', ev, data }),
    send: (to, ev, data) => sent.push({ to, ev, data }),
    setInterval: (fn) => { tickFn = fn; return 1; },
    clearInterval: () => { tickFn = null; },
    random: seeded(7),
    now: () => clock,
    maxPlayers,
    introMs: 0, // no intro screen in these tests (it has its own)
  });
  room.mode = mode;
  // Moves the clock on and lets the room's loop notice.
  const advance = (ms) => { clock += ms; if (tickFn) tickFn(); };
  const last = (ev, to) => [...sent].reverse().find((m) => m.ev === ev && (!to || m.to === to));
  return { room, sent, last, advance, now: () => clock, isRunning: () => tickFn !== null };
}

function startedRoom(players = 2, crowd = 0) {
  const ctx = makeRoom('freestyle', crowd ? players : undefined);
  for (let i = 1; i <= players + crowd; i++) ctx.room.join(`p${i}`);
  ctx.room.start('p1');
  return ctx;
}

// Runs the current turn to the end of its 16 bars and the mic-drop pause after them.
const finishRap = (ctx) => ctx.advance(ctx.room.turn.endAt + MIC_DROP_MS - ctx.now());

test('room codes are 4 letters without I or O', () => {
  for (let i = 0; i < 50; i++) assert.match(generateRoomCode(), /^[A-HJ-NP-Z]{4}$/);
});

test('names are what players type: trimmed, no control characters, at most NAME_MAX characters', () => {
  assert.equal(sanitizeName('  Zak \n the   Rapper  '), 'Zak the Rapper');
  assert.equal(Array.from(sanitizeName('x'.repeat(40))).length, NAME_MAX);
  assert.equal(sanitizeName(42), '');
});

test('the first 8 join as rappers P1-P8; the 9th and later join the crowd', () => {
  const { room } = makeRoom();
  for (let i = 1; i <= 11; i++) assert.ok(room.join(`p${i}`).ok);
  assert.equal(MAX_PLAYERS, 8);
  assert.deepEqual(room.players.map((p) => p.number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(room.players.map((p) => p.color)).size, 8, 'everyone has their own colour');
  assert.deepEqual(room.crowd.map((m) => m.id), ['p9', 'p10', 'p11']);
  assert.ok(room.crowd.every((m) => m.role === 'crowd' && m.number === null));
  const lobby = room.lobbyPayload();
  assert.equal(lobby.players.length, MAX_PLAYERS);
  assert.equal(lobby.crowd.length, 3);
  assert.equal(room.join('p1').ok, false, 'no joining twice');
});

test('everyone keeps the name they picked; clashes get a number and no name becomes "Rapper"', () => {
  const { room } = makeRoom();
  room.join('a', 'Zak');
  room.join('b', 'zak');
  room.join('c', 'Zak');
  room.join('d', '   ');
  room.join('e');
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => room.members.get(id).name), ['Zak', 'zak 2', 'Zak 3', 'Rapper', 'Rapper 2']);
  room.join('f', 'A very long name indeed');
  assert.ok(Array.from(room.members.get('f').name).length <= NAME_MAX);
  for (let i = 0; i < 20; i++) room.join(`m${i}`, 'Same');
  const names = [...room.members.values()].map((m) => m.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'all unique');
});

test('between games a freed rapper slot goes to the longest-waiting crowd member', () => {
  const { room } = makeRoom();
  for (let i = 1; i <= 10; i++) room.join(`p${i}`);
  room.leave('p2');
  const promoted = room.members.get('p9');
  assert.equal(promoted.role, 'player');
  assert.equal(promoted.number, 2);
  assert.deepEqual(room.crowd.map((m) => m.id), ['p10']);
});

test('the host hands over to the next rapper, then the crowd', () => {
  const { room, last } = makeRoom('freestyle', 4);
  ['a', 'b', 'c', 'd', 'e'].forEach((id) => room.join(id));
  assert.equal(room.hostId, 'a');
  room.leave('a');
  assert.equal(room.hostId, 'b');
  assert.equal(last('lobbyUpdate').data.hostId, 'b');
  room.leave('b');
  room.leave('c');
  room.leave('d');
  assert.equal(room.hostId, 'e', 'the crowd member (promoted to rapper) hosts');
});

test('only the host starts the game', () => {
  const { room } = makeRoom();
  room.join('a');
  room.join('b');
  assert.equal(room.start('b'), false);
  assert.ok(room.start('a'));
  assert.equal(room.start('a'), false, 'already started');
});

test('a turn is a shared schedule: a random track, a short lead, 4 intro bars + 16 rap bars', () => {
  const ctx = startedRoom(2);
  const payload = ctx.last('gameStarted').data;
  assert.equal(payload.phase, 'turn');
  const { turn } = payload;
  const track = Tracks.byId(turn.trackId);
  assert.ok(track, 'a known track');
  assert.equal(turn.bpm, track.bpm);
  assert.equal(turn.rapperId, 'p1');
  assert.equal(turn.startAt, ctx.now() + LEAD_MS);
  assert.equal(turn.endAt - turn.startAt, turnLengthMs(track));
  assert.equal(Math.round(turnLengthMs(track)), Math.round(((4 + 16) * 4 * 60000) / track.bpm));
  assert.equal(turn.pairs.length, 8);
  assert.equal(ctx.room.phase, 'turn');
  ctx.advance(1000);
  assert.equal(ctx.room.phase, 'turn', 'still rapping');
});

test('every turn gets a track, never the same one twice in a row', () => {
  const ctx = startedRoom(4);
  const ids = [];
  for (let t = 0; t < 4; t++) {
    ids.push(ctx.room.turn.trackId);
    finishRap(ctx);
    ctx.advance(VOTE_SECONDS * 1000);
    ctx.advance(SCORE_MS);
  }
  ids.forEach((id) => assert.ok(Tracks.byId(id)));
  for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i], ids[i - 1]);
});

test('turns go in player order P1 -> P4, each with fresh rhyme pairs', () => {
  const ctx = startedRoom(4, 1);
  const seen = [];
  const pairs = [];
  for (let t = 0; t < 4; t++) {
    seen.push(ctx.room.turn.rapperId);
    pairs.push(...ctx.room.turn.pairs.map((p) => p.join('/')));
    finishRap(ctx);
    assert.equal(ctx.room.phase, 'vote');
    ctx.advance(VOTE_SECONDS * 1000);
    assert.equal(ctx.room.phase, 'score');
    ctx.advance(SCORE_MS);
  }
  assert.deepEqual(seen, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(new Set(pairs).size, 32, 'no pair repeats within a game');
  assert.equal(ctx.room.phase, 'results');
  assert.equal(ctx.room.started, false);
  assert.equal(ctx.isRunning(), false);
});

test('voting: the rapper cannot vote for themselves; rappers and the crowd can', () => {
  const ctx = startedRoom(3, 2);
  const { room } = ctx;
  assert.equal(room.input('p2', { type: 'vote', stars: 5, turn: 0 }), false, 'no voting while rapping');
  finishRap(ctx);
  assert.equal(room.phase, 'vote');
  assert.equal(room.input('p1', { type: 'vote', stars: 5, turn: 0 }), false, 'rapper on themselves');
  assert.equal(room.input('p2', { type: 'vote', stars: 0, turn: 0 }), false, 'stars are 0.5-5');
  assert.equal(room.input('p2', { type: 'vote', stars: 6, turn: 0 }), false);
  assert.equal(room.input('p2', { type: 'vote', stars: 2.25, turn: 0 }), false, 'half steps only');
  assert.equal(room.input('p2', { type: 'vote', stars: 4, turn: 3 }), false, 'a vote for another turn');
  assert.equal(room.input('ghost', { type: 'vote', stars: 4, turn: 0 }), false);
  assert.ok(room.input('p2', { type: 'vote', stars: 4, turn: 0 }));
  assert.ok(room.input('p4', { type: 'vote', stars: 5, turn: 0 }), 'crowd votes');
  assert.equal(ctx.last('votes').data.count, 2);
  assert.equal(ctx.last('votes').data.needed, 4);
  assert.ok(room.input('p5', { type: 'vote', stars: 2, turn: 0 }));
  assert.equal(room.phase, 'vote');
  assert.ok(room.input('p3', { type: 'vote', stars: 3, turn: 0 }));
  // Everyone's voted: the score shows straight away, without waiting out the 20 seconds.
  assert.equal(room.phase, 'score');
  const { result } = ctx.last('phase').data;
  assert.equal(result.id, 'p1');
  assert.equal(result.average, 3.5);
  assert.equal(result.votes, 4);
});

test('voting closes after 20 seconds with whoever voted', () => {
  const ctx = startedRoom(3);
  finishRap(ctx);
  ctx.room.vote('p2', 5);
  ctx.advance(VOTE_SECONDS * 1000 - 100);
  assert.equal(ctx.room.phase, 'vote');
  ctx.advance(100);
  assert.equal(ctx.room.phase, 'score');
  assert.equal(ctx.room.results[0].average, 5);
  assert.equal(ctx.room.results[0].votes, 1);
});

test('a voter leaving closes the vote if everyone left has voted', () => {
  const ctx = startedRoom(3);
  finishRap(ctx);
  ctx.room.vote('p2', 3);
  ctx.room.leave('p3');
  assert.equal(ctx.room.phase, 'score');
});

test('if the rapper leaves mid-turn the next rapper is up', () => {
  const ctx = startedRoom(3);
  ctx.advance(2000);
  ctx.room.leave('p1');
  assert.equal(ctx.room.phase, 'turn');
  assert.equal(ctx.room.turn.rapperId, 'p2');
  assert.equal(ctx.last('phase').data.turn.rapperId, 'p2');
  assert.equal(ctx.room.results.length, 0);
});

test('averages pick the winner and ties share the mic', () => {
  const ctx = startedRoom(3);
  const scores = [[4, 4], [5, 3], [2, 2]]; // p1 4, p2 4, p3 2
  for (let t = 0; t < 3; t++) {
    finishRap(ctx);
    const voters = ['p1', 'p2', 'p3'].filter((id) => id !== ctx.room.turn.rapperId);
    voters.forEach((id, i) => ctx.room.vote(id, scores[t][i]));
    ctx.advance(SCORE_MS);
  }
  const over = ctx.last('gameOver').data;
  assert.deepEqual(over.standings.map((r) => [r.id, r.average]), [['p1', 4], ['p2', 4], ['p3', 2]]);
  assert.deepEqual(over.winnerIds, ['p1', 'p2']);
});

test('standings: a single top average wins; no votes ranks last and never wins', () => {
  const r = (id, number, average) => ({ id, number, average, name: id });
  let s = standingsOf([r('a', 1, 3.5), r('b', 2, 4.67), r('c', 3, null)]);
  assert.deepEqual(s.standings.map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(s.winnerIds, ['b']);
  s = standingsOf([r('a', 1, null)]);
  assert.deepEqual(s.winnerIds, []);
});

test('a room with a lone rapper skips voting (nobody to vote)', () => {
  const ctx = startedRoom(1);
  finishRap(ctx);
  assert.equal(ctx.room.phase, 'score');
  assert.equal(ctx.room.results[0].average, null);
  ctx.advance(SCORE_MS);
  assert.equal(ctx.room.phase, 'results');
});

test('joining mid-game sends the game so far to the newcomer', () => {
  const ctx = startedRoom(2);
  ctx.room.join('late');
  ctx.room.announceJoin('late');
  const msg = ctx.last('gameStarted', 'late');
  assert.ok(msg);
  assert.equal(msg.data.turn.rapperId, 'p1');
  assert.ok(!msg.data.order.includes('late'), 'late joiners rap next game');
});

test('play again starts a new round with a new order', () => {
  const ctx = startedRoom(2);
  for (let t = 0; t < 2; t++) {
    finishRap(ctx);
    ctx.advance(VOTE_SECONDS * 1000);
    ctx.advance(SCORE_MS);
  }
  assert.equal(ctx.room.phase, 'results');
  ctx.room.join('p3');
  assert.ok(ctx.room.start('p1'));
  assert.equal(ctx.room.round, 2);
  assert.deepEqual(ctx.room.order, ['p1', 'p2', 'p3']);
});

test('everyone leaving stops the room', () => {
  const ctx = startedRoom(2);
  ctx.room.leave('p1');
  ctx.room.leave('p2');
  assert.equal(ctx.room.started, false);
  assert.equal(ctx.isRunning(), false);
});

test('when a game ends, free rapper slots go to the crowd', () => {
  const ctx = startedRoom(4, 2);
  ctx.room.leave('p3');
  assert.equal(ctx.room.members.get('p5').role, 'crowd', 'no promotion mid-game');
  ctx.room.leave('p1');
  ctx.room.leave('p2');
  ctx.room.leave('p4');
  assert.equal(ctx.room.phase, 'results');
  assert.deepEqual(ctx.room.players.map((p) => [p.id, p.number]), [['p5', 1], ['p6', 2]]);
});

test('the loop ticks at TICK_RATE', () => {
  assert.equal(TICK_RATE, 10);
  assert.ok(Words.PAIRS.length === 150);
});

test('the "faaah" ad-lib lands about every 3rd turn: never twice running, always by the 4th', () => {
  for (const r of [0, 0.49, 0.51, 0.99]) {
    const room = new GameRoom('TEST', { broadcast() {}, send() {}, setInterval: () => 1, clearInterval() {}, random: () => r, now: () => 0 });
    const picks = Array.from({ length: 24 }, () => room.nextAdlib());
    const named = picks.filter(Boolean);
    named.forEach((n, i) => assert.equal(n, ['faaah', 'damn'][i % 2], 'they alternate'));
    const gaps = [];
    let last = -1;
    picks.forEach((p, i) => { if (p) { gaps.push(i - last); last = i; } });
    assert.ok(gaps.length >= 6, `${gaps.length} ad-libs in 24 turns`);
    gaps.forEach((g) => assert.ok(g >= 3 && g <= 4, `gap ${g}`));
  }
});

test('Freestyle: a 7-second mic drop after the 16 bars, then the vote', () => {
  const ctx = startedRoom(2);
  ctx.advance(ctx.room.turn.endAt - ctx.now());
  assert.equal(ctx.room.phase, 'turn', 'the mic drop plays first');
  ctx.advance(MIC_DROP_MS);
  assert.equal(ctx.room.phase, 'vote');
});

test('a game opens with the intro screen (the rules over a beat); the host can skip it', () => {
  for (const mode of ['freestyle', 'writebars']) {
    const ctx = makeRoom(mode);
    ctx.room.introMs = undefined; // the real intro length
    ctx.room.join('p1');
    ctx.room.join('p2');
    ctx.room.start('p1');
    assert.equal(ctx.room.phase, 'intro', mode);
    const p = ctx.last('gameStarted').data;
    assert.equal(p.introEndsAt - p.introStartedAt, INTRO_MS[mode]);
    ctx.advance(INTRO_MS[mode] - 100);
    assert.equal(ctx.room.phase, 'intro');
    ctx.advance(100);
    assert.equal(ctx.room.phase, mode === 'writebars' ? 'write' : 'turn', 'then the game');
  }
  const ctx = makeRoom('writebars');
  ctx.room.introMs = undefined;
  ctx.room.join('p1');
  ctx.room.join('p2');
  ctx.room.start('p1');
  assert.equal(ctx.room.input('p2', { type: 'skipIntro' }), false, 'only the host skips');
  assert.ok(ctx.room.input('p1', { type: 'skipIntro' }));
  assert.equal(ctx.room.phase, 'write');
});

test('the round-end voiceover cycles 1-6 across turns, picked by the host', () => {
  const ctx = startedRoom(7, 1);
  const seen = [];
  for (let t = 0; t < 7; t++) {
    seen.push(ctx.room.turn.roundEnd);
    finishRap(ctx);
    ctx.advance(VOTE_SECONDS * 1000);
    ctx.advance(SCORE_MS);
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 1]);
});
