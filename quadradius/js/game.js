/* ============================================================
   GAME — rules engine and state.
   Player 0 = red (bottom, human). Player 1 = teal (top).
   A turn = move one piece one square, OR activate one power.
   ============================================================ */

(function () {
  "use strict";

  const { POWERS, randomPowerKey } = window.QPOWERS;

  const COLS = 10, ROWS = 8;
  const MIN_ELEV = -1, MAX_ELEV = 2;
  const ACID_ROUNDS = 3;   // rounds an acidic tile survives before dissolving

  class Game {
    constructor(names) {
      this.COLS = COLS;
      this.ROWS = ROWS;
      this.MIN_ELEV = MIN_ELEV;
      this.MAX_ELEV = MAX_ELEV;
      this.names = names || ["you", "turbo"];

      // tiles
      this.tiles = [];
      for (let c = 0; c < COLS; c++) {
        this.tiles[c] = [];
        for (let r = 0; r < ROWS; r++) {
          this.tiles[c][r] = {
            elev: 0,
            hole: false,
            acidic: false,
            acidLife: 0,
            orb: false,
          };
        }
      }

      // pieces: 2 rows of 10 per player
      this.pieces = [];
      this.nextPieceId = 1;
      for (let c = 0; c < COLS; c++) {
        this.spawnPiece(1, c, 0);
        this.spawnPiece(1, c, 1);
        this.spawnPiece(0, c, ROWS - 2);
        this.spawnPiece(0, c, ROWS - 1);
      }

      this.turn = 0;              // whose turn (0 = red/human)
      this.movesPlayed = 0;
      this.winner = null;
      this.resigned = null;

      // orb spawn schedule
      this.orbRoundsLeft = 3;     // rounds until next drop
      this.orbInterval = 5;
      this.orbAmount = 1;
      this.orbAmountBonus = 0;
      this.orbDropCount = 0;

      this.events = [];           // render/UI event queue
    }

    /* ---------------- basics ---------------- */

    tile(c, r) { return this.tiles[c][r]; }

    inBounds(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }

    pieceAt(c, r) {
      return this.pieces.find(p => p.alive && p.col === c && p.row === r) || null;
    }

    livePieces(owner) {
      return this.pieces.filter(p => p.alive && p.owner === owner);
    }

    spawnPiece(owner, col, row) {
      const p = {
        id: this.nextPieceId++,
        owner, col, row,
        powers: [],
        buggedBy: {},     // {opponentIndex: true}
        inhibited: 0,
        mined: false,      // strapped mine: detonates if the piece moves
        climb: false,
        jumpProof: 0,      // rounds of protection remaining
        alive: true,
      };
      this.pieces.push(p);
      return p;
    }

    // direct placement used by transport powers; landing effects are
    // resolved afterwards in afterAction()
    movePieceTo(piece, c, r) {
      this.emit("move", { piece: piece.id, from: [piece.col, piece.row], to: [c, r] });
      piece.col = c;
      piece.row = r;
    }

    emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }

    log(msg, cls) { this.emit("log", { msg, cls: cls || "sys-line" }); }

    setElev(c, r, v) {
      const t = this.tile(c, r);
      if (t.hole) return;
      t.elev = Math.max(MIN_ELEV, Math.min(MAX_ELEV, v));
    }

    changeElev(c, r, d) { this.setElev(c, r, this.tile(c, r).elev + d); }

    /* ---------------- movement ---------------- */

    canEnter(piece, c, r) {
      if (!this.inBounds(c, r)) return false;
      const t = this.tile(c, r);
      if (t.hole) return false;
      const occ = this.pieceAt(c, r);
      if (occ) {
        if (occ.owner === piece.owner) return false;
        if (occ.jumpProof) return false;
      }
      // elevation: may climb at most 1 level, drop any amount
      const from = this.tile(piece.col, piece.row);
      if (!piece.climb && t.elev - from.elev > 1) return false;
      return true;
    }

    legalMoves(piece) {
      const out = [];
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const c = piece.col + dc, r = piece.row + dr;
        if (this.canEnter(piece, c, r)) out.push([c, r]);
      }
      return out;
    }

    hasAnyAction(owner) {
      for (const p of this.livePieces(owner)) {
        if (this.legalMoves(p).length) return true;
        if (p.inhibited === 0 && p.powers.length) return true;
      }
      return false;
    }

    // executes a move for the current player; returns false if illegal
    doMove(piece, c, r) {
      if (this.winner !== null) return false;
      if (piece.owner !== this.turn || !piece.alive) return false;
      const dc = Math.abs(c - piece.col), dr = Math.abs(r - piece.row);
      if (dc + dr !== 1) return false;
      if (!this.canEnter(piece, c, r)) return false;

      const victim = this.pieceAt(c, r);
      this.emit("move", { piece: piece.id, from: [piece.col, piece.row], to: [c, r] });
      piece.col = c; piece.row = r;

      if (victim) {
        this.destroyPiece(victim, "crushed");
        this.emit("capture", { at: [c, r] });
      }

      // strapped mine: moving detonates it
      if (piece.mined) {
        piece.mined = false;
        this.destroyPiece(piece, "mine");
        this.log("A strapped mine detonated — " + this.names[piece.owner] +
                 "'s piece was destroyed!");
      }

      this.afterAction(piece, null);
      return true;
    }

    // activates a power; returns false if illegal
    doPower(piece, powerIdx, target) {
      if (this.winner !== null) return false;
      if (piece.owner !== this.turn || !piece.alive) return false;
      if (piece.inhibited > 0) return false;
      const key = piece.powers[powerIdx];
      if (!key) return false;
      const def = POWERS[key];
      if (def.canUse && !def.canUse(this, piece)) return false;
      if (def.targeted) {
        if (!target) return false;
        if (def.validTarget && !def.validTarget(this, piece, target[0], target[1])) return false;
      }

      piece.powers.splice(powerIdx, 1);
      this.log(this.names[piece.owner].toUpperCase() + ": " + def.name, "move-line");
      this.emit("power", { piece: piece.id, key, at: [piece.col, piece.row], scope: def.scope });
      def.apply(this, piece, target);

      this.afterPower(piece);
      return true;
    }

    /* ---------------- per-turn bookkeeping ---------------- */

    // a power does NOT end the turn — only moving a piece does. A power can
    // still win or lose the game outright (kamikaze, smart bomb), and it can
    // leave the active player with no way to move (stalemate).
    afterPower(piece) {
      if (piece.alive) this.resolveLanding(piece);   // e.g. teleport onto an orb

      this.checkVictory();
      if (this.winner === null && !this.hasAnyAction(this.turn)) {
        this.log(this.names[this.turn] + " has no possible moves.");
        this.winner = 1 - this.turn;
        this.emit("gameover", { winner: this.winner, reason: "stalemate" });
      }
      this.emit("afterPower", { turn: this.turn });
    }

    afterAction(piece, usedPowerKey) {
      // landing effects (also applies after teleports/relocates)
      if (piece.alive) this.resolveLanding(piece);

      this.movesPlayed++;
      this.emit("movesPlayed", { n: this.movesPlayed });

      // decrement inhibition on the mover's pieces (one tick per own turn)
      for (const p of this.livePieces(this.turn)) {
        if (p.inhibited > 0) p.inhibited--;
      }

      // end of full round?
      if (this.turn === 1) this.endOfRound();

      this.checkVictory();
      if (this.winner === null) {
        this.turn = 1 - this.turn;
        // skip-stalemate rule: a player with no possible action loses
        if (!this.hasAnyAction(this.turn)) {
          this.log(this.names[this.turn] + " has no possible moves.");
          this.winner = 1 - this.turn;
          this.emit("gameover", { winner: this.winner, reason: "stalemate" });
        }
      }
      this.emit("turn", { turn: this.turn });
    }

    // orbs on the tile a piece arrives at
    resolveLanding(piece) {
      const t = this.tile(piece.col, piece.row);

      if (t.orb) {
        t.orb = false;
        const key = randomPowerKey();
        piece.powers.push(key);
        this.emit("orbPickup", { piece: piece.id, key, owner: piece.owner });
      }
    }

    endOfRound() {
      // jump-proof shells wear down
      for (const p of this.pieces) {
        if (p.alive && p.jumpProof > 0) p.jumpProof--;
      }

      // acid corrosion: each acidic tile sinks and counts down to a hole
      for (let c = 0; c < COLS; c++)
        for (let r = 0; r < ROWS; r++) {
          const t = this.tile(c, r);
          if (!t.acidic || t.hole) continue;
          if (t.elev > MIN_ELEV) this.setElev(c, r, t.elev - 1);
          t.acidLife--;
          if (t.acidLife <= 0) this.destroyTile(c, r);
        }

      // orb spawning
      this.orbRoundsLeft--;
      if (this.orbRoundsLeft <= 0) {
        const n = this.orbAmount + this.orbAmountBonus;
        this.dropOrbs(n);
        this.orbDropCount++;
        if (this.orbDropCount % 2 === 0 && this.orbAmount < 4) this.orbAmount++;
        this.orbRoundsLeft = this.orbInterval;
      }
      this.emit("orbSchedule", {
        rounds: this.orbRoundsLeft,
        amount: this.orbAmount + this.orbAmountBonus,
      });
    }

    dropOrbs(n) {
      const spots = [];
      for (let c = 0; c < COLS; c++)
        for (let r = 0; r < ROWS; r++) {
          const t = this.tile(c, r);
          if (!t.hole && !t.orb && !this.pieceAt(c, r)) spots.push([c, r]);
        }
      let dropped = 0;
      for (let i = 0; i < n && spots.length; i++) {
        const idx = (Math.random() * spots.length) | 0;
        const [c, r] = spots.splice(idx, 1)[0];
        this.tile(c, r).orb = true;
        dropped++;
        this.emit("orbDrop", { at: [c, r] });
      }
      if (dropped) this.log(dropped + " Power Orb" + (dropped > 1 ? "s" : "") + " spawned.");
    }

    makeAcidic(c, r) {
      const t = this.tile(c, r);
      if (t.hole) return;
      t.acidic = true;
      t.acidLife = ACID_ROUNDS;
    }

    rehashOrbs() {
      let count = 0;
      for (let c = 0; c < COLS; c++)
        for (let r = 0; r < ROWS; r++)
          if (this.tile(c, r).orb) { this.tile(c, r).orb = false; count++; }
      this.dropOrbs(count);
    }

    /* ---------------- destruction ---------------- */

    destroyPiece(piece, _reason) {
      if (!piece.alive) return;
      piece.alive = false;
      this.emit("pieceDestroyed", { piece: piece.id, at: [piece.col, piece.row], owner: piece.owner });
    }

    destroyTile(c, r) {
      const t = this.tile(c, r);
      if (t.hole) return;
      t.hole = true;
      t.orb = false;
      t.acidic = false;
      t.acidLife = 0;
      t.elev = 0;
      const p = this.pieceAt(c, r);
      if (p) {
        this.destroyPiece(p, "hole");
        this.log("One of " + this.names[p.owner] + "'s pieces fell into a hole!");
      }
      this.emit("tileDestroyed", { at: [c, r] });
    }

    checkVictory() {
      if (this.winner !== null) return;
      for (const owner of [0, 1]) {
        if (this.livePieces(owner).length === 0) {
          this.winner = 1 - owner;
          this.emit("gameover", { winner: this.winner, reason: "elimination" });
          return;
        }
      }
    }

    resign(owner) {
      if (this.winner !== null) return;
      this.resigned = owner;
      this.winner = 1 - owner;
      this.log(this.names[owner] + " has honorably resigned.");
      this.log(this.movesPlayed + " total moves were played.");
      this.emit("gameover", { winner: this.winner, reason: "resign" });
    }

    drainEvents() {
      const ev = this.events;
      this.events = [];
      return ev;
    }
  }

  window.QGame = Game;
})();
