const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../public/js/engine.js');
const Tracks = require('../public/js/tracks.js');

const {
  GameRoom, DEFAULT_MODE, WRITE_SECONDS, WRITE_GRACE_MS, WB_ROUNDS, WB_RAP_BARS, WB_GAP_MS, WB_VOTE_SECONDS, STANDINGS_MS, NEXT_ROUND_SECONDS, LINE_MAX, LEAD_MS,
  sanitizeLine, sanitizeLines, lineBar, lineStartMs, turnLengthMs, totalsStandingsOf,
} = Engine;

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

function makeRoom(seed = 7, maxPlayers) {
  const sent = [];
  let tickFn = null;
  let clock = 1000;
  const room = new GameRoom('TEST', {
    broadcast: (ev, data) => sent.push({ to: '*', ev, data }),
    send: (to, ev, data) => sent.push({ to, ev, data }),
    setInterval: (fn) => { tickFn = fn; return 1; },
    clearInterval: () => { tickFn = null; },
    random: seeded(seed),
    now: () => clock,
    maxPlayers,
    introMs: 0, // no intro screen in these tests (it has its own)
  });
  const advance = (ms) => { clock += ms; if (tickFn) tickFn(); };
  const last = (ev, to) => [...sent].reverse().find((m) => m.ev === ev && (!to || m.to === to));
  return { room, sent, last, advance, now: () => clock };
}

function writeBarsRoom(players = 2, crowd = 0, options, seed) {
  const ctx = makeRoom(seed, crowd ? players : undefined);
  for (let i = 1; i <= players + crowd; i++) ctx.room.join(`p${i}`);
  ctx.room.start('p1', options);
  return ctx;
}

// After a round's scoreboard: every rapper presses "Play next round" (or, after the last round, the podium).
function nextRound(ctx) {
  const { room } = ctx;
  if (room.wb.round >= room.wb.rounds) return ctx.advance(STANDINGS_MS);
  room.nextRoundRappers().forEach((id) => room.input(id, { type: 'nextRound', round: room.wb.round }));
}

const LINES = ['I grind every day', 'it stays on my mind', 'lines one two', 'and the end'];
const allDone = (ctx, ids) => ids.forEach((id) => ctx.room.input(id, { type: 'done', lines: LINES }));
// Runs the current performance to its end (into its vote, or the next one if nobody can vote).
const endPerformance = (ctx) => ctx.advance(ctx.room.turn.endAt + WB_GAP_MS - ctx.now());
// Runs every performance in the round, each one's vote timing out (or rated by `vote`), to the scoreboard.
function runBattle(ctx, vote) {
  for (let guard = 0; (ctx.room.phase === 'turn' || ctx.room.phase === 'vote') && guard < 30; guard++) {
    if (ctx.room.phase === 'turn') endPerformance(ctx);
    else if (vote) vote(ctx.room.wb.performers[0]);
    else ctx.advance(WB_VOTE_SECONDS * 1000);
  }
}
const rateAll = (ctx, voterIds, stars = 4) => voterIds.forEach((v) => {
  const ratings = {};
  ctx.room.wb.performers.filter((p) => p !== v).forEach((p) => { ratings[p] = typeof stars === 'function' ? stars(v, p) : stars; });
  ctx.room.input(v, { type: 'votes', stars: ratings, round: ctx.room.wb.round });
});

test('Write Bars is the default mode; the host picks the mode in the lobby and everyone sees it', () => {
  const { room, last } = makeRoom();
  assert.equal(DEFAULT_MODE, 'writebars');
  room.join('a');
  room.join('b');
  assert.equal(room.lobbyPayload().mode, 'writebars');
  assert.equal(room.input('b', { type: 'mode', mode: 'freestyle' }), false, 'only the host');
  assert.equal(room.input('a', { type: 'mode', mode: 'karaoke' }), false, 'only known modes');
  assert.ok(room.input('a', { type: 'mode', mode: 'freestyle' }));
  assert.equal(last('lobbyUpdate').data.mode, 'freestyle');
  room.start('a');
  assert.equal(room.phase, 'turn');
  assert.equal(room.input('a', { type: 'mode', mode: 'writebars' }), false, 'not mid-game');
});

