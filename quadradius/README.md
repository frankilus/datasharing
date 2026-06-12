# Quadradius-style Tactical Tile Game

A faithful, from-scratch recreation of the classic *Quadradius* style of
turn-based tile combat, built as a zero-dependency HTML5 Canvas game with
original, procedurally drawn HD graphics (no image assets, no libraries,
no build step).

## Run it

Open `index.html` in any modern browser, or serve the folder:

```bash
cd quadradius
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Features

- 10×8 industrial battlefield with full tile **elevation** mechanics:
  trenches, plateaus, walls, acid corrosion, and bottomless holes
- 20 glossy mechanical pieces per side; capture by landing on enemies
- **Power Orbs** spawn on a visible LED schedule; collecting one grants a
  random power
- **48 powers** — 12 scoped effects in ROW / COLUMN / RADIAL variants
  (Trench, Plateau, Invert, Flatten, Acidic, Tripwire, Inhibit, Spyware,
  Purify, Learn, Bankrupt, Wall) plus 12 unique powers (Teleport, Multiply,
  Smart Bomb, Kamikaze, Jump Proof, Climb, Orbic Rehash, Grow Quadradius,
  Switcheroo, Relocate, Raise Tile)
- Play vs the **CPU opponent ("turbo")** or local **hotseat** 2-player
- Optional **30-seconds-per-move timer** with LED countdown
- Full control panel: odometer piece counters, red dot-matrix power screen,
  orb-spawn indicator, move log with rotating tips, in-game chat
  (type anywhere + ENTER), menu, and resign button
- Procedural WebAudio sound effects
- `directions.html` — complete how-to-play guide and powerup chart

## Structure

| File | Purpose |
|---|---|
| `index.html` | page layout: board canvas + control panel |
| `css/style.css` | industrial control-panel styling |
| `js/powers.js` | all power definitions and scope logic |
| `js/game.js` | rules engine and game state |
| `js/ai.js` | heuristic CPU opponent |
| `js/render.js` | procedural HD canvas renderer |
| `js/ui.js` | input, panel widgets, timer, chat, menus, audio |

All artwork, code and text are original work inspired by the gameplay of
Quadradius (2007); no assets or code from the original game are used.
