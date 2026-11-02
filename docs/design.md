# Droomtelefoon — game design (adult party edition)

Date: 2026-10-20. Based on MB's *Elektronische Droomtelefoon* (1992, Dutch edition of Milton Bradley's Dream Phone, 1991).

## The original, in one paragraph

24 boys on a board, each with a hangout, sport, food and clothing. One secretly likes you. You call boys on the pink phone; each gives a **negative** clue ("Ik ben niet op het strand"), you cross off boys, and you guess by dialling the number of your suspect. Cards: *Luidspreker* (everyone hears), *Deel een geheim* (one other player hears), *Mam zegt: ophangen!* (lose a turn). Critics: too easy for adults, luck in card draws, no penalty for wrong guesses, over in 20 minutes.

## Our version in one paragraph

Two to twelve adults, ideally ten. Each player has a **co-player**: their first childhood crush (Patrick Swayze, the pink Power Ranger, Johnny Depp, Pamela Anderson...), an AI character on their side who calls with help. Each player also has **ten secret admirers**: world-famous, attractive stars from their youth, picked by Claude from the player's age, who they fall for and their three crushes. Admirers call the player on the pink Droomtelefoon and answer texts from the player's own phone. Every call and text is a dialogue full of clues. Unmask an admirer by naming them. Most points after ten rounds wins. Two to three hours.

## Devices

| Device | Page | Role |
|---|---|---|
| TV / laptop | `host.html` | **Gameboard** and **game guide**: every player's ten admirer slots, scores, round and turn, a big instruction banner telling the room what to do now, incoming-call overlay with ringtone, speakerphone transcripts, finale. |
| Tim's iPhone | `phone.html` | **The Droomtelefoon**. The only device that receives and makes calls. Caller screen with ringtone, in-call screen with voice, transcript, quick replies and a text box. Passed to whoever is called. |
| Every player's phone | `play.html` | Join, their co-player, their ten admirer slots, **text threads** with each admirer, unmask form, the three cards, transcripts of their own calls. |

## Content: the setup wizard on the TV

Setting up a game happens on the TV, in four steps:

1. Number of players, 2 to 12.
2. Their names.
3. Per player: age, gender (man, vrouw, anders), who they fall for (mannen, vrouwen, allebei) and three crushes. Crush 1 becomes their **co-player**.
4. Claude generates, for all players in parallel (4 at a time), the co-player persona and **ten admirers**: world-famous, attractive stars (actors, singers, models, athletes, TV stars) whose breakthrough or peak fell when that player was 12 to 25, of the gender they fall for, matching the taste shown by their crushes. The crushes themselves are excluded, as are two members of the same band or cast. One or two Belgian stars are allowed.

Each admirer has: `answer` (the name you'd guess), `aliases` (surname, stage name, nickname), a one-line `profile` shown after unmasking, a `persona`, four board attributes (hangout, sport, eten, kleur), a **clue ladder** of five levels (1 negative board clue, 2 era and world, 3 what they're known for without titles, 4 famous role or hit described, 5 near giveaway such as initials or a quote) and a voice.

`players.json` holds the answers, `admirers.json` the generated content keyed by player and signed with the answers, so editing the lineup only regenerates players whose answers changed. Slots are shuffled per player and numbered 1 to 10. After generation the laptop renders portraits of co-players and admirers locally (admirer files get secret names).

`spelers.xlsx` mirrors both files and is always in the project folder. Editing it (or loading another workbook from the TV, laptop only) replaces the lineup: complete admirer rows are kept, name-only rows get clues from Claude, missing rows are topped up to ten. A workbook identical to the current lineup is ignored, so two servers on one folder can't ping-pong.

## Flow of the night

1. **Lobby**. TV shows room code and QR. Players join on their phone and pick their name from the list. Their co-player greets them by voice on the Droomtelefoon as a sound check. (Built: the greeting is written by Claude, shown on the TV and spoken by the Droomtelefoon.)
2. **Rounds 1 to 10**. Ten turns per round, in the order on the TV. The TV banner guides every step: "Ronde 3 · Beurt 4 van 10 · Lotte, de Droomtelefoon gaat zo over. Hou hem vast."
3. **Finale**. Row by row the TV spotlights each player and flips the admirers they never unmasked, announced by voice. Then the podium.

## A turn (60 to 90 seconds)

