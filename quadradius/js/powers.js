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
      desc: "Drops every tile in range two levels, digging a deep trench. " +
            "Enemy pieces caught at the bottom cannot climb back out without help, " +
            "leaving them stranded and easy to pick off.",
      apply(G, piece, _t, tiles) {
        for (const [c, r] of tiles) {
          if (c === piece.col && r === piece.row) continue;
          G.changeElev(c, r, -2);
        }
      },
    },
    {
      key: "plateau",
      name: "PLATEAU",
      desc: "Raises the tile under each of your pieces in range by two levels, " +
            "lifting your squadron onto high ground where lower enemies cannot " +
            "land on them.",
      apply(G, piece, _t, tiles) {
        for (const [c, r] of tiles) {
          const p = G.pieceAt(c, r);
          if (p && p.owner === piece.owner) G.changeElev(c, r, +2);
        }
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
      desc: "Floods the tiles in range with corrosive acid. Acidic tiles sink " +
            "one level at the end of every round, and eventually dissolve into " +
            "bottomless holes that destroy anything standing on them.",
      apply(G, _piece, _t, tiles) {
        for (const [c, r] of tiles) {
          const t = G.tile(c, r);
          if (!t.hole) t.acidic = true;
        }
      },
    },
    {
      key: "tripwire",
      name: "TRIPWIRE",
      desc: "Rigs every unoccupied tile in range with an invisible tripwire. " +
            "The first enemy piece to step on a rigged tile is instantly " +
            "destroyed. Your opponent cannot see where the wires are.",
      apply(G, piece, _t, tiles) {
        for (const [c, r] of tiles) {
          const t = G.tile(c, r);
          if (!t.hole && !G.pieceAt(c, r)) t.tripwire = piece.owner;
        }
      },
    },
    {
      key: "inhibit",
      name: "INHIBIT",
      desc: "Jams the power systems of every enemy piece in range. Inhibited " +
            "pieces cannot activate any powers for their next three turns.",
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles)) p.inhibited = 3;
      },
      useEnemies: true,
    },
    {
      key: "spyware",
      name: "SPYWARE",
      desc: "Attaches a visible bugging device to any opponent's pieces " +
            "surrounding you. You can then view their power inventory. Useful " +
            "for keeping tabs on what new powers they collect and predicting " +
            "their plans.",
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles)) p.buggedBy[piece.owner] = true;
      },
      useEnemies: true,
    },
    {
      key: "purify",
      name: "PURIFY",
      desc: "Releases a cleansing burst that strips every enemy piece in range " +
            "of all stored powers, bugs and enhancements, returning them to " +
            "plain foot soldiers.",
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles)) {
          p.powers = [];
          p.buggedBy = {};
          p.inhibited = 0;
          p.climb = false;
          p.jumpProof = 0;
        }
      },
      useEnemies: true,
    },
    {
      key: "learn",
      name: "LEARN",
      desc: "Scans every enemy piece in range and copies all of their stored " +
            "powers into this piece's own inventory. The enemy keeps theirs — " +
            "but now you have them too.",
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles))
          for (const k of p.powers) piece.powers.push(k);
      },
      useEnemies: true,
    },
    {
      key: "bankrupt",
      name: "BANKRUPT",
      desc: "Emits a destructive pulse that wipes out every power stored by " +
            "enemy pieces in range. Their inventories are emptied for good.",
      apply(G, piece, _t, tiles) {
        for (const p of enemiesIn(G, piece, null, tiles)) p.powers = [];
      },
      useEnemies: true,
    },
    {
      key: "wall",
      name: "WALL",
      desc: "Erects towering barricades on every empty tile in range, raising " +
            "them three levels into an imposing wall that reshapes the " +
            "battlefield's traffic lanes.",
      apply(G, _piece, _t, tiles) {
        for (const [c, r] of tiles) {
          const t = G.tile(c, r);
          if (!t.hole && !G.pieceAt(c, r)) G.setElev(c, r, 3);
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
      desc: "This piece divides itself, spawning a fresh (power-less) copy of " +
            "itself on every empty tile directly beside it.",
      apply(G, piece) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const c = piece.col + dc, r = piece.row + dr;
          if (c < 0 || c >= G.COLS || r < 0 || r >= G.ROWS) continue;
          const t = G.tile(c, r);
          if (!t.hole && !G.pieceAt(c, r) && !t.orb) G.spawnPiece(piece.owner, c, r);
        }
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
            "can still be destroyed by holes, acid, bombs and tripwires.",
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
        const c = piece.col, r = piece.row;
        piece.col = foe.col; piece.row = foe.row;
        foe.col = c; foe.row = r;
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
        canUse: tpl.canUse || null,
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
