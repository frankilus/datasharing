/* ============================================================
   POWERS — definitions for every collectible power.
   Scoped powers come in ROW / COLUMN / RADIAL variants.
   Each definition:
     key      unique id
     name     display name (LED screen / log)
     desc     description shown on the LED screen
     scope    'row' | 'col' | 'radial' | null
     targeted true -> player must click a destination tile
     canUse(G, piece)        -> bool (optional extra gating)
     apply(G, piece, target) -> performs the effect, returns log/none
   ============================================================ */

(function () {
  "use strict";

  const SCOPES = [
    { id: "row",    label: "ROW" },
    { id: "col",    label: "COLUMN" },
    { id: "radial", label: "RADIAL" },
  ];

  function scopeTiles(G, piece, scope) {
    const out = [];
    if (scope === "row") {
      for (let c = 0; c < G.COLS; c++) out.push([c, piece.row]);
    } else if (scope === "col") {
      for (let r = 0; r < G.ROWS; r++) out.push([piece.col, r]);
    } else if (scope === "radial") {
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++) {
          const c = piece.col + dc, r = piece.row + dr;
          if (c >= 0 && c < G.COLS && r >= 0 && r < G.ROWS) out.push([c, r]);
        }
    }
    return out;
  }

  // enemy pieces standing on the given tile list
  function enemiesIn(G, piece, _scope, tiles) {
    return tiles
      .map(([c, r]) => G.pieceAt(c, r))
      .filter(p => p && p.owner !== piece.owner);
  }

  /* ---------- scoped power templates ---------- */

  const SCOPED = [
    {
      key: "trench",
      name: "TRENCH",
      desc: "Drops the entire line two levels, digging a deep trench. Every " +
            "tile in range sinks — and every piece standing on them, yours and " +
            "the enemy's alike, sinks with it. Pieces caught at the bottom " +
            "cannot climb back out without help.",
      apply(G, _piece, _t, tiles) {
        for (const [c, r] of tiles) G.changeElev(c, r, -2);
      },
    },
    {
      key: "plateau",
      name: "PLATEAU",
      desc: "Raises the entire line two levels into a platform. Every tile in " +
            "range is lifted — and every piece standing on them, yours and the " +
            "enemy's alike, rides up with it onto high ground.",
      apply(G, _piece, _t, tiles) {
        for (const [c, r] of tiles) G.changeElev(c, r, +2);
      },
    },
    {
      key: "invert",
      name: "INVERT",
      desc: "Flips the elevation of every tile in range: high ground becomes a " +
            "pit and trenches become towers. Devastating against an opponent " +
            "who thought they were safe up top.",
      apply(G, _piece, _t, tiles) {
        for (const [c, r] of tiles) G.setElev(c, r, -G.tile(c, r).elev);
      },
    },
    {
      key: "flatten",
      name: "FLATTEN",
      desc: "Bulldozes every tile in range back to ground level, erasing " +
            "trenches, plateaus and walls alike.",
      apply(G, _piece, _t, tiles) {
        for (const [c, r] of tiles) G.setElev(c, r, 0);
      },
    },
    {
      key: "acidic",
      name: "ACIDIC",
      desc: "Sprays corrosive acid onto every enemy piece in range, flooding " +
            "the tile under each one. Acidic tiles sink one level at the end " +
            "of every round and eventually dissolve into bottomless holes that " +
            "destroy anything standing on them. Cannot be activated unless an " +
            "enemy piece is in range.",
      needsTargets: (G, piece, tiles) => enemiesIn(G, piece, null, tiles).length > 0,
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles)) G.makeAcidic(p.col, p.row);
      },
    },
    {
      key: "tripwire",
      name: "TRIPWIRE",
      desc: "Straps a proximity mine to every enemy piece in range. The moment " +
            "a mined piece moves, the mine detonates and destroys it. Mined " +
            "pieces can still activate powers — and PURIFY can defuse the mine.",
      needsTargets: (G, piece, tiles) => enemiesIn(G, piece, null, tiles).length > 0,
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles)) p.mined = true;
      },
    },
    {
      key: "inhibit",
      name: "INHIBIT",
      desc: "Jams the power systems of every enemy piece in range. Inhibited " +
            "pieces cannot activate any powers for their next three turns.",
      needsTargets: (G, piece, tiles) => enemiesIn(G, piece, null, tiles).length > 0,
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles)) p.inhibited = 3;
      },
    },
    {
      key: "spyware",
      name: "SPYWARE",
      desc: "Attaches a visible bugging device to any opponent's pieces " +
            "surrounding you. You can then view their power inventory. Useful " +
            "for keeping tabs on what new powers they collect and predicting " +
            "their plans.",
      needsTargets: (G, piece, tiles) => enemiesIn(G, piece, null, tiles).length > 0,
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles)) p.buggedBy[piece.owner] = true;
      },
    },
    {
      key: "purify",
      name: "PURIFY",
      desc: "Releases a cleansing burst that strips every enemy piece in range " +
            "of all stored powers, bugs and enhancements, returning them to " +
            "plain foot soldiers.",
      needsTargets: (G, piece, tiles) => enemiesIn(G, piece, null, tiles).length > 0,
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles)) {
          p.powers = [];
          p.buggedBy = {};
          p.inhibited = 0;
          p.mined = false;
          p.climb = false;
          p.jumpProof = 0;
        }
      },
    },
    {
      key: "learn",
      name: "LEARN",
      desc: "Scans every other piece in range — friend and foe — and copies all " +
            "of their stored powers into this piece's own inventory. The other " +
            "pieces keep theirs; this piece simply inherits a copy of everything.",
      // only fires if some other piece in range is actually carrying a power
      needsTargets: (G, piece, tiles) => tiles.some(([c, r]) => {
        const p = G.pieceAt(c, r);
        return p && p !== piece && p.powers.length > 0;
      }),
      apply(G, piece, _t, tiles) {
        for (const [c, r] of tiles) {
          const p = G.pieceAt(c, r);
          if (p && p !== piece)
            for (const k of p.powers) piece.powers.push(k);
        }
      },
    },
    {
      key: "bankrupt",
      name: "BANKRUPT",
      desc: "Triggers a market crash across the line: every unclaimed Power Orb " +
            "in range is wiped off the board, and every power stored by enemy " +
            "pieces in range is destroyed. Nobody profits here.",
      apply(G, piece, _t, tiles) {
        for (const [c, r] of tiles) {
          const t = G.tile(c, r);
          if (t.orb) t.orb = false;
        }
        for (const p of enemiesIn(G, piece, null, tiles)) p.powers = [];
      },
    },
    {
      key: "wall",
      name: "WALL",
      desc: "Erects a barricade across the entire line: every tile in range is " +
            "raised to maximum height, and every piece standing on it rides up " +
            "onto the wall.",
      apply(G, _piece, _t, tiles) {
        for (const [c, r] of tiles) {
          const t = G.tile(c, r);
          if (!t.hole) G.setElev(c, r, G.MAX_ELEV);
        }
      },
    },
  ];

  /* ---------- un-scoped powers ---------- */

  const SINGLE = [
    {
      key: "raise_tile",
      name: "RAISE TILE",
      desc: "Jacks this piece's own tile up two levels, putting it on high " +
            "ground that lower enemies cannot reach.",
      apply(G, piece) { G.changeElev(piece.col, piece.row, +2); },
    },
    {
      key: "multiply",
      name: "MULTIPLY",
      desc: "This piece divides like a living cell, spawning a fresh " +
            "(power-less) copy of itself on an adjacent empty tile of your " +
            "choosing. After activating, click where the new piece should grow.",
      targeted: true,
      canUse(G, piece) {
        return [[1,0],[-1,0],[0,1],[0,-1]].some(([dc, dr]) => {
          const c = piece.col + dc, r = piece.row + dr;
          if (c < 0 || c >= G.COLS || r < 0 || r >= G.ROWS) return false;
          const t = G.tile(c, r);
          return !t.hole && !G.pieceAt(c, r) && !t.orb;
        });
      },
      validTarget(G, piece, c, r) {
        const adj = Math.abs(c - piece.col) + Math.abs(r - piece.row) === 1;
        if (!adj) return false;
        const t = G.tile(c, r);
        return !t.hole && !G.pieceAt(c, r) && !t.orb;
      },
      apply(G, piece, target) {
        const child = G.spawnPiece(piece.owner, target[0], target[1]);
        // match the parent's tile so the offspring isn't stranded at ground level
        G.setElev(child.col, child.row, G.tile(piece.col, piece.row).elev);
        G.emit("divide", { parent: piece.id, child: child.id,
                           from: [piece.col, piece.row], to: target });
      },
    },
    {
      key: "relocate",
      name: "RELOCATE",
      desc: "Emergency transport: instantly beams this piece to a random empty " +
            "tile somewhere on the board. You don't get to choose where — but " +
            "it's a great escape from a trench or an ambush.",
      apply(G, piece) {
        const spots = [];
        for (let c = 0; c < G.COLS; c++)
          for (let r = 0; r < G.ROWS; r++) {
            const t = G.tile(c, r);
            if (!t.hole && !G.pieceAt(c, r)) spots.push([c, r]);
          }
        if (spots.length) {
          const [c, r] = spots[(Math.random() * spots.length) | 0];
          G.movePieceTo(piece, c, r);
        }
      },
    },
    {
      key: "teleport",
      name: "TELEPORT",
      desc: "Precision transport: beams this piece to ANY empty tile of your " +
            "choosing. After activating, click the destination tile.",
      targeted: true,
      validTarget(G, piece, c, r) {
        const t = G.tile(c, r);
        return !t.hole && !G.pieceAt(c, r);
      },
      apply(G, piece, target) {
        G.movePieceTo(piece, target[0], target[1]);
      },
    },
    {
      key: "climb",
      name: "CLIMB",
      desc: "Permanently fits this piece with climbing gear. It can scale any " +
            "elevation in a single move — trenches and walls no longer stop it.",
      apply(G, piece) { piece.climb = true; },
    },
    {
      key: "jump_proof",
      name: "JUMP PROOF",
      desc: "Armors this piece with a hazard-striped shell for the next 12 " +
            "rounds. Enemy pieces cannot land on it while the shell holds. It " +
            "can still be destroyed by holes, acid, bombs and mines.",
      apply(G, piece) { piece.jumpProof = 12; },
    },
    {
      key: "smart_bomb",
      name: "SMART BOMB",
      desc: "Launches a cluster strike that blasts four random tiles into " +
            "bottomless holes, destroying any piece standing on them. The " +
            "launching piece is never hit.",
      apply(G, piece) {
        const spots = [];
        for (let c = 0; c < G.COLS; c++)
          for (let r = 0; r < G.ROWS; r++) {
            if (c === piece.col && r === piece.row) continue;
            if (!G.tile(c, r).hole) spots.push([c, r]);
          }
        for (let i = 0; i < 4 && spots.length; i++) {
          const idx = (Math.random() * spots.length) | 0;
          const [c, r] = spots.splice(idx, 1)[0];
          G.destroyTile(c, r);
        }
      },
    },
    {
      key: "kamikaze",
      name: "KAMIKAZE",
      desc: "This piece self-destructs in a massive blast, destroying every " +
            "piece — friend or foe — on the eight tiles around it and scorching " +
            "the ground a level lower.",
      apply(G, piece) {
        for (let dc = -1; dc <= 1; dc++)
          for (let dr = -1; dr <= 1; dr++) {
            const c = piece.col + dc, r = piece.row + dr;
            if (c < 0 || c >= G.COLS || r < 0 || r >= G.ROWS) continue;
            const p = G.pieceAt(c, r);
            if (p) G.destroyPiece(p);
            G.changeElev(c, r, -1);
          }
      },
    },
    {
      key: "orbic_rehash",
      name: "ORBIC REHASH",
      desc: "Scrambles the battlefield's orb dispensers: every unclaimed Power " +
            "Orb on the board is whisked away and re-dropped at a new random " +
            "location. Use it when the orbs are falling too close to the enemy.",
      apply(G) { G.rehashOrbs(); },
    },
    {
      key: "grow_quadradius",
      name: "GROW QUADRADIUS",
      desc: "Overclocks the orb dispensers permanently. Every future Power Orb " +
            "drop delivers one additional orb to the battlefield.",
      apply(G) { G.orbAmountBonus++; },
    },
    {
      key: "switcheroo",
      name: "SWITCHEROO",
      desc: "Hijacks an enemy transport beam, instantly swapping this piece's " +
            "position with an enemy piece of your choosing. After activating, " +
            "click the enemy piece to swap with.",
      targeted: true,
      canUse(G, piece) { return G.pieces.some(p => p.alive && p.owner !== piece.owner); },
      validTarget(G, piece, c, r) {
        const p = G.pieceAt(c, r);
        return !!p && p.owner !== piece.owner;
      },
      apply(G, piece, target) {
        const foe = G.pieceAt(target[0], target[1]);
        if (!foe) return;
        const mine = [piece.col, piece.row], theirs = [foe.col, foe.row];
        G.emit("move", { piece: piece.id, from: mine, to: theirs });
        G.emit("move", { piece: foe.id, from: theirs, to: mine });
        piece.col = theirs[0]; piece.row = theirs[1];
        foe.col = mine[0]; foe.row = mine[1];
      },
    },
  ];

  /* ---------- expand into the master table ---------- */

  const POWERS = {};

  for (const tpl of SCOPED) {
    for (const sc of SCOPES) {
      const key = tpl.key + "_" + sc.id;
      POWERS[key] = {
        key,
        name: tpl.name + " " + sc.label,
        desc: tpl.desc,
        scope: sc.id,
        targeted: false,
        // powers that need targets in range can't fire (or be wasted) without one
        canUse: tpl.needsTargets
          ? (G, piece) =>
              tpl.needsTargets(G, piece, scopeTiles(G, piece, sc.id))
          : (tpl.canUse || null),
        apply(G, piece, target) {
          const tiles = scopeTiles(G, piece, sc.id);
          tpl.apply(G, piece, target, tiles);
        },
      };
    }
  }

  for (const tpl of SINGLE) {
    POWERS[tpl.key] = {
      key: tpl.key,
      name: tpl.name,
      desc: tpl.desc,
      scope: null,
      targeted: !!tpl.targeted,
      validTarget: tpl.validTarget || null,
      canUse: tpl.canUse || null,
      apply: tpl.apply,
    };
  }

  const POWER_KEYS = Object.keys(POWERS);

  function randomPowerKey() {
    return POWER_KEYS[(Math.random() * POWER_KEYS.length) | 0];
  }

  window.QPOWERS = { POWERS, POWER_KEYS, randomPowerKey, scopeTiles };
})();
