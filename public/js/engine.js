// Authoritative Rapmates room logic, in two modes:
//   Write Bars (the default): every rapper gets 2 rhyme pairs and 60 seconds to write 4 lines, then each
//     performs them over 8 bars (read out live or by a robot voice), the room rates every performance
//     out of 5 stars, and after 3 rounds the most stars takes the mic.
//   Freestyle: up to 8 rappers take turns spitting 16 bars over a backing track, everybody else in the
//     room (other rappers and the crowd) rates each turn out of 5 stars, and the best average takes the mic.
// Runs in the host's browser (window.RapmatesEngine) and in Node for tests
// (require). It knows nothing about networking: the caller supplies broadcast(event, data) and
// send(playerId, event, data).
//
// Timing: the room never streams audio. Each turn is a schedule in the host's clock (now()):
// startAt (when the track's intro bar 1 starts), the track (picked at random by the host, so everyone
// plays the same file) and the turn's rhyme pairs. Every browser converts startAt into its own audio
// clock and plays the track and the bouncing ball locally (see client.js and tracks.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./words.js'), require('./tracks.js'));
  else root.RapmatesEngine = factory(root.RapmatesWords, root.RapmatesTracks);
})(typeof self !== 'undefined' ? self : this, (Words, Tracks) => {
  const TICK_RATE = 10; // phase checks per second; turns themselves are absolute timestamps
  const MAX_PLAYERS = 8;
  const BARS = Words.BARS_PER_TURN; // 16
  const BEATS_PER_BAR = Words.BEATS_PER_BAR; // 4
  const COUNT_IN_BEATS = 8; // "8 ... 1" over the last two intro bars
  const LEAD_MS = 1500; // before the track starts, so every browser gets the turn in time
  const VOTE_SECONDS = 20;
  const SCORE_MS = 4500; // how long a rapper's average is shown before the next turn
  // Write Bars.
  const MODES = ['writebars', 'freestyle'];
  const DEFAULT_MODE = 'writebars';
  const WRITE_SECONDS = 90; // to write 4 lines
  const WRITE_GRACE_MS = 1000; // drafts sent as a player's clock hits 0 still count
  const WB_ROUNDS = 3;
  const WB_LINES = 4;
  const WB_PAIRS = 2; // per rapper per round: lines 1-2 use pair A, lines 3-4 pair B
  const WB_BARS_PER_LINE = 2;
  const WB_RAP_BARS = WB_LINES * WB_BARS_PER_LINE; // 8 bars after the 4-bar intro
  // Who performs Write Bars lines: the rapper live, or the robot MC with a male or female voice.
  const VOICES = ['self', 'male', 'female'];
  const ROUND_ENDS = 6; // sfx/round-end-01.mp3 .. -06.mp3
  const ADLIBS = ['faaah', 'damn']; // sfx/<name>.mp3, alternated
  const VOICE_ACCENTS = ['GB', 'US']; // the robot voice's accent, picked at random per performance
  const WB_BPM = 90; // only the 90 BPM tracks: room to say the lines
  const MIC_DROP_MS = 7000; // the mic-drop takeover after a rapper finishes, before the vote / next rapper
  const WB_GAP_MS = MIC_DROP_MS; // Write Bars: after a performance (golf clap and mic drop while the track fades)
  const WB_VOTE_SECONDS = 20; // rating each performance straight after it
  const STANDINGS_MS = 8000; // the final scoreboard, before the podium
  // The intro screen at the start of a game: the rules read out over a beat (sfx/intro-<mode>.mp3), a little
  // longer than the voiceover. The host can skip it.
  const INTRO_MS = { writebars: 16000, freestyle: 19500 };
  const NEXT_ROUND_SECONDS = 30; // between rounds: rappers press "Play next round"; whoever has by then plays on
  const LINE_MAX = 80; // characters per line
  const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion with 1/0
  // Moody accents; green is kept for the ball and finished beats.
  const PLAYER_COLORS = ['#E5484D', '#4FB3D9', '#F2A93B', '#A07BE8', '#E879B9', '#5B7FE8', '#C98B5A', '#6FCFB6'];
  const NAME_MAX = 16; // characters in a player's name

  // A name as typed: no control characters, spaces collapsed, at most NAME_MAX characters.
  function sanitizeName(name) {
    if (typeof name !== 'string') return '';
    const clean = name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(clean).slice(0, NAME_MAX).join('').trim();
  }

  const randInt = (n, random = Math.random) => Math.floor(random() * n);
  const round2 = (x) => Math.round(x * 100) / 100;

  function generateRoomCode(isTaken = () => false) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += ROOM_CODE_ALPHABET[randInt(ROOM_CODE_ALPHABET.length)];
      if (!isTaken(code)) return code;
    }
    throw new Error('Unable to allocate a unique room code');
  }

  // Milliseconds from the track's start (intro bar 1) to the end of the last rap bar.
  const turnLengthMs = (track, rapBars) => Tracks.turnSeconds(track, rapBars) * 1000;

  // Write Bars: line k (1-4) starts on the downbeat of performance bar 2k - 1, i.e. after the intro.
  const lineBar = (track, k) => track.introBars + (k - 1) * WB_BARS_PER_LINE + 1;
  const lineStartMs = (track, startAt, k) => startAt + Tracks.barTime(track, lineBar(track, k)) * 1000;

  // One written line: text only, no control characters, spaces collapsed, at most LINE_MAX characters.
  function sanitizeLine(text) {
    if (typeof text !== 'string') return '';
    const clean = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(clean).slice(0, LINE_MAX).join('').trim();
  }
  const sanitizeLines = (lines) => Array.from({ length: WB_LINES }, (_, i) => sanitizeLine(Array.isArray(lines) ? lines[i] : ''));

  // Write Bars standings: most stars across the rounds; everyone tied on a top score above 0 wins.
  function totalsStandingsOf(totals) {
    const standings = totals.slice().sort((a, b) => b.total - a.total || a.number - b.number);
    const top = standings.length ? standings[0].total : 0;
    const winnerIds = top > 0 ? standings.filter((r) => r.total === top).map((r) => r.id) : [];
    return { standings, winnerIds };
  }

  // Ranks rappers by average stars (no votes counts as lowest); everyone tied on the top average wins.
  function standingsOf(results) {
    const standings = results.slice().sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.number - b.number);
    const top = standings.length ? standings[0].average : null;
    const winnerIds = top === null || top === undefined ? [] : standings.filter((r) => r.average === top).map((r) => r.id);
    return { standings, winnerIds };
  }

  class GameRoom {
    /**
     * @param {string} code room code
     * @param {object} hooks broadcast(event, data), send(playerId, event, data), optional
     *   setInterval/clearInterval, random (pair draws) and now() (the host clock, ms)
     */
    constructor(code, hooks) {
      this.code = code;
      this.broadcast = hooks.broadcast;
      this.send = hooks.send;
      this.setInterval = hooks.setInterval || ((fn, ms) => setInterval(fn, ms));
      this.clearInterval = hooks.clearInterval || ((id) => clearInterval(id));
      this.random = hooks.random || Math.random;
      this.introMs = hooks.introMs; // the intro screen's length (tests use 0 to skip it); default INTRO_MS
      this.maxPlayers = Math.min(MAX_PLAYERS, hooks.maxPlayers || MAX_PLAYERS); // rapper slots (tests use fewer)
      this.now = hooks.now || (() => Date.now());
      this.leadMs = hooks.leadMs ?? LEAD_MS;
      this.hostId = null;
      this.members = new Map(); // id -> { id, role: 'player'|'crowd', number, name, color, seq }
      this.seq = 0;
      this.lastTrackId = null; // never the same track twice in a row
      this.adlibGap = 0; // turns since the last ad-lib
      this.adlibCount = 0; // ad-libs so far, to alternate them
      this.roundEndCount = 0; // turns so far, to cycle the round-end voiceovers
      this.started = false;
      this.loop = null;
      this.round = 0;
      this.phase = null; // 'turn' | 'vote' | 'score' | 'results' | null
      this.order = []; // rapper ids for this game, P1 first
      this.turnIndex = -1;
      this.turn = null; // { rapperId, startAt, endAt, pairs }
      this.votes = new Map(); // voterId -> stars, for the current turn
      this.voteEndsAt = 0;
      this.scoreEndsAt = 0;
      this.results = []; // one entry per finished turn
      this.deck = [];
      this.mode = DEFAULT_MODE;
      this.wb = null; // Write Bars: { round, rounds, writeMs, writeEndsAt, entries, queue, perf, performers, votes, totals, roundResults, standingsEndsAt }
    }

    get size() {
      return this.members.size;
    }

    // Rappers (players with a P1-P8 slot), by number.
    get players() {
      return [...this.members.values()].filter((m) => m.role === 'player').sort((a, b) => a.number - b.number);
    }

    get crowd() {
      return [...this.members.values()].filter((m) => m.role === 'crowd').sort((a, b) => a.seq - b.seq);
    }

    // Everyone picks their own name; a clash gets a number ("Zak 2"), and no name becomes "Rapper".
    pickName(preferredName) {
      const used = new Set([...this.members.values()].map((m) => m.name.toLowerCase()));
      const base = sanitizeName(preferredName) || 'Rapper';
      if (!used.has(base.toLowerCase())) return base;
      for (let n = 2; ; n++) {
        const name = `${Array.from(base).slice(0, NAME_MAX - String(n).length - 1).join('').trim()} ${n}`;
        if (!used.has(name.toLowerCase())) return name;
      }
    }

    // Adds a member without messaging anyone; call announceJoin() after acknowledging the joiner.
    // The first 8 get rapper slots; everyone after that joins the crowd (watches and votes).
    // preferredName is the name the player picked (also kept when moving to a new host after a handover).
    join(id, preferredName) {
      if (this.members.has(id)) return { ok: false, error: 'Already in this room.' };
      const players = this.players;
      const member = { id, name: this.pickName(preferredName), seq: ++this.seq };
      if (players.length < this.maxPlayers) {
        const taken = new Set(players.map((p) => p.number));
        let number = 1;
        while (taken.has(number)) number++;
        Object.assign(member, { role: 'player', number, color: PLAYER_COLORS[number - 1] });
      } else {
        Object.assign(member, { role: 'crowd', number: null, color: '#8a8a8a' });
      }
      this.members.set(id, member);
      if (!this.hostId) this.hostId = id;
      return { ok: true, payload: { playerId: id, ...this.lobbyPayload() } };
    }

    announceJoin(id) {
      this.broadcastLobby();
      if (this.started) this.send(id, 'gameStarted', this.gamePayload());
    }

    leave(id) {
      const leaver = this.members.get(id);
      if (!leaver) return;
      this.members.delete(id);
      if (this.members.size === 0) {
        this.destroy();
        return;
      }
      if (this.hostId === id) this.hostId = this.nextHostId();
      if (!this.started) this.fillSlots();
      if (this.started && this.mode === 'writebars') this.writeBarsLeave(id);
      else if (this.started) {
        const rapperLeft = this.turn && this.turn.rapperId === id && (this.phase === 'turn' || this.phase === 'vote');
        if (rapperLeft) {
          this.nextTurn();
        } else if (this.phase === 'vote' && this.allVoted()) {
          this.closeVote();
        }
      }
      this.broadcastLobby();
    }

    // Between games, free rapper slots go to whoever's waited longest in the crowd.
    fillSlots() {
      for (let number = 1; number <= this.maxPlayers; number++) {
        if (this.players.some((p) => p.number === number)) continue;
        const promoted = this.crowd[0];
        if (!promoted) return;
        Object.assign(promoted, { role: 'player', number, color: PLAYER_COLORS[number - 1] });
      }
    }

    // Who takes over hosting: rappers in slot order, then the crowd in the order they arrived.
    nextHostId() {
      const next = this.players[0] || this.crowd[0];
      return next ? next.id : null;
    }

    // The host starts (or restarts) the game.
    start(requesterId, options = {}) {
      if (this.started || requesterId !== this.hostId) return false;
      if (!this.players.length) return false;
      this.round += 1;
      this.started = true;
      this.order = this.players.map((p) => p.id);
      this.results = [];
      this.deck = Words.shuffledIndexes(Words.PAIRS.length, this.random);
      this.turnIndex = -1;
      this.turn = null;
      if (this.mode === 'writebars') {
        // options.writeSeconds: a shorter write timer for testing (?debug&write=10).
        const secs = Number.isFinite(options.writeSeconds) ? Math.max(5, Math.min(WRITE_SECONDS, options.writeSeconds)) : WRITE_SECONDS;
        this.wb = { round: 0, rounds: WB_ROUNDS, writeMs: secs * 1000, writeEndsAt: 0, entries: new Map(), queue: [], perf: -1, performers: [], votes: new Map(), totals: new Map(), roundResults: [], standingsEndsAt: 0 };
      } else {
        this.wb = null;
      }
      // First the intro screen (the rules over a beat), unless it's switched off (options.intro === false).
      const introMs = options.intro === false ? 0 : (this.introMs ?? INTRO_MS[this.mode] ?? 0);
      if (introMs > 0) {
        this.phase = 'intro';
        this.introStartedAt = this.now();
        this.introEndsAt = this.introStartedAt + introMs;
      } else {
        this.beginFirst(false);
        if (!this.started) return true; // nobody left to play
      }
      this.broadcast('gameStarted', this.gamePayload());
      this.stopLoop();
      this.loop = this.setInterval(() => this.gameTick(), 1000 / TICK_RATE);
      return true;
    }

    // After the intro: the first write phase (Write Bars) or the first turn (Freestyle).
    beginFirst(announce = true) {
      if (this.mode === 'writebars') this.beginWrite(announce);
      else this.beginTurn(0, announce);
    }

    // The host skips the intro.
    skipIntro(id) {
      if (this.phase !== 'intro' || id !== this.hostId) return false;
      this.beginFirst();
      return true;
    }

    /**
     * Input from anyone in the room:
     *   { type: 'mode', mode: 'writebars'|'freestyle' } the host picks the mode in the lobby.
     *   { type: 'skipIntro' } the host skips the intro screen.
     *   Freestyle:
     *   { type: 'vote', stars: 1-5, turn: turnIndex } rate the rapper whose turn just finished.
     *   The rapper can't vote for themselves; rappers and the crowd can vote for everyone else.
     *   Write Bars:
     *   { type: 'draft'|'done', lines: [4 strings], voice: 'self'|'male'|'female' } a rapper's lines so far, or locked in.
     *   { type: 'edit' } unlock your locked-in lines to change them (while others are still writing).
     *   { type: 'votes', stars: { rapperId: 1-5, ... }, round } rate the round's performances (not your own).
     */
    input(id, msg) {
      if (!msg || typeof msg !== 'object') return false;
      if (msg.type === 'mode') return this.setMode(id, msg.mode);
      if (!this.started) return false;
      if (msg.type === 'skipIntro') return this.skipIntro(id);
      if (msg.type === 'vote') return this.vote(id, msg.stars, msg.turn);
      if (msg.type === 'draft' || msg.type === 'done') return this.write(id, msg.lines, msg.voice, msg.type === 'done');
      if (msg.type === 'edit') return this.unlockWrite(id);
      if (msg.type === 'votes') return this.rateAll(id, msg.stars, msg.round);
      if (msg.type === 'nextRound') return this.readyNextRound(id, msg.round);
      return false;
    }

    setMode(id, mode) {
      if (this.started || id !== this.hostId || !MODES.includes(mode)) return false;
      this.mode = mode;
      this.broadcastLobby();
      return true;
    }

    vote(id, stars, turnIndex = this.turnIndex) {
      if (this.mode !== 'freestyle' || this.phase !== 'vote' || !this.members.has(id) || !this.turn) return false;
      if (turnIndex !== undefined && turnIndex !== this.turnIndex) return false;
      if (id === this.turn.rapperId) return false;
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) return false;
      this.votes.set(id, stars);
      if (this.allVoted()) this.closeVote();
      else this.broadcast('votes', this.serializeVotes());
      return true;
    }

    destroy() {
      this.stopLoop();
      this.started = false;
      this.phase = null;
    }

    // ---------- internals ----------

    eligibleVoters() {
      const rapper = this.turn && this.turn.rapperId;
      return [...this.members.keys()].filter((id) => id !== rapper);
    }

    allVoted() {
      const voters = this.eligibleVoters();
      return voters.every((id) => this.votes.has(id));
    }

    // Starts turn `index` (skipping rappers who've left). Ends the game when nobody's left to rap.
    beginTurn(index, announce = true) {
      while (index < this.order.length && !this.members.has(this.order[index])) index++;
      if (index >= this.order.length) {
        this.endGame();
        return;
      }
      if (this.deck.length < Words.PAIRS_PER_TURN) this.deck = Words.shuffledIndexes(Words.PAIRS.length, this.random);
      const pairs = this.deck.splice(0, Words.PAIRS_PER_TURN).map((i) => Words.PAIRS[i].slice());
      const startAt = this.now() + this.leadMs;
      this.turnIndex = index;
      const track = Tracks.pickTrack(this.lastTrackId, this.random);
      this.lastTrackId = track.id;
      this.turn = { rapperId: this.order[index], startAt, endAt: startAt + turnLengthMs(track), pairs, trackId: track.id, bpm: track.bpm, adlib: this.nextAdlib(), roundEnd: this.nextRoundEnd() };
      this.votes = new Map();
      this.phase = 'turn';
      if (announce) this.broadcast('phase', this.phasePayload());
    }

    nextTurn() {
      this.beginTurn(this.turnIndex + 1);
    }

    openVote() {
      this.phase = 'vote';
      this.votes = new Map();
      this.voteEndsAt = this.now() + VOTE_SECONDS * 1000;
      // Practising alone in a room: nobody to vote, carry on.
      if (!this.eligibleVoters().length) return this.closeVote();
      this.broadcast('phase', this.phasePayload());
    }

    closeVote() {
      const rapper = this.members.get(this.turn.rapperId);
      const stars = [...this.votes.values()];
      const average = stars.length ? round2(stars.reduce((a, b) => a + b, 0) / stars.length) : null;
      if (rapper) {
        this.results.push({ id: rapper.id, name: rapper.name, number: rapper.number, color: rapper.color, average, votes: stars.length });
      }
      this.phase = 'score';
      this.scoreEndsAt = this.now() + SCORE_MS;
      this.broadcast('phase', this.phasePayload());
    }

    gameTick() {
      if (!this.started) return;
      const now = this.now();
      if (this.phase === 'intro') {
        if (now >= this.introEndsAt) this.beginFirst();
        return;
      }
      if (this.mode === 'writebars') return this.writeBarsTick(now);
      if (this.phase === 'turn' && now >= this.turn.endAt + MIC_DROP_MS) this.openVote();
      else if (this.phase === 'vote' && now >= this.voteEndsAt) this.closeVote();
      else if (this.phase === 'score' && now >= this.scoreEndsAt) this.nextTurn();
    }

    endGame() {
      this.stopLoop();
      this.started = false;
      this.phase = 'results';
      this.turn = null;
      this.fillSlots();
      const standings = this.mode === 'writebars' && this.wb ? totalsStandingsOf([...this.wb.totals.values()]) : standingsOf(this.results);
      this.broadcast('gameOver', { round: this.round, mode: this.mode, ...standings });
      this.broadcastLobby();
    }

    serializeMember(m) {
      return { id: m.id, role: m.role, number: m.number, name: m.name, color: m.color };
    }

    serializeVotes() {
      if (this.mode === 'writebars' && this.wb) {
        const voters = this.writeBarsVoters();
        const voted = voters.filter((id) => this.hasRatedAll(id));
        return { turnIndex: this.turnIndex, round: this.wb.round, count: voted.length, needed: voters.length, voted };
      }
      const voters = this.eligibleVoters();
      return { turnIndex: this.turnIndex, count: voters.filter((id) => this.votes.has(id)).length, needed: voters.length, voted: [...this.votes.keys()] };
    }

    phasePayload() {
      const p = { phase: this.phase, mode: this.mode, turnIndex: this.turnIndex, turns: this.order.length, now: this.now() };
      if (this.turn) {
        const rapper = this.members.get(this.turn.rapperId);
        p.turn = { ...this.turn, pairs: this.turn.pairs.map((pair) => pair.slice()), name: rapper ? rapper.name : '', color: rapper ? rapper.color : '#fff' };
        if (this.turn.lines) p.turn.lines = this.turn.lines.slice();
      }
      if (this.phase === 'intro') Object.assign(p, { introStartedAt: this.introStartedAt, introEndsAt: this.introEndsAt });
      const wb = this.mode === 'writebars' ? this.wb : null;
      if (wb) Object.assign(p, { wbRound: wb.round, rounds: wb.rounds, totals: [...wb.totals.values()].map((t) => ({ ...t })) });
      if (wb && this.phase === 'write') Object.assign(p, { writeEndsAt: wb.writeEndsAt, writeMs: wb.writeMs, writers: this.serializeWriters() });
      if (wb && this.phase === 'standings') {
        Object.assign(p, {
          standingsEndsAt: wb.standingsEndsAt, roundResults: wb.roundResults.map((r) => ({ ...r })),
          nextRappers: this.nextRoundRappers(), nextReady: [...(wb.nextReady || [])],
        });
      }
      if (wb && this.phase === 'vote') {
        p.performances = wb.performers.filter((id) => this.members.has(id)).map((id) => {
          const m = this.members.get(id);
          const e = wb.entries.get(id);
          return { id, name: m.name, number: m.number, color: m.color, lines: e.lines.slice(), pairs: e.pairs.map((pair) => pair.slice()), voice: e.voice };
        });
      }
      if (this.phase === 'vote') Object.assign(p, { voteEndsAt: this.voteEndsAt, voteMs: (wb ? WB_VOTE_SECONDS : VOTE_SECONDS) * 1000, votes: this.serializeVotes() });
      if (this.phase === 'score') Object.assign(p, { scoreEndsAt: this.scoreEndsAt, result: this.results[this.results.length - 1] || null });
      return p;
    }

    lobbyPayload() {
      return {
        roomCode: this.code,
        hostId: this.hostId,
        started: this.started,
        mode: this.mode,
        players: this.players.map((m) => this.serializeMember(m)),
        crowd: this.crowd.map((m) => this.serializeMember(m)),
      };
    }

    gamePayload() {
      return {
        round: this.round,
        order: this.order.slice(),
        results: this.results.slice(),
        ...this.phasePayload(),
        ...this.lobbyPayload(),
      };
    }

    broadcastLobby() {
      this.broadcast('lobbyUpdate', this.lobbyPayload());
    }

    // ---------- Write Bars ----------

    // A new round: every rapper still here gets 2 fresh rhyme pairs (never repeated in a game) and the clock starts.
    beginWrite(announce = true) {
      const wb = this.wb;
      const writers = this.order.filter((id) => this.members.has(id));
      if (!writers.length) return this.endGame();
      wb.round += 1;
      wb.entries = new Map(writers.map((id) => {
        if (this.deck.length < WB_PAIRS) this.deck = Words.shuffledIndexes(Words.PAIRS.length, this.random);
        const pairs = this.deck.splice(0, WB_PAIRS).map((i) => Words.PAIRS[i].slice());
        // The robot MC's default voice alternates by seat (P1 male, P2 female, ...) until the rapper picks.
        const number = (this.members.get(id) || {}).number || 1;
        return [id, { pairs, lines: sanitizeLines([]), voice: number % 2 ? 'male' : 'female', done: false }];
      }));
      wb.queue = [];
      wb.perf = -1;
      wb.performers = [];
      wb.votes = new Map();
      wb.writeEndsAt = this.now() + wb.writeMs;
      this.phase = 'write';
      this.turn = null;
      this.turnIndex = -1;
      if (announce) this.broadcast('phase', this.phasePayload());
    }

    // Back to writing after locking in, while the others are still going.
    unlockWrite(id) {
      if (this.mode !== 'writebars' || this.phase !== 'write') return false;
      const entry = this.wb.entries.get(id);
      if (!entry || !entry.done) return false;
      entry.done = false;
      this.broadcast('writers', { round: this.wb.round, writers: this.serializeWriters() });
      return true;
    }

    write(id, lines, voice, done) {
      if (this.mode !== 'writebars' || this.phase !== 'write') return false;
      const entry = this.wb.entries.get(id);
      if (!entry || entry.done) return false;
      if (Array.isArray(lines)) entry.lines = sanitizeLines(lines);
      if (VOICES.includes(voice)) entry.voice = voice;
      if (done) {
        entry.done = true;
        if (this.allWritten()) this.beginBattle();
        else this.broadcast('writers', { round: this.wb.round, writers: this.serializeWriters() });
      }
      return true;
    }

    allWritten() {
      return [...this.wb.entries].every(([id, e]) => e.done || !this.members.has(id));
    }

    serializeWriters() {
      return [...this.wb.entries].filter(([id]) => this.members.has(id)).map(([id, e]) => {
        const m = this.members.get(id);
        return { id, name: m.name, number: m.number, color: m.color, pairs: e.pairs.map((pair) => pair.slice()), done: e.done };
      });
    }

    // Everyone performs in seat order.
    beginBattle() {
      const wb = this.wb;
      wb.queue = this.order.filter((id) => this.members.has(id) && wb.entries.has(id));
      wb.perf = -1;
      wb.roundStars = new Map(); // id -> { stars, votes } this round
      wb.performers = [];
      this.beginPerformance(0);
    }

    // Performance `index` (skipping rappers who've left): a random 90 BPM track, 4 intro bars, then
    // 8 bars with a line every 2 bars. The robot voice alternates male / female down the order.
    beginPerformance(index) {
      const wb = this.wb;
      while (index < wb.queue.length && !this.members.has(wb.queue[index])) index++;
      if (index >= wb.queue.length) return this.closeRound();
      wb.perf = index;
      const id = wb.queue[index];
      const entry = wb.entries.get(id);
      const track = Tracks.pickTrack(this.lastTrackId, this.random, (t) => t.bpm === WB_BPM);
      this.lastTrackId = track.id;
      const startAt = this.now() + this.leadMs;
      this.turnIndex = index;
      this.turn = {
        rapperId: id, startAt, endAt: startAt + turnLengthMs(track, WB_RAP_BARS), trackId: track.id, bpm: track.bpm,
        mode: 'writebars', rapBars: WB_RAP_BARS, fadeAfterBars: track.introBars + WB_RAP_BARS,
        lines: entry.lines.slice(), pairs: entry.pairs.map((pair) => pair.slice()), voice: entry.voice,
        voiceGender: entry.voice === 'female' ? 'female' : 'male', adlib: this.nextAdlib(), roundEnd: this.nextRoundEnd(),
        voiceAccent: VOICE_ACCENTS[Math.floor(this.random() * VOICE_ACCENTS.length)], perf: index, perfs: wb.queue.length, wbRound: wb.round,
      };
      this.phase = 'turn';
      this.broadcast('phase', this.phasePayload());
    }

    // Straight after each performance (and its mic drop), everyone else rates it 1-5 stars.
    openPerfVote() {
      const wb = this.wb;
      const id = this.turn && this.turn.rapperId;
      if (!id || !this.members.has(id)) return this.beginPerformance(wb.perf + 1);
      wb.performers = [id];
      wb.votes = new Map();
      this.phase = 'vote';
      this.voteEndsAt = this.now() + WB_VOTE_SECONDS * 1000;
      if (!this.writeBarsVoters().length) return this.closePerfVote();
      this.broadcast('phase', this.phasePayload());
    }

    // Who this voter can rate: the performers still here, except themselves.
    rateableBy(id) {
      return this.wb.performers.filter((p) => p !== id && this.members.has(p));
    }

    writeBarsVoters() {
      return [...this.members.keys()].filter((id) => this.rateableBy(id).length);
    }

    hasRatedAll(id) {
      const mine = this.wb.votes.get(id) || {};
      return this.rateableBy(id).every((p) => mine[p]);
    }

    rateAll(id, stars, round) {
      const wb = this.wb;
      if (this.mode !== 'writebars' || !wb || this.phase !== 'vote' || !this.members.has(id)) return false;
      if (round !== undefined && round !== wb.round) return false;
      if (!stars || typeof stars !== 'object') return false;
      const ratings = {};
      this.rateableBy(id).forEach((p) => {
        const n = stars[p];
        if (Number.isInteger(n) && n >= 1 && n <= 5) ratings[p] = n;
      });
      if (!Object.keys(ratings).length) return false;
      wb.votes.set(id, { ...(wb.votes.get(id) || {}), ...ratings });
      if (this.writeBarsVoters().every((v) => this.hasRatedAll(v))) this.closePerfVote();
      else this.broadcast('votes', this.serializeVotes());
      return true;
    }

    // The performance's stars go on the rapper's running total, then the next rapper is up.
    closePerfVote() {
      const wb = this.wb;
      const id = wb.performers[0];
      const m = id && this.members.get(id);
      if (m) {
        const got = [...wb.votes.values()].map((b) => b[id]).filter(Boolean);
        const stars = got.reduce((a, b) => a + b, 0);
        const prev = wb.roundStars.get(id) || { stars: 0, votes: 0 };
        wb.roundStars.set(id, { stars: prev.stars + stars, votes: prev.votes + got.length });
        const total = (wb.totals.has(id) ? wb.totals.get(id).total : 0) + stars;
        wb.totals.set(id, { id, name: m.name, number: m.number, color: m.color, total });
      }
      wb.performers = [];
      this.beginPerformance(wb.perf + 1);
    }

    // After the round's last performance (and its vote): the scoreboard.
    closeRound() {
      const wb = this.wb;
      this.turn = null;
      this.turnIndex = -1;
      wb.roundResults = wb.queue.filter((id) => this.members.has(id)).map((id) => {
        const m = this.members.get(id);
        const got = wb.roundStars.get(id) || { stars: 0, votes: 0 };
        const total = wb.totals.has(id) ? wb.totals.get(id).total : 0;
        if (!wb.totals.has(id)) wb.totals.set(id, { id, name: m.name, number: m.number, color: m.color, total });
        return { id, name: m.name, number: m.number, color: m.color, stars: got.stars, votes: got.votes, total };
      }).sort((a, b) => b.total - a.total || a.number - b.number);
      if (!wb.roundResults.length && !this.nextRoundRappers().length) return this.endGame();
      this.phase = 'standings';
      // Between rounds the scoreboard waits for the rappers (up to NEXT_ROUND_SECONDS); after the last it's brief.
      wb.nextReady = new Set();
      wb.standingsEndsAt = this.now() + (wb.round >= wb.rounds ? STANDINGS_MS : NEXT_ROUND_SECONDS * 1000);
      this.broadcast('phase', this.phasePayload());
    }

    // Rappers still in this game who can opt in to the next round.
    nextRoundRappers() {
      return this.order.filter((id) => this.members.has(id));
    }

    // A rapper pressed "Play next round". Everyone in: start straight away.
    readyNextRound(id, round) {
      const wb = this.wb;
      if (this.mode !== 'writebars' || this.phase !== 'standings' || !wb || wb.round >= wb.rounds) return false;
      if (round !== undefined && round !== wb.round) return false;
      if (!this.nextRoundRappers().includes(id) || wb.nextReady.has(id)) return false;
      wb.nextReady.add(id);
      if (this.nextRoundRappers().every((r) => wb.nextReady.has(r))) this.startNextRound();
      else this.broadcast('phase', this.phasePayload());
      return true;
    }

    // Whoever opted in plays on (the rest sit out and watch); nobody did: the game ends.
    startNextRound() {
      const wb = this.wb;
      const going = this.nextRoundRappers().filter((id) => wb.nextReady.has(id));
      if (!going.length) return this.endGame();
      this.order = going;
      this.beginWrite();
    }

    writeBarsTick(now) {
      const wb = this.wb;
      if (this.phase === 'write' && now >= wb.writeEndsAt + WRITE_GRACE_MS) this.beginBattle();
      else if (this.phase === 'turn' && now >= this.turn.endAt + WB_GAP_MS) this.openPerfVote();
      else if (this.phase === 'vote' && now >= this.voteEndsAt) this.closePerfVote();
      else if (this.phase === 'standings' && now >= wb.standingsEndsAt) {
        if (wb.round >= wb.rounds) this.endGame();
        else this.startNextRound();
      }
    }

    // Someone left mid-game: don't wait for them.
    writeBarsLeave(id) {
      if (this.phase === 'write') {
        if (this.allWritten()) this.beginBattle();
        else this.broadcast('writers', { round: this.wb.round, writers: this.serializeWriters() });
      } else if (this.phase === 'turn' && this.turn && this.turn.rapperId === id) {
        this.beginPerformance(this.wb.perf + 1);
      } else if (this.phase === 'vote') {
        // The performer left, or everyone left has voted: on with the show.
        if (!this.wb.performers.some((p) => this.members.has(p)) || this.writeBarsVoters().every((v) => this.hasRatedAll(v))) this.closePerfVote();
        else this.broadcast('votes', this.serializeVotes());
      } else if (this.phase === 'standings' && this.wb.round < this.wb.rounds) {
        const left = this.nextRoundRappers();
        if (left.length && left.every((r) => this.wb.nextReady.has(r))) this.startNextRound();
        else this.broadcast('phase', this.phasePayload());
      }
    }

    // The voiceover after each turn (sfx/round-end-0N.mp3), cycling through them, so everyone hears the same one.
    nextRoundEnd() {
      return (this.roundEndCount++ % ROUND_ENDS) + 1;
    }

    // About every 3rd turn gets an ad-lib (never two turns running, 50/50 on the 3rd, always by the 4th),
    // alternating "faaah" and "damn". Returns its name, or null for none.
    nextAdlib() {
      this.adlibGap += 1;
      const yes = this.adlibGap >= 4 || (this.adlibGap === 3 && this.random() < 0.5);
      if (!yes) return null;
      this.adlibGap = 0;
      return ADLIBS[this.adlibCount++ % ADLIBS.length];
    }

    stopLoop() {
      if (this.loop !== null) this.clearInterval(this.loop);
      this.loop = null;
    }
  }

  return {
    GameRoom,
    VOICE_ACCENTS,
    ADLIBS,
    ROUND_ENDS,
    VOICES,
    generateRoomCode,
    standingsOf,
    totalsStandingsOf,
    turnLengthMs,
    lineBar,
    lineStartMs,
    sanitizeLine,
    sanitizeLines,
    MODES,
    DEFAULT_MODE,
    WRITE_SECONDS,
    WRITE_GRACE_MS,
    WB_ROUNDS,
    WB_LINES,
    WB_PAIRS,
    WB_BARS_PER_LINE,
    WB_RAP_BARS,
    WB_BPM,
    WB_GAP_MS,
    MIC_DROP_MS,
    WB_VOTE_SECONDS,
    STANDINGS_MS,
    INTRO_MS,
    NEXT_ROUND_SECONDS,
    LINE_MAX,
    TICK_RATE,
    MAX_PLAYERS,
    BARS,
    BEATS_PER_BAR,
    COUNT_IN_BEATS,
    LEAD_MS,
    VOTE_SECONDS,
    SCORE_MS,
    PLAYER_COLORS,
    NAME_MAX,
    sanitizeName,
  };
});
