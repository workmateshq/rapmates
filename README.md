# Rapmates

A party rap battle for up to 8 mates, plus a crowd. Everyone's in the same room (or on a call) and the game drops the beat. Two modes:

- **Write Bars** (the default): everyone gets their own two rhyming pairs and 90 seconds to write 4 lines, then each rapper performs them over the beat (read out live, or by a robot voice), the room rates every performance, and after 3 rounds the most stars takes the mic.
- **Freestyle**: a bouncing ball keeps time and rhyme prompts tell you which word to land on the 4th beat of every bar. Spit 16 bars each, the room rates you out of 5 stars, and the best average takes the mic.

Play it at **https://workmateshq.github.io/rapmates/** or jump straight into the shared room at **https://workmateshq.github.io/rapmates/mate**.

- **Rappers and the crowd**: the first 8 people in a room get the P1–P8 slots; everyone after that joins the **crowd** (shown as "Crowd: N" in the lobby). Everybody picks their own name (up to 16 characters) the first time they create, join or open a room link; it's remembered on that device and can be changed on the home screen. If two people pick the same name, the second gets a number ("Zak 2"). Between games, a free slot goes to whoever's waited longest in the crowd.
- **No mics needed**: nobody's audio is sent anywhere. Every screen plays the same beat and shows the same bars at the same moment; you rap out loud.
- **Modes**: the host picks **Write Bars** or **Freestyle** in the lobby (everyone else sees the choice). Write Bars is the default, including in link rooms like /mate.

### Write Bars

- **Writing** (all rappers at once, 90 seconds on the host's clock): each rapper gets **their own 2 rhyming pairs** (nobody shares a pair in a round, and no pair comes back in the same game). The 4 words show as tiles at the top (each pair in its own colour). They're just prompts: write 4 lines, one per box, and use the words anywhere, in any line, or not at all. Lines are up to 80 characters; empty lines are allowed (shown as "…"). Pick **who spits it**: "I'll rap it myself", "Robot MC (Male)" or "Robot MC (Female)". Press **Done** to lock in and wait for the others; finished early, you can press **Edit my bars** to change things and lock in again. When everyone's locked in, the battle starts straight away. With 10 seconds left the clock turns red and pulses and a tick plays every second (twice a second, louder, for the last 3; it follows the sound-effects toggle). Drafts are sent to the host as you type, so whatever's written when time runs out is performed. Anyone who joins mid-game, and the crowd, watches and votes.
- **The battle**: rappers perform one at a time in seat order (P1 → P8) over a random **90 BPM** track (never the same one twice in a row): the same "Get ready" card and 8-beat countdown over the 4 intro bars as Freestyle, then **8 bars, a line every 2 bars**: line _k_ appears exactly on the downbeat of performance bar 2_k_ − 1, big in the middle of the brick wall with the rhyme words in gold, earlier lines dimmed above it. The track fades out after bar 4 + 8 and a golf clap marks the end of each performance.
- **Robot voice**: if the rapper picked TTS, every screen in the room reads each line out as its bar starts, using the browser's built-in speech (`speechSynthesis`, the Web Speech API; it isn't routed through Web Audio, so it plays alongside the beat, which drops to 30% from the first line until the last one finishes). Each rapper picks **I'll rap it myself**, **Robot MC (Male)** or **Robot MC (Female)** on the writing screen (the default alternates by seat: P1 male, P2 female, …), and the host picks a random accent for each performance: UK or American. Each browser picks its closest voice for that gender and accent (on a Mac: Daniel / Martha for UK, Aaron / Samantha for American; Microsoft and Google voices on Windows and Chrome), falling back to another English accent if it has none, and starts each line on its bar (`?ttslead=ms` starts them early, to test for speech start-up lag), and speeds up long lines (rate 1.05 up to 1.5) so a line fits its 2 bars. Voices vary by device and browser; without speech support the lines still appear on time.
- **Voting**: straight after each performance (and its mic drop) everyone else (the other rappers and the crowd) rates it from half a star to 5 (tap the left half of a star for a half), with the rapper's 4 lines on the card to re-read. When everyone's voted (or after 20 seconds) the next rapper is up. After the round's last performance the **scoreboard** shows the stars each rapper got this round and their running total. Each rapper presses **Play next round**: once they all have, the next round (fresh rhymes) starts straight away; otherwise after 30 seconds whoever opted in plays on and the rest sit out and watch (nobody opted in: straight to the podium). After **round 3** the podium shows total stars and "_Name_ takes the mic!" (ties share it).