test('the write phase: 90 seconds on the host clock, each rapper gets 2 unique pairs', () => {
  const ctx = writeBarsRoom(4, 1);
  const { room, last } = ctx;
  assert.equal(room.phase, 'write');
  const p = last('gameStarted').data;
  assert.equal(p.mode, 'writebars');
  assert.equal(p.writeEndsAt, ctx.now() + WRITE_SECONDS * 1000);
  assert.equal(p.wbRound, 1);
  assert.equal(p.rounds, 3);
  assert.equal(p.writers.length, 4, 'the crowd watches');
  const pairs = p.writers.flatMap((w) => w.pairs.map((pair) => pair.join('/')));
  assert.ok(p.writers.every((w) => w.pairs.length === 2));
  assert.equal(new Set(pairs).size, 8, 'nobody shares a pair');
  assert.ok(!('lines' in p.writers[0]), 'lines stay secret while writing');
  ctx.advance(WRITE_SECONDS * 1000);
  assert.equal(room.phase, 'write', 'a short grace for the last drafts');
  ctx.advance(WRITE_GRACE_MS);
  assert.equal(room.phase, 'turn');
});

test('pairs never repeat across the 3 rounds', () => {
  const ctx = writeBarsRoom(4);
  const seen = [];
  for (let r = 1; r <= WB_ROUNDS; r++) {
    assert.equal(ctx.room.phase, 'write');
    ctx.room.wb.entries.forEach((e) => e.pairs.forEach((pair) => seen.push(pair.join('/'))));
    allDone(ctx, ['p1', 'p2', 'p3', 'p4']);
    runBattle(ctx);
    rateAll(ctx, ['p1', 'p2', 'p3', 'p4']);
    nextRound(ctx);
  }
  assert.equal(seen.length, 24);
  assert.equal(new Set(seen).size, 24);
});

test('the write phase ends early when everyone has locked in; drafts are kept', () => {
  const ctx = writeBarsRoom(2);
  const { room, last } = ctx;
  assert.ok(room.input('p1', { type: 'draft', lines: ['one', 'two'], voice: 'self' }));
  assert.ok(room.input('p1', { type: 'done' }));
  assert.equal(room.phase, 'write');
  assert.deepEqual(last('writers').data.writers.map((w) => w.done), [true, false]);
  assert.equal(room.input('p1', { type: 'draft', lines: ['changed'] }), false, 'locked in');
  assert.equal(room.input('p3', { type: 'done' }), false, 'not a writer');
  room.input('p2', { type: 'draft', lines: ['a', 'b', 'c', 'd'] });
  room.input('p2', { type: 'done' });
  assert.equal(room.phase, 'turn');
  assert.deepEqual(room.turn.lines, ['one', 'two', '', '']);
  assert.equal(room.turn.voice, 'self');
});

test('unsubmitted drafts are performed when the clock runs out', () => {
  const ctx = writeBarsRoom(2);
  ctx.room.input('p2', { type: 'draft', lines: ['half', 'written'] });
  ctx.advance(WRITE_SECONDS * 1000 + WRITE_GRACE_MS);
  assert.equal(ctx.room.turn.rapperId, 'p1');
  assert.deepEqual(ctx.room.turn.lines, ['', '', '', '']);
  assert.equal(ctx.room.turn.voice, 'male', 'the robot MC by default (P1: male)');
  endPerformance(ctx);
  ctx.advance(WB_VOTE_SECONDS * 1000);
  assert.deepEqual(ctx.room.turn.lines, ['half', 'written', '', '']);
});

