/* ============================================================
   UI — input handling, control panel, turn flow, timer, chat,
   menu, and WebAudio sound effects.
   ============================================================ */

(function () {
  "use strict";

  const { POWERS } = window.QPOWERS;
  const Render = window.QRender;
  const AI = window.QAI;

  const $ = id => document.getElementById(id);

  const UI = {
    G: null,
    mode: "cpu",          // "cpu" | "hotseat"
    timed: true,
    timerSecs: 30,
    timerLeft: 30,
    timerHandle: null,
    selectedPiece: null,
    armedPower: null,      // index into piece.powers, for targeted powers
    busy: false,           // input lock during AI turn / game over
    tipShown: 0,
    dragCand: null,        // {piece, sx, sy, moved} mousedown-on-piece state
    skipAnimFor: null,     // piece id whose next move event shouldn't animate
  };

  const TIPS = [
    "Tip #1: The red LED's above, next to Rounds, represent how many rounds until new Power Orbs will spawn.",
    "Tip #2: You can only climb one level per move — but you can drop down any height. Mind the trenches.",
    "Tip #3: Using a power takes your whole turn, so spend them when they count.",
    "Tip #4: Pieces holding powers show small amber pips above their ring.",
    "Tip #5: If you click on a Power listed in the menu above, all of the pieces that contain that specific Power will be highlighted. You can then activate that power by just clicking on the piece.",
  ];

  /* ---------------- sound ---------------- */

  let actx = null;
  function beep(freq, dur, type, vol) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      g.gain.value = vol || 0.04;
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* audio unavailable */ }
  }
  const sfx = {
    select: () => beep(660, 0.07, "square"),
    move: () => beep(220, 0.09, "triangle", 0.06),
    capture: () => { beep(140, 0.25, "sawtooth", 0.08); beep(90, 0.3, "square", 0.06); },
    orb: () => { beep(880, 0.1, "sine", 0.06); setTimeout(() => beep(1320, 0.12, "sine", 0.05), 90); },
    power: () => { beep(520, 0.12, "sawtooth", 0.05); setTimeout(() => beep(760, 0.15, "sawtooth", 0.04), 100); },
    boom: () => beep(60, 0.5, "sawtooth", 0.12),
    denied: () => beep(160, 0.15, "square", 0.05),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.18, "triangle", 0.06), i * 140)),
  };

  /* ---------------- LED widgets ---------------- */

  function buildLedBar(el, n) {
    el.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.className = "led-cell";
      el.appendChild(d);
    }
  }

  function setLedBar(el, lit) {
    [...el.children].forEach((d, i) => d.classList.toggle("on", i < lit));
  }

  function setOdometer(el, n) {
    const str = String(n).padStart(3, "0");
    [...el.children].forEach((s, i) => s.textContent = str[i]);
  }

  /* ---------------- panel updates ---------------- */

  function refreshPanel() {
    const G = UI.G;
    setOdometer($("count0"), G.livePieces(0).length);
    setOdometer($("count1"), G.livePieces(1).length);
    $("movesPlayed").textContent = G.movesPlayed;
    setLedBar($("ledRounds"), G.orbRoundsLeft);
    setLedBar($("ledAmount"), Math.min(8, G.orbAmount + G.orbAmountBonus));
    document.querySelectorAll(".player-row")[0].classList.toggle("active", G.turn === 1);
    document.querySelectorAll(".player-row")[1].classList.toggle("active", G.turn === 0);
  }

  function ledShow(title, body, footer) {
    $("ledTitle").textContent = title;
    $("ledBody").innerHTML = "";
    if (typeof body === "string") $("ledBody").textContent = body;
    else $("ledBody").appendChild(body);
    $("ledFooter").textContent = footer || "";
  }

  function showInventory(piece, readOnly) {
    const G = UI.G;
    const wrap = document.createElement("div");
    if (!piece.powers.length) {
      wrap.textContent = readOnly
        ? "This bugged piece is carrying no powers."
        : "This piece holds no powers. Land on a Power Orb to collect one.";
    } else {
      const counts = {};
      piece.powers.forEach((k, i) => {
        (counts[k] = counts[k] || []).push(i);
      });
      for (const k of Object.keys(counts)) {
        const div = document.createElement("div");
        div.className = "pow-item";
        div.textContent = counts[k].length + " " + POWERS[k].name;
        if (!readOnly) {
          const def = POWERS[k];
          const noTargets = def.canUse && !def.canUse(G, piece);
          if (piece.inhibited > 0 || noTargets) {
            div.classList.add("disabled");
            div.onclick = (e) => { e.stopPropagation(); sfx.denied(); };
          } else {
            div.onclick = (e) => { e.stopPropagation(); activatePower(piece, counts[k][0], div); };
          }
          div.onmouseenter = () => {
            $("ledFooter").textContent = noTargets
              ? "no valid targets in range" : def.desc;
          };
          div.onmouseleave = () => { $("ledFooter").textContent = ""; };
        }
        wrap.appendChild(div);
      }
    }
    let title = "POWERS";
    if (readOnly) title = "SPYWARE FEED";
    else if (piece.inhibited > 0) title = "POWERS [JAMMED " + piece.inhibited + "]";
    ledShow(title, wrap, readOnly ? "intel via spyware bug" : "click a power to activate");
  }

  function showPowerInfo(key, gained) {
    const def = POWERS[key];
    ledShow(def.name, def.desc, gained ? "* new power collected *" : "");
  }

  function logLine(msg, cls) {
    const div = document.createElement("div");
    div.className = cls || "sys-line";
    div.textContent = msg;
    $("logArea").appendChild(div);
    // keep the log bounded
    while ($("logArea").children.length > 80) $("logArea").firstChild.remove();
    $("logArea").scrollTop = $("logArea").scrollHeight;
  }

  function maybeTip() {
    if (UI.tipShown < TIPS.length && UI.G.movesPlayed > 0 && UI.G.movesPlayed % 14 === 0) {
      const div = document.createElement("div");
      div.className = "tip-line";
      div.textContent = TIPS[UI.tipShown++];
      $("logArea").appendChild(div);
      $("logArea").scrollTop = $("logArea").scrollHeight;
    }
  }

  /* ---------------- game events ---------------- */

  function pumpEvents() {
    const G = UI.G;
    for (const ev of G.drainEvents()) {
      switch (ev.type) {
        case "log":
          logLine(ev.msg, ev.cls);
          break;
        case "move":
          sfx.move();
          // slide the piece unless the player carried it there by hand
          if (UI.skipAnimFor === ev.piece) UI.skipAnimFor = null;
          else Render.animateMove(ev.piece, ev.from, ev.to);
          break;
        case "capture":
          sfx.capture();
          Render.addFx("capture", ev.at[0], ev.at[1]);
          break;
        case "power":
          sfx.power();
          Render.addFx("power", ev.at[0], ev.at[1]);
          break;
        case "divide":
          sfx.orb();
          Render.animateDivide(ev.child, ev.from, ev.to);
          Render.addFx("power", ev.to[0], ev.to[1]);
          break;
        case "orbPickup":
          sfx.orb();
          // only reveal the power to the collector (vs CPU: only human)
          if (ev.owner === 0 || UI.mode === "hotseat") showPowerInfo(ev.key, true);
          logLine(G.names[ev.owner] + " collected a Power Orb.", "sys-line");
          break;
        case "orbDrop":
          Render.addFx("orb", ev.at[0], ev.at[1]);
          break;
        case "pieceDestroyed":
          sfx.boom();
          Render.addFx("explosion", ev.at[0], ev.at[1]);
          break;
        case "tileDestroyed":
          Render.addFx("explosion", ev.at[0], ev.at[1]);
          break;
        case "gameover":
          onGameOver(ev);
          break;
      }
    }
    refreshPanel();
    maybeTip();
  }

  function onGameOver(ev) {
    UI.busy = true;
    stopTimer();
    const humanWon = (UI.mode === "cpu") ? ev.winner === 0 : null;
    let text;
    if (UI.mode === "cpu") {
      text = humanWon ? "You Won!" : "You Lost!";
      if (humanWon) sfx.win();
    } else {
      text = UI.G.names[ev.winner] + " Wins!";
      sfx.win();
    }
    logLine("   " + text, "move-line");
    $("gameOverText").textContent = text;
    setTimeout(() => $("gameOverOverlay").classList.remove("hidden"), 900);
  }

  /* ---------------- selection & powers ---------------- */

  function clearSelection() {
    UI.selectedPiece = null;
    UI.armedPower = null;
    Render.state.selected = null;
    Render.state.legal = [];
    Render.state.targeting = false;
    Render.state.targetTiles = [];
  }

  function selectPiece(piece) {
    UI.selectedPiece = piece;
    UI.armedPower = null;
    Render.state.selected = piece.id;
    Render.state.legal = UI.G.legalMoves(piece);
    Render.state.targeting = false;
    sfx.select();
    showInventory(piece, false);
  }

  function activatePower(piece, idx, el) {
    const G = UI.G;
    const def = POWERS[piece.powers[idx]];
    if (def.targeted) {
      // arm and wait for a destination click
      UI.armedPower = idx;
      Render.state.targeting = true;
      Render.state.targetTiles = [];
      for (let c = 0; c < G.COLS; c++)
        for (let r = 0; r < G.ROWS; r++)
          if (!def.validTarget || def.validTarget(G, piece, c, r))
            Render.state.targetTiles.push([c, r]);
      if (el) el.classList.add("armed");
      $("ledFooter").textContent = "click a destination tile...";
      return;
    }
    if (G.doPower(piece, idx)) {
      clearSelection();
      pumpEvents();
      endHumanTurn();
    } else {
      sfx.denied();
    }
  }

  /* ---------------- board input ---------------- */

  const boardEl = document.getElementById("board");

  function boardPos(e) {
    const rect = boardEl.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  boardEl.addEventListener("mousedown", (e) => {
    if (UI.busy || !UI.G || UI.G.winner !== null) return;
    const G = UI.G;
    const [bx, by] = boardPos(e);
    const hit = Render.pickTile(bx, by);
    if (!hit) { clearSelection(); return; }
    const [c, r] = hit;
    const piece = G.pieceAt(c, r);
    const me = G.turn;

    // targeted power destination?
    if (UI.selectedPiece && UI.armedPower !== null) {
      if (G.doPower(UI.selectedPiece, UI.armedPower, [c, r])) {
        clearSelection();
        pumpEvents();
        endHumanTurn();
      } else {
        sfx.denied();
        clearSelection();
      }
      return;
    }

    // click-to-move onto a highlighted tile?
    if (UI.selectedPiece &&
        Render.state.legal.some(([lc, lr]) => lc === c && lr === r)) {
      if (G.doMove(UI.selectedPiece, c, r)) {
        clearSelection();
        pumpEvents();
        endHumanTurn();
      }
      return;
    }

    // select own piece — and arm it for drag-carrying
    if (piece && piece.owner === me && (UI.mode === "hotseat" || me === 0)) {
      selectPiece(piece);
      UI.dragCand = { piece, sx: bx, sy: by, moved: false };
      return;
    }

    // inspect bugged enemy piece
    if (piece && piece.owner !== me && piece.buggedBy[me]) {
      showInventory(piece, true);
      clearSelection();
      return;
    }

    clearSelection();
  });

  boardEl.addEventListener("mousemove", (e) => {
    if (!UI.dragCand) return;
    const [bx, by] = boardPos(e);
    const d = UI.dragCand;
    if (!d.moved && Math.hypot(bx - d.sx, by - d.sy) > 6) d.moved = true;
    if (d.moved) Render.state.drag = { id: d.piece.id, x: bx, y: by };
  });

  window.addEventListener("mouseup", (e) => {
    const d = UI.dragCand;
    UI.dragCand = null;
    if (!d) return;
    Render.state.drag = null;
    if (!d.moved) return;                    // plain click: selection stands
    if (UI.busy || !UI.G || UI.G.winner !== null) return;
    const G = UI.G;
    const [bx, by] = boardPos(e);
    const hit = Render.pickTile(bx, by);
    if (hit &&
        Render.state.legal.some(([lc, lr]) => lc === hit[0] && lr === hit[1])) {
      UI.skipAnimFor = d.piece.id;           // it's already under the cursor
      if (G.doMove(d.piece, hit[0], hit[1])) {
        clearSelection();
        pumpEvents();
        endHumanTurn();
        return;
      }
      UI.skipAnimFor = null;
    }
    // invalid drop: the piece snaps home, selection stays for a retry
    sfx.denied();
  });

  /* ---------------- turn flow ---------------- */

  function endHumanTurn() {
    const G = UI.G;
    if (G.winner !== null) return;
    startTimer();
    if (UI.mode === "hotseat") {
      Render.state.viewer = G.turn;
      return;
    }
    // CPU turn (player 1)
    if (G.turn === 1) {
      UI.busy = true;
      setTimeout(() => {
        AI.takeTurn(G, 1);
        pumpEvents();
        UI.busy = false;
        startTimer();
        if (Math.random() < 0.08 && G.winner === null) {
          logLine(G.names[1] + ": " + AI.taunt(), "chat-line");
        }
      }, 550 + Math.random() * 650);
    }
  }

  /* ---------------- move timer ---------------- */

  function buildTimerLeds() { buildLedBar($("timerLeds"), 10); }

  function startTimer() {
    stopTimer();
    if (!UI.timed || !UI.G || UI.G.winner !== null) {
      setLedBar($("timerLeds"), 0);
      return;
    }
    UI.timerLeft = UI.timerSecs;
    setLedBar($("timerLeds"), 10);
    UI.timerHandle = setInterval(() => {
      UI.timerLeft--;
      setLedBar($("timerLeds"), Math.ceil((UI.timerLeft / UI.timerSecs) * 10));
      if (UI.timerLeft <= 0) onTimerExpired();
    }, 1000);
  }

  function stopTimer() {
    if (UI.timerHandle) { clearInterval(UI.timerHandle); UI.timerHandle = null; }
  }

  function onTimerExpired() {
    stopTimer();
    const G = UI.G;
    if (G.winner !== null) return;
    // auto-play a random legal move for whoever stalled
    logLine("Time expired — auto move for " + G.names[G.turn] + ".", "sys-line");
    const movers = G.livePieces(G.turn).filter(p => G.legalMoves(p).length);
    if (movers.length) {
      const p = movers[(Math.random() * movers.length) | 0];
      const ms = G.legalMoves(p);
      G.doMove(p, ...ms[(Math.random() * ms.length) | 0]);
    }
    clearSelection();
    pumpEvents();
    endHumanTurn();
  }

  /* ---------------- chat ---------------- */

  document.addEventListener("keydown", (e) => {
    const bar = $("chatBar"), input = $("chatInput");
    if (e.key === "Escape") {
      bar.classList.add("hidden");
      clearSelection();
      return;
    }
    if (document.activeElement === input) {
      if (e.key === "Enter") {
        const msg = input.value.trim();
        if (msg) {
          logLine(UI.G.names[UI.mode === "hotseat" ? UI.G.turn : 0] + ": " + msg, "chat-line");
          if (UI.mode === "cpu" && Math.random() < 0.7) {
            setTimeout(() => logLine(UI.G.names[1] + ": " + AI.taunt(), "chat-line"),
                       700 + Math.random() * 1200);
          }
        }
        input.value = "";
        bar.classList.add("hidden");
      }
      return;
    }
    // any printable key opens the chat bar (like the original)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      bar.classList.remove("hidden");
      input.focus();
      input.value = e.key;
      e.preventDefault();
    } else if (e.key === "Enter") {
      bar.classList.remove("hidden");
      input.focus();
    }
  });

  /* ---------------- menu / buttons ---------------- */

  $("menuBtn").onclick = () => $("menuOverlay").classList.remove("hidden");
  $("closeMenuBtn").onclick = () => $("menuOverlay").classList.add("hidden");
  $("playAgainBtn").onclick = () => { $("menuOverlay").classList.add("hidden"); newGame(); };
  $("goPlayAgainBtn").onclick = () => { $("gameOverOverlay").classList.add("hidden"); newGame(); };
  $("quitBtn").onclick = () => { $("menuOverlay").classList.add("hidden"); newGame(); };

  $("newOppBtn").onclick = () => {
    UI.mode = UI.mode === "cpu" ? "hotseat" : "cpu";
    $("newOppBtn").innerHTML = UI.mode === "cpu" ? "OPPONENT:<br>CPU" : "OPPONENT:<br>HOTSEAT";
    $("menuOverlay").classList.add("hidden");
    newGame();
  };

  $("timerBtn").onclick = () => {
    UI.timed = !UI.timed;
    $("timerBtn").innerHTML = "TIMER:<br>" + (UI.timed ? "ON" : "OFF");
    $("matchTag").innerHTML = UI.timed ? "TIMED MATCH:<br>30 SECONDS/MOVE" : "UNTIMED<br>MATCH";
    startTimer();
  };

  $("resignBtn").onclick = () => {
    if (!UI.G || UI.G.winner !== null) return;
    const who = UI.mode === "hotseat" ? UI.G.turn : 0;
    UI.G.resign(who);
    pumpEvents();
  };

  /* ---------------- new game ---------------- */

  function newGame() {
    stopTimer();
    const names = UI.mode === "cpu" ? ["frank GUEST", "turbo"] : ["player RED", "player TEAL"];
    UI.G = new window.QGame(names);
    UI.busy = false;
    UI.tipShown = 0;
    clearSelection();
    Render.setGame(UI.G);
    Render.state.viewer = 0;

    $("name0").textContent = names[0];
    $("name1").textContent = names[1];
    $("logArea").innerHTML = "";
    $("gameOverOverlay").classList.add("hidden");
    ledShow("QUADRADIUS",
      "Eliminate the enemy squadron by landing on their pieces. Land on a " +
      "Power Orb to collect a random power. Select one of your pieces to " +
      "view and activate its powers.", "");
    logLine("New match started. Good luck!", "sys-line");
    logLine(TIPS[0], "tip-line");
    UI.tipShown = 1;

    buildLedBar($("ledRounds"), 8);
    buildLedBar($("ledAmount"), 8);
    buildTimerLeds();
    refreshPanel();
    startTimer();
    showSquadronIntro();
  }

  function showSquadronIntro() {
    const plate = $("squadronPlate");
    // center the plate over the human's squadron (bottom rows)
    const cx = Render.state.ox + (Render.state.tileSize * UI.G.COLS) / 2;
    const cy = Render.state.oy + Render.state.tileSize * (UI.G.ROWS - 2.6);
    plate.style.left = cx + "px";
    plate.style.top = cy + "px";
    plate.classList.remove("hidden");
    plate.style.opacity = 1;
    setTimeout(() => { plate.style.opacity = 0; }, 2200);
    setTimeout(() => plate.classList.add("hidden"), 3000);
  }

  /* ---------------- boot ---------------- */

  window.addEventListener("load", () => {
    $("newOppBtn").innerHTML = "OPPONENT:<br>CPU";
    Render.resize();
    newGame();
  });
})();