### Freestyle

- **A round**: the host starts. Rappers go in order P1 → P8. Each turn plays a backing track picked at random by the host (never the same one twice in a row, and everyone hears the same one): a "Get ready _name_" card over intro bars 1–2, an 8-beat countdown (8 … 1) over intro bars 3–4, then the drums drop for the 16 rap bars. A golf clap (`public/sfx/golf-clap.mp3`) marks the end of the round, and the tail of the track rings out under the vote.
- **The bars**: a karaoke-style list. The current bar sits at the top; the next ones wait below and slide up as each bar finishes, while the finished bar floats up and fades away. Each bar has 4 cells, one per beat: beats 1–3 are free, beat 4 shows the **rhyme word** to land right on the beat. Cells turn green as the beat passes. Bars come in couplets: each couplet uses one rhyming pair (word A, then word B) and gets its own colour (blue, amber, magenta, teal, red, gold, violet, cyan; green is saved for the ball and finished beats). That's 8 pairs per turn, never repeated within a game.
- **Bouncing ball** (green): lands on each cell exactly on the beat, in arcs with a motion streak, driven by the audio clock.
- **Voting**: after each turn everyone except the rapper (other rappers and the crowd) rates it 1–5 stars. When everyone's voted (or after 20 seconds) the rapper's average shows, then the next rapper's up. After the last turn: a podium of average stars and "_Name_ takes the mic!" (ties share it). The host can play again, or everyone heads back to the lobby.
- **Solo practice**: from the home screen, rap 16 bars (Freestyle) over a random track with the ball and prompts, no room or votes.

### Everything else