test('lines are sanitised and limited on the host', () => {
  assert.equal(sanitizeLine('  hello\n\tworld\u0000  '), 'hello world');
  assert.equal(sanitizeLine(42), '');
  assert.equal(sanitizeLine('x'.repeat(200)).length, LINE_MAX);
  assert.equal(sanitizeLine('<b>bold</b>'), '<b>bold</b>', 'kept as text (escaped when shown)');
  assert.deepEqual(sanitizeLines(['a', null, 'c', 'd', 'e']), ['a', '', 'c', 'd']);
  assert.deepEqual(sanitizeLines('nope'), ['', '', '', '']);
  const ctx = writeBarsRoom(1);
  ctx.room.input('p1', { type: 'done', lines: ['y'.repeat(500), { evil: 1 }], voice: 'shout' });
  assert.equal(ctx.room.turn.lines[0].length, LINE_MAX);
  assert.equal(ctx.room.turn.lines[1], '');
  assert.equal(ctx.room.turn.voice, 'male', 'unknown voices are ignored');
});

test('performance schedule: 4 intro bars + 8 bars, line k on the downbeat of performance bar 2k-1', () => {
  const ctx = writeBarsRoom(2);
  allDone(ctx, ['p1', 'p2']);
  const turn = ctx.room.turn;
  const track = Tracks.byId(turn.trackId);
  const bar = 4 * 60 / 90;
  assert.equal(turn.startAt, ctx.now() + LEAD_MS);
  assert.equal(turn.rapBars, WB_RAP_BARS);
  assert.equal(turn.fadeAfterBars, 12, 'the track fades after bar 4 + 8');
  assert.equal(turn.endAt - turn.startAt, 12 * bar * 1000);
  assert.equal(turnLengthMs(track, 8), 12 * bar * 1000);
  assert.deepEqual([1, 2, 3, 4].map((k) => lineBar(track, k)), [5, 7, 9, 11]);
  [1, 2, 3, 4].forEach((k) => {
    assert.ok(Math.abs(lineStartMs(track, turn.startAt, k) - (turn.startAt + (4 + 2 * (k - 1)) * bar * 1000)) < 1e-6);
  });
  assert.equal(Tracks.fadeAt(track, turn.fadeAfterBars), 12 * bar);
  assert.equal(Tracks.fadeAt(track), 22 * bar, 'Freestyle keeps the track\'s own fade');
});