1. The TV names the player. The Droomtelefoon **rings** (Nokia-style tune, synthesised) with a caller screen: "Aanbidder #7 · voor Lotte".
2. Before pick-up, other players may play a card from their phone (see Cards).
3. Lotte picks up. The admirer speaks (voice) and opens with a line that carries a clue at the current **clue level**. Lotte replies by typing, tapping one of three suggested questions (random from a neutral yes/no bank, so they never hint at the answer), or speaking if Safari offers speech recognition. Up to four exchanges; talk time 45 seconds with an admirer, 20 with the co-player (the clock stops during a task).
4. At any moment Lotte can tap **Ik weet wie je bent** and type a name (typos and phonetic spelling count; a close guess the rules can't settle goes to Claude as jury). Right: the admirer reacts, TV flashes, points. Wrong: the admirer teases, minus points, the call ends.
5. Hang up. The transcript lands on Lotte's phone.

Picking up can also happen from the player's own phone (Tim 2026-10-31): when their call rings, play.html shows a big OPNEMEN button that sends the same pickup action, and in dialing rounds it shows a 1-0 dial pad that sends the dial action; voice and microphone stay on the laptop's Droomtelefoon. Co-player (helper) calls only deliver a tip, so the call screen hides the suggested questions and the input row for them.

Odd rounds: the server picks which admirer calls (least-called first). Even rounds: the player **dials** one of their own locked numbers on the Droomtelefoon. So everyone gets both "called" and "calling".

## Earning information

Hints are never free. The admirer opens with a flirt, not a clue. Information comes from three things the player does:

1. **Ask** a real yes/no or open question about the admirer, out loud (a "ja" is worth +1, see Scoring).
2. **Answer** a counter-question the admirer asks in the conversation itself.
3. **Remember.** Admirers recall earlier calls and texts with the player and never repeat a hint.

There are no tasks any more (Tim 2026-10-31): the doe-opdracht, drawing, selfie, and finally the wedervraag and leugendetector cards were all removed, because calls are spoken and nobody should have to tap answers. The task code is still in server.js behind an empty `TASK_KINDS`.

Wrong guesses are shown on the TV with the guessed name, so the room learns from them.

## Clue level

Each admirer has a ladder of five clues. The level offered in a call is `min(5, timesCalled + roundBonus)` where the round bonus is 0 in rounds 1 to 3, 1 in rounds 4 to 6, 2 in rounds 7 to 10. Level 1 is a board clue in the original style ("Je vindt mij nooit in de snackbar"). Level 5 is unmistakable for the right player ("Ik was de enige in 6B met een beugel én een skateboard").

Texts (see below) only ever reach level `max(1, callLevel − 1)`.

## Texting (parallel play, nobody sits idle)

From their own phone a player can text any locked admirer. Three texts per round per player. The admirer answers in character within seconds, with a clue one level below what a call would give. Texting is where the social game happens: people compare threads, trade, bluff.

The **co-player** also texts the player: after a wrong guess ("Dat was 'm niet, schat. Maar #4 noemde de zwemvijver, en jij hebt daar toch gezwommen?"), at the start of rounds 4 and 7 (a nudge toward one admirer), and in the finale.

## Co-player calls

Once in rounds 2, 5 and 8 the Droomtelefoon rings with the **co-player** instead of an admirer. The celebrity gives a real hint about one locked admirer, in their own style. Everyone in the room hears who is on the line (the caller screen shows the co-player's portrait), which tells the room something about the player too.

## Card (one per player, played from their phone, single use)

- **Mam zegt: ophangen!**: the current call is cut off. The turn is lost.

Luidspreker and Deel een geheim were removed (Tim 2026-10-31): the game is played with one central screen and speaker, so everyone already hears every call.

## Pause (Tim 2026-10-31)

A Pauze button on the TV freezes the whole game. Every server timer goes through `later()`/`stop()`, so pausing clears the pending ones and resuming re-arms them with their remaining time; call end time, card window and steal window shift by the pause length. While paused, every action except resume, reset and join is refused, the Droomtelefoon shows the idle screen (nothing rings or listens) and the phones show PAUZE.

## Steelmoment (Tim 2026-10-31)

Every 10 minutes of play a 45-second steal window opens: a full-screen "STEEL AANBIDDER" pop-up on every player's phone and a toast on the TV. A player picks another player, one of their still-hidden numbers (not the one on the line right now) and types the name. One attempt per player per window, judged like a normal guess (phonetic match, then the Claude jury). Correct: +5, the admirer is revealed on the TV as "gestolen door …" and the owner's co-player sends a consolation text. Wrong: −2 and the guess shows in the feed. It rewards listening to other people's calls. `STEAL_MINUTES` overrides the interval for testing.

## Scoring

| Event | Points |
|---|---|
| Unmask on the admirer's first call | 10 |
| second call | 7 |
| third or later | 5 |
| Unmask via text | 4 |
| Yes/no question about the admirer, truthfully answered "ja" (call or text) | +1 |
| Wrong guess | −2 and the call ends |
| Steal another player's admirer (steelmoment) | +5 for the thief; the admirer is gone for the owner |
| Wrong steal | −2 |
| Game end bonus: all ten unmasked | +10 |

Yes-points: Claude judges each question in the same reply that answers it. Questions that are "ja" for almost any star ("ben je beroemd?", "vind je mij leuk?") and name questions ("ben je X?") never score. The same question to the same admirer scores once. Up to four questions per call and three texts per round, so a sharp questioner earns a few points a round on top of unmasking.

Winner: most points after round 10. Tie: fewer wrong guesses.

## Voices and audio

- Admirer and co-player voice on the Droomtelefoon: browser `speechSynthesis`, Dutch voices built into iOS (Ellen nl-BE, Xander nl-NL, Claire nl-NL), per-character pitch and rate. Instant, no network.
- Built 2026-10-26: a **voice engine picker** on the Droomtelefoon (badge top right, saved on the phone) with four modes. `iPhone` = the speechSynthesis above. `Piper`, `Qwen`, `OmniVoice` = the Mac renders the line in `voice_server.py` (port 8792, proxied by `server.js` at `/tts`) and the phone plays the WAV; the badge shows fetch-to-play and pure synthesis time. Start it with the `voice-server` launch config or `.venv-voice/bin/python voice_server.py piper qwen omnivoice` (engine names preload, otherwise the first line pays the model load: Qwen 30 s, OmniVoice 10 s).
  - Piper (CPU, ~0.1 s per line): slot 0 per gender is the Flemish voice (nl_BE Nathalie / RDH), the other slots are the 52 nl_NL MLS speakers split by measured pitch (`voices/mls-genders.json`). Voices live in `voices/piper/`.
  - Qwen3-TTS 0.6B 8-bit via mlx-audio (~1.8 s per line): preset speakers Vivian/Serena and Ryan/Aiden/Dylan/Eric/Uncle_Fu. No official Dutch, so expect an accent.
  - OmniVoice via mlx-audio (~2.5 s per line): voice design per slot (gender, pitch, age), seeded per character so it keeps its voice.
  - Streaming (2026-10-30): `/tts` streams raw 16-bit PCM while the engine renders (Piper per sentence, Qwen natively every ~0.3 s, OmniVoice per sentence with sentence 2+ cloning sentence 1 so the voice stays the same). The phone schedules the chunks back to back on its Web Audio clock. Measured time to first sound on the phone: Piper ~60 ms, Qwen ~160 ms, OmniVoice ~1.5 s; `&format=wav` still returns one file for curl.
- Rejected for lack of Dutch: Phonon (Ollama), Kokoro-82M, Chatterbox-Flash, Magpie. ElevenLabs Flash remains the paid option.
- The TV keeps ringing until someone picks up.
- Ringtone and SMS tone: synthesised with the Web Audio API on the Droomtelefoon (Nokia "Grande Valse" fragment for calls, two-note chime for texts). TV plays a softer ring too.
- Speech input: `webkitSpeechRecognition` (nl-BE). **Hands-free admirer calls (2026-10-30):** in an admirer call the phone listens after every line, shows what it hears in the text box, sends it when the player stops talking, and keeps the mic shut while the admirer speaks, while a reply is pending, while a task is open, and in co-player calls (helpers may stay scripted or typed). Toggle "🎙 auto" in the badge; the mic button still works for manual use.
- **HTTPS is required for the microphone.** Safari refuses speech recognition on plain http, so `server.js` also serves the app on https://<mac>:3443 with a mkcert certificate (`certs/`, remade by `start.sh` when the Mac's LAN address changes). One-time on the iPhone: open http://<mac>:3000/ca.pem in Safari, allow the profile, install it under Settings > General > VPN & Device Management, then enable it under Settings > General > About > Certificate Trust Settings. Then open the https phone link. Rejected mic error shows "Microfoon geweigerd: open de https-link" in the text box.

## Avatars

One house style for every face: neon pop-art duotone (hot pink and cyan on black), rendered locally with mflux. Co-players are on the board from the start. Admirers show a numbered neon silhouette on a white photo card until unmasked, then the card flips to their portrait and name.

## Look and feel

The 1992 box: black ground, neon pink, magenta, cyan, lime and yellow, hand-script "Elektronische", chunky condensed caps, the pink phone. Blended with candy bubblegum: glossy rounded pills, bubble highlights, pastel pink and mint on the player phones. All copy in Dutch.

## Non-goals

- Accounts or persistence across nights. One room per server.
- Realtime voice-to-voice. Typed or tapped input is fine at a party.

## Timing

10 rounds × 10 turns × ~80 s ≈ 2 h 15, plus lobby and finale ≈ 2 h 40. `ROUNDS` is a constant in the server: 8 rounds for a 2 hour night.