- **Intro**: every game opens with a "How to play" screen for its mode: a short beat (`sfx/intro-beat.mp3`) loops under a louder voiceover reading the rules (`sfx/intro-write-bars.mp3` or `sfx/intro-freestyle.mp3`), while the rules appear as bullet points as they're spoken and a bar counts down (16 s for Write Bars, 19.5 s for Freestyle). Everyone sees it at the same time; late joiners pick it up part-way through. The host can **Skip intro**. The beat follows the music toggle, the voice the sound-effects one. `?debug&nointro` starts without it.
- **End of a turn**: the golf clap (`sfx/golf-clap.mp3`), then 2.5 seconds later a round-end voiceover (`sfx/round-end-01.mp3` to `-06.mp3`, cycling 1 to 6; the host picks it so the whole room hears the same one), with the clap dipping to 25% under it. They ring on into the next turn and stop when you leave the game.
- **Mic drop**: when a rapper finishes (16 bars in Freestyle, 4 lines in Write Bars), a 7-second takeover darkens the screen while mics rain down and "Mic drop!" jumps in with the rapper's avatar. In Write Bars it also calls out the prompt words: "All 4 rhymes landed!" if every one was used (anywhere, whole words or plurals), otherwise a tally with each word ticked or crossed. Then the vote opens.
- **Avatars**: every rapper gets a DiceBear Initial Face in a disc of their colour next to their name (lobby, top bar, Get ready card, scores, podium). It spins in at the start of a turn and takes a bow at the end.
- **Ad-lib**: about every 3rd turn (never two running, always by the 4th; the host decides so the whole room hears it) an ad-lib plays on the beat, alternating "faaah" and "damn" ([`public/sfx/`](public/sfx/)): its hit lands on the downbeat of bar 13 in Freestyle, and on the last beat of bar 6 (just before the last line) in Write Bars. `?debug&adlib` plays one on every turn (`?debug&adlib=damn` for just that one).
- **Tracks** (in [`public/tracks/`](public/tracks/)): Brooklyn Old School, Harlem Boom Bap, Detroit Horrorcore, Long Beach G-Funk, The Bronx Jazz Hop, Memphis Dirty South, Nashville Bro Country and Havana Reggaeton, all at 90 BPM (the tempo isn't shown in the game). If a track can't be loaded, a synthesized fallback beat at the same tempo plays instead ([`public/js/beats.js`](public/js/beats.js)).
- **Rooms, links and hosting**: exactly like the other mates games. Create a room and share the 4-letter code or link; link rooms like **/rapmates/mate** are hosted by the first visitor and handed to the next person if the host leaves (rappers in slot order, then the crowd); `?group=<id>` gives an embedding app its own room. Home button in game, music and sound-effect toggles (remembered on your device).

## How it works

There is no game server. Rapmates is peer-to-peer, so it runs on any static host, including GitHub Pages.

- The **host's browser** runs the room ([`public/js/engine.js`](public/js/engine.js)): who's in the room, the mode, turn order, the rhyme pairs, the write clock, voting and results. Others only send the mode and "start" (host), their lines (Write Bars) and their votes. The host trims and limits every line; every screen escapes them when it shows them.
- Players connect over WebRTC with [PeerJS](https://peerjs.com/) ([`public/js/net.js`](public/js/net.js)); add a TURN relay in [`public/js/config.js`](public/js/config.js) for networks that can't connect directly.
- **Staying in time**: the host never streams audio. Each turn is a schedule in the host's clock: the start time of the track's intro (now + 1.5 s), the track and the 8 rhyme pairs. Every browser preloads and decodes all the tracks as soon as it's in a room, keeps estimating the difference between its clock and the host's (NTP-style pings to the host, keeping the answer with the shortest round trip), converts the start time into its own `AudioContext` time and starts the track there, so bar _n_ lands at `start + (n - 1) × 4 × 60 / bpm`. The ball and the bars read the audio output clock every frame, so they're tight to what you hear. Browsers usually agree to within a few tens of milliseconds; if the clock estimate improves mid-turn the beat re-lines itself up. If a browser hasn't been allowed to play sound yet, a "Tap to turn the beat on" button appears and the beat joins in at the right point.

### Files

```
public/
  index.html        markup only
  404.html          GitHub Pages fallback: turns /rapmates/<room> links into ?room=<room>
  css/              base.css, lobby.css, stage.css, overlays.css, writebars.css (loaded in that order)
  js/               config.js, words.js, tracks.js, engine.js, net.js, beats.js, client.js
  tracks/           backing tracks (MP3)
  sfx/              sound effects (golf clap)
test/               node --test suites for the engine, tracks and words
```

The deploy stamps `?v=__BUILD__` on every CSS and JS link in `index.html` with the commit, so players get fresh files straight after a deploy.

### Tracks

Tracks are data in [`public/js/tracks.js`](public/js/tracks.js):

```js
{ id: 'harlem', name: 'Harlem Boom Bap', src: 'tracks/90BPM-Harlem-Boom-Bap.mp3', bpm: 90, offset: 0.067, skipBars: 0, introBars: 4, rapBars: 16, fadeAfterBars: 22 },
```

| Track | BPM | `offset` (bar 1, beat 1) |
|---|---|---|
| Brooklyn Old School | 90 | 0.086 s |
| Harlem Boom Bap | 90 | 0.067 s |
| Detroit Horrorcore | 90 | 0.066 s |
| Long Beach G-Funk | 90 | 0.103 s |
| The Bronx Jazz Hop | 90 | 0.066 s |
| Memphis Dirty South | 90 | 0.096 s |
| Nashville Bro Country | 90 | 0.096 s |
| Havana Reggaeton | 90 | 0.073 s |

**Adding a track**

1. Cut it to the game's structure: **a 4-bar intro, the drums in on bar 5 for 16 bars, then a short tail** (20 bars plus tail). One tempo throughout.
2. Put the MP3 in `public/tracks/`, named `<bpm>BPM-<Name>.mp3`, and add an entry to `TRACKS` (the tests check every file has an entry and vice versa).
3. Set `bpm`, and `offset`: the seconds from the start of the file to beat 1 of bar 1 (the first intro bar). Measure it on the browser's decoded audio, since that's what players hear (MP3 encoder delay is handled the same way): the offsets above were found by fitting the known-tempo beat grid to the drum hits over the whole drum section (high-passed energy onsets in 1 ms steps); every track's hits sit within about 1 ms of its grid. A good first guess: the time of the first drum hit on bar 5, minus 4 bars (4 × 4 × 60 / bpm).
4. Check it by ear with **`?debug&click`**: a metronome clicks on every beat over the track (accented on each bar's downbeat), and the track name, offset and current bar/beat show on screen. The click should sit right on the kick and snare from bar 5.

Write Bars only uses the 90 BPM tracks, and shortens each turn to 8 rap bars with the fade right after them: the engine passes `rapBars: 8` and `fadeAfterBars: introBars + 8` with the turn, and `Tracks.turnSeconds(track, rapBars)` / `Tracks.fadeAt(track, fadeAfterBars)` use them instead of the track's own values.

Optional fields for files that don't quite fit: `skipBars` starts playback that many bars into the file (e.g. a track with an 8-bar intro uses `skipBars: 4`), and `fadeAfterBars` sets when the track fades out over 3 s, counted in bars from the playback start (22 lets two bars of tail ring; use 20 for a track whose drums carry on past bar 20).

## Rhyme pairs

The 150 pairs in [`public/js/words.js`](public/js/words.js). In Freestyle, bar 1 of a couplet ends on word A, bar 2 on word B. In Write Bars each rapper gets 2 of them per round.

| # | A | B |
|---|---|---|
| 1 | knockout | lockout |
| 2 | big time | prime time |
| 3 | hustle | muscle |
| 4 | bag | swag |
| 5 | finesse | success |
| 6 | flex | next |
| 7 | lit | hit |
| 8 | trill | skill |
| 9 | no cap | thunderclap |
| 10 | cramp | champ |
| 11 | mic | strike |
| 12 | flow | show |
| 13 | crown | downtown |
| 14 | rhyme | climb |
| 15 | beat | heat |
| 16 | grind | mind |
| 17 | fresh | mesh |
| 18 | drip | ship |
| 19 | gold | bold |
| 20 | boss | sauce |
| 21 | squad | nod |
| 22 | hype | stripe |
| 23 | vibe | tribe |
| 24 | stack | track |
| 25 | cash | flash |
| 26 | game | fame |
| 27 | street | sweet |
| 28 | block | clock |
| 29 | crew | brand new |
| 30 | bounce | announce |
| 31 | real | deal |
| 32 | shine | line |
| 33 | player | mayor |
| 34 | rocket | pocket |
| 35 | wave | brave |
| 36 | king | bling |
| 37 | slick | quick |
| 38 | mixtape | escape |
| 39 | spotlight | all night |
| 40 | bars | stars |
| 41 | smooth | groove |
| 42 | fire | higher |
| 43 | sneakers | speakers |
| 44 | gravy | wavy |
| 45 | headline | deadline |
| 46 | kicks | tricks |
| 47 | ice | price |
| 48 | clutch | touch |
| 49 | rumble | humble |
| 50 | loud | crowd |
| 51 | boom | room |
| 52 | zone | throne |
| 53 | hip hop | non-stop |
| 54 | flame | name |
| 55 | bass | space |
| 56 | rap | snap |
| 57 | smash | splash |
| 58 | vision | mission |
| 59 | dream | team |
| 60 | GOAT | boat |
| 61 | money | sunny |
| 62 | hater | later |
| 63 | paper | skyscraper |
| 64 | ride | pride |
| 65 | fight | tight |
| 66 | chain | champagne |
| 67 | jewels | rules |
| 68 | vinyl | final |
| 69 | scratch | match |
| 70 | DJ | replay |
| 71 | verse | universe |
| 72 | chorus | for us |
| 73 | battle | rattle |
| 74 | cypher | lifer |
| 75 | punchline | crunch time |
| 76 | freestyle | extra mile |
| 77 | legit | commit |
| 78 | savage | average |
| 79 | icy | spicy |
| 80 | bread | ahead |
| 81 | level | rebel |
| 82 | Grammy | Miami |
| 83 | concrete | heartbeat |
| 84 | subway | runway |
| 85 | city | gritty |
| 86 | rooftop | can't stop |
| 87 | victory | history |
| 88 | glory | story |
| 89 | legacy | destiny |
| 90 | energy | enemy |
| 91 | danger | stranger |
| 92 | thunder | under |
| 93 | lightning | frightening |
| 94 | storm | uniform |
| 95 | ocean | motion |
| 96 | rhythm | with 'em |
| 97 | tempo | let go |
| 98 | jacket | racket |
| 99 | hoodie | goody |
| 100 | shades | parades |
| 101 | boots | roots |
| 102 | chef | ref |
| 103 | pizza | Mona Lisa |
| 104 | taco | macho |
| 105 | coffee | toffee |
| 106 | pancake | earthquake |
| 107 | dinosaur | encore |
| 108 | alien | Australian |
| 109 | llama | drama |
| 110 | shark | dark |
| 111 | tiger | writer |
| 112 | monkey | funky |
| 113 | kangaroo | breakthrough |
| 114 | wizard | blizzard |
| 115 | planet | granite |
| 116 | moon | soon |
| 117 | sunrise | surprise |
| 118 | weekend | deep end |
| 119 | Monday | someday |
| 120 | holiday | payday |
| 121 | homework | network |
| 122 | teacher | preacher |
| 123 | emails | details |
| 124 | Wi-Fi | sky high |
| 125 | phone | alone |
| 126 | trending | never ending |
| 127 | viral | spiral |
| 128 | remix | quick fix |
| 129 | respect | connect |
| 130 | loyal | royal |
| 131 | confidence | common sense |
| 132 | hero | zero |
| 133 | villain | chillin |
| 134 | chill | thrill |
| 135 | Ferrari | safari |
| 136 | Lambo | Rambo |
| 137 | limo | primo |
| 138 | yacht | hot spot |
| 139 | comeback | soundtrack |
| 140 | backpack | snack pack |
| 141 | basketball | wrecking ball |
| 142 | slam dunk | funk |
| 143 | hometown | touchdown |
| 144 | trophy | show me |
| 145 | medal | pedal |
| 146 | finish line | every time |
| 147 | galaxy | salary |
| 148 | penguin | winning |
| 149 | pirate | private |
| 150 | selfie | healthy |

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 (or http://localhost:3000/mate for the link room). Create a room in one window and join with the code or link from another window or device. An internet connection is still needed to reach the PeerJS service.

## Test

```bash
npm test
```

Covers the room logic (rappers vs crowd, unique names, host handover, turn order, voting rules, averages and ties), the rhyme pairs and the 16-bar couplet schedule, and Write Bars ([`test/writebars.test.js`](test/writebars.test.js)): picking the mode, the write deadline and ending early, 2 unique pairs each and no repeats across rounds, line sanitising, the 4 + 8 bar schedule and line start times, 90 BPM tracks only, star totals over 3 rounds, and late joiners or rappers leaving mid-write, mid-battle or mid-vote.

For testing in the browser, `?debug` shows the track timing (and logs when each Write Bars line appeared against its bar in `__rapmatesDebug.stage.lineLog`), and `?debug&write=10` gives a 10-second write clock (5–60; the host's URL decides).

## Deploy

Every push to `main` runs the tests and publishes the `public/` folder to GitHub Pages ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)).

## Credits

- Rapper avatars: [“Initial Face”](https://www.dicebear.com/styles/initial-face/) by [DiceBear](https://www.dicebear.com), licensed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Each rapper's face is seeded by their name (fetched from the DiceBear HTTP API), so everyone in the room sees the same one.