test('performances go in seat order on 90 BPM tracks (never the same twice running), voices alternate', () => {
  const ctx = writeBarsRoom(4, 0, undefined, 3);
  const turns = [];
  for (let r = 0; r < WB_ROUNDS; r++) {
    allDone(ctx, ['p1', 'p2', 'p3', 'p4']);
    while (ctx.room.phase === 'turn') {
      turns.push({ ...ctx.room.turn });
      endPerformance(ctx);
      rateAll(ctx, ['p1', 'p2', 'p3', 'p4']);
    }
    nextRound(ctx);
  }
  assert.equal(turns.length, 12);
  assert.deepEqual(turns.slice(0, 4).map((t) => t.rapperId), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(turns.slice(0, 4).map((t) => t.voiceGender), ['male', 'female', 'male', 'female'], 'the default alternates by seat');
  assert.ok(turns.every((t) => Engine.VOICE_ACCENTS.includes(t.voiceAccent)), 'each performance gets a UK or American voice');
  assert.ok(turns.every((t) => t.bpm === 90 && Tracks.byId(t.trackId).bpm === 90));
  for (let i = 1; i < turns.length; i++) assert.notEqual(turns[i].trackId, turns[i - 1].trackId);
  assert.equal(Tracks.pickTrack('brooklyn', Math.random, (t) => t.id === 'harlem').id, 'harlem', 'the filter limits the choice');
});

test('voting: everyone else rates each performance straight after it; stars add up across 3 rounds', () => {
  const ctx = writeBarsRoom(3);
  const { room, last } = ctx;
  room.join('p4'); // joined after the start: watches and votes
  const roundStars = { p1: 5, p2: 3, p3: 1 };
  for (let r = 1; r <= WB_ROUNDS; r++) {
    allDone(ctx, ['p1', 'p2', 'p3']);
    ['p1', 'p2', 'p3'].forEach((rapper) => {
      assert.equal(room.turn.rapperId, rapper);
      endPerformance(ctx);
      assert.equal(room.phase, 'vote', `${rapper}'s performance is rated straight away`);
      const v = last('phase').data;
      assert.deepEqual(v.performances.map((x) => x.id), [rapper]);
      assert.deepEqual(v.performances[0].lines, LINES);
      assert.equal(v.voteMs, WB_VOTE_SECONDS * 1000);
      assert.equal(v.votes.needed, 3, 'everyone but the rapper, the crowd included');
      assert.equal(room.input(rapper, { type: 'votes', stars: { [rapper]: 5 }, round: r }), false, 'no rating yourself');
      const voter = rapper === 'p1' ? 'p2' : 'p1';
      assert.equal(room.input(voter, { type: 'votes', stars: { [rapper]: 9 }, round: r }), false, 'only 1-5');
      assert.equal(room.input(voter, { type: 'votes', stars: { [rapper]: 3 }, round: r + 1 }), false, 'wrong round');
      assert.equal(room.input(voter, { type: 'vote', stars: 3, turn: -1 }), false, 'no Freestyle votes');
      rateAll(ctx, ['p1', 'p2', 'p3', 'p4'].filter((x) => x !== rapper), (voter2, p) => roundStars[p]);
    });
    assert.equal(room.phase, 'standings');
    const s = last('phase').data;
    assert.equal(s.wbRound, r);
    // p1 gets 5 from 3 voters (p2, p3, p4) = 15 a round; p2 3x3 = 9; p3 1x3 = 3.
    assert.deepEqual(s.roundResults.map((x) => [x.id, x.stars, x.votes, x.total]), [['p1', 15, 3, 15 * r], ['p2', 9, 3, 9 * r], ['p3', 3, 3, 3 * r]]);
    nextRound(ctx);
  }
  assert.equal(room.phase, 'results');
  const over = last('gameOver').data;
  assert.equal(over.mode, 'writebars');
  assert.deepEqual(over.standings.map((x) => [x.id, x.total]), [['p1', 45], ['p2', 27], ['p3', 9]]);
  assert.deepEqual(over.winnerIds, ['p1']);
});

test('each vote closes after its time with whoever voted; ties share the mic, no stars means no winner', () => {
  const ctx = writeBarsRoom(2);
  allDone(ctx, ['p1', 'p2']);
  endPerformance(ctx); // p1's vote: nobody rates in time
  ctx.advance(WB_VOTE_SECONDS * 1000);
  assert.equal(ctx.room.turn.rapperId, 'p2', 'on to the next rapper');
  endPerformance(ctx);
  ctx.room.input('p1', { type: 'votes', stars: { p2: 4 }, round: 1 });
  assert.equal(ctx.room.phase, 'standings', 'everyone who can vote has: straight on');
  assert.deepEqual(ctx.room.wb.roundResults.map((r) => [r.id, r.total]), [['p2', 4], ['p1', 0]]);
  assert.deepEqual(totalsStandingsOf([{ id: 'a', number: 1, total: 6 }, { id: 'b', number: 2, total: 6 }]).winnerIds, ['a', 'b']);
  assert.deepEqual(totalsStandingsOf([{ id: 'a', number: 1, total: 0 }]).winnerIds, []);
});

test('late joiners watch the round and vote; a writer leaving mid-write does not hold it up', () => {
  const ctx = writeBarsRoom(3);
  const { room, last } = ctx;
  room.join('late');
  room.announceJoin('late');
  assert.equal(last('gameStarted', 'late').data.phase, 'write');
  assert.equal(room.input('late', { type: 'done', lines: LINES }), false, 'joined too late to write');
  allDone(ctx, ['p1', 'p2']);
  assert.equal(room.phase, 'write');
  room.leave('p3');
  assert.equal(room.phase, 'turn', 'everyone left has locked in');
  endPerformance(ctx);
  assert.deepEqual(room.wb.performers, ['p1']);
  assert.ok(room.writeBarsVoters().includes('late'));
  runBattle(ctx, () => rateAll(ctx, ['p1', 'p2', 'late']));
  assert.equal(room.phase, 'standings');
  assert.deepEqual(room.wb.roundResults.map((r) => [r.id, r.stars]), [['p1', 8], ['p2', 8]]);
});

test('a rapper leaving mid-battle is skipped; leaving mid-vote closes it when everyone else is in', () => {
  const ctx = writeBarsRoom(3);
  const { room } = ctx;
  allDone(ctx, ['p1', 'p2', 'p3']);
  assert.equal(room.turn.rapperId, 'p1');
  endPerformance(ctx);
  rateAll(ctx, ['p2', 'p3']);
  assert.equal(room.turn.rapperId, 'p2');
  room.leave('p2');
  assert.equal(room.turn.rapperId, 'p3', 'next performance straight away');
  endPerformance(ctx);
  assert.equal(room.phase, 'vote');
  assert.deepEqual(room.wb.performers, ['p3']);
  room.leave('p3');
  assert.equal(room.phase, 'standings', 'the performer left mid-vote: on with the show');
  assert.deepEqual(room.wb.roundResults.map((r) => [r.id, r.stars]), [['p1', 8]]);
});

test('everyone leaving ends the game; a lone rapper plays on without votes', () => {
  const solo = writeBarsRoom(1);
  allDone(solo, ['p1']);
  runBattle(solo);
  assert.equal(solo.room.phase, 'standings', 'nobody to vote');
  const ctx = writeBarsRoom(2);
  ctx.room.join('watcher');
  ctx.room.leave('p1');
  ctx.room.leave('p2');
  assert.equal(ctx.room.phase, 'results');
  assert.equal(ctx.room.started, false);
});

test('a shorter write timer for testing is clamped to 5-90 seconds', () => {
  const ctx = writeBarsRoom(1, 0, { writeSeconds: 10 });
  assert.equal(ctx.room.wb.writeEndsAt - ctx.now(), 10000);
  assert.equal(writeBarsRoom(1, 0, { writeSeconds: 1 }).room.wb.writeMs, 5000);
  assert.equal(writeBarsRoom(1, 0, { writeSeconds: 600 }).room.wb.writeMs, 90000);
  assert.equal(WRITE_SECONDS, 90);
});

test('the robot MC speaks in the voice the rapper picked', () => {
  const ctx = writeBarsRoom(2);
  ctx.room.input('p1', { type: 'done', lines: LINES, voice: 'female' });
  ctx.room.input('p2', { type: 'done', lines: LINES, voice: 'male' });
  assert.equal(ctx.room.turn.voice, 'female');
  assert.equal(ctx.room.turn.voiceGender, 'female');
  ctx.advance(ctx.room.turn.endAt - ctx.now() + 1);
});

test('finished early: unlock to edit, then lock in again; the battle waits for everyone', () => {
  const ctx = writeBarsRoom(2);
  const { room } = ctx;
  room.input('p1', { type: 'done', lines: ['first', 'try'] });
  assert.equal(room.phase, 'write', 'still waiting for p2');
  assert.ok(room.input('p1', { type: 'edit' }), 'p1 unlocks');
  assert.equal(room.input('p1', { type: 'edit' }), false, 'already unlocked');
  room.input('p2', { type: 'done', lines: LINES });
  assert.equal(room.phase, 'write', 'p1 is editing, so no battle yet');
  room.input('p1', { type: 'draft', lines: ['better', 'bars'] });
  room.input('p1', { type: 'done', lines: ['better', 'bars', 'all', 'four'] });
  assert.notEqual(room.phase, 'write', 'everyone locked in: battle');
  assert.deepEqual(room.turn.lines, ['better', 'bars', 'all', 'four']);
});

test('a full room of 8: everyone gets their own pairs and performs in seat order', () => {
  const ctx = writeBarsRoom(8);
  const p = ctx.last('gameStarted').data;
  assert.equal(p.writers.length, 8);
  assert.equal(new Set(p.writers.flatMap((w) => w.pairs.map((pair) => pair.join('/')))).size, 16, 'no shared pairs');
  allDone(ctx, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
  const order = [];
  for (let guard = 0; ctx.room.phase === 'turn' && guard < 20; guard++) {
    order.push(ctx.room.turn.rapperId);
    endPerformance(ctx);
    ctx.advance(WB_VOTE_SECONDS * 1000);
  }
  assert.deepEqual(order, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
});

test('between rounds: wait up to 30 s for "Play next round"; everyone in starts it straight away', () => {
  const ctx = writeBarsRoom(3);
  const { room } = ctx;
  allDone(ctx, ['p1', 'p2', 'p3']);
  runBattle(ctx);
  rateAll(ctx, ['p1', 'p2', 'p3']);
  assert.equal(room.phase, 'standings');
  const p = ctx.last('phase').data;
  assert.equal(p.standingsEndsAt, ctx.now() + NEXT_ROUND_SECONDS * 1000);
  assert.deepEqual(p.nextRappers, ['p1', 'p2', 'p3']);
  ctx.advance(STANDINGS_MS + 1000);
  assert.equal(room.phase, 'standings', 'no auto-advance after 8 s any more');
  assert.ok(room.input('p1', { type: 'nextRound', round: 1 }));
  assert.equal(room.input('p1', { type: 'nextRound', round: 1 }), false, 'once only');
  assert.deepEqual(ctx.last('phase').data.nextReady, ['p1']);
  room.input('p2', { type: 'nextRound', round: 1 });
  assert.equal(room.phase, 'standings');
  room.input('p3', { type: 'nextRound', round: 1 });
  assert.equal(room.phase, 'write', 'all in: round 2 starts');
  assert.equal(room.wb.round, 2);
});

test('between rounds: when the 30 s run out, only those who opted in play on; nobody: the game ends', () => {
  const ctx = writeBarsRoom(3);
  const { room } = ctx;
  allDone(ctx, ['p1', 'p2', 'p3']);
  runBattle(ctx);
  rateAll(ctx, ['p1', 'p2', 'p3']);
  room.input('p1', { type: 'nextRound', round: 1 });
  room.input('p3', { type: 'nextRound', round: 1 });
  ctx.advance(NEXT_ROUND_SECONDS * 1000);
  assert.equal(room.phase, 'write');
  assert.deepEqual([...room.wb.entries.keys()], ['p1', 'p3'], 'p2 sits out');
  allDone(ctx, ['p1', 'p3']);
  runBattle(ctx);
  rateAll(ctx, ['p1', 'p2', 'p3']);
  assert.equal(room.phase, 'standings');
  ctx.advance(NEXT_ROUND_SECONDS * 1000);
  assert.equal(room.phase, 'results', 'nobody opted in: straight to the podium');
});

test('between rounds: if the only rapper not ready leaves, the next round starts', () => {
  const ctx = writeBarsRoom(2);
  const { room } = ctx;
  allDone(ctx, ['p1', 'p2']);
  runBattle(ctx);
  rateAll(ctx, ['p1', 'p2']);
  room.input('p1', { type: 'nextRound', round: 1 });
  room.leave('p2');
  assert.equal(room.phase, 'write');
});

test('half stars: ratings from 0.5 to 5 in half steps; totals keep the halves', () => {
  const ctx = writeBarsRoom(2);
  const { room } = ctx;
  allDone(ctx, ['p1', 'p2']);
  endPerformance(ctx);
  assert.equal(room.input('p2', { type: 'votes', stars: { p1: 0 }, round: 1 }), false, 'not zero');
  assert.equal(room.input('p2', { type: 'votes', stars: { p1: 3.25 }, round: 1 }), false, 'halves only');
  assert.equal(room.input('p2', { type: 'votes', stars: { p1: 5.5 }, round: 1 }), false, 'five at most');
  assert.ok(room.input('p2', { type: 'votes', stars: { p1: 3.5 }, round: 1 }));
  endPerformance(ctx);
  assert.ok(room.input('p1', { type: 'votes', stars: { p2: 0.5 }, round: 1 }));
  assert.deepEqual(room.wb.roundResults.map((r) => [r.id, r.stars, r.total]), [['p1', 3.5, 3.5], ['p2', 0.5, 0.5]]);
});
