/* ============================================================
   AI — the CPU opponent ("turbo"). Plays player 1 (teal).
   Heuristic: weigh captures, orb grabs, safety, and occasional
   power usage when it would hit multiple enemies.
   ============================================================ */

(function () {
  "use strict";

  const { POWERS, scopeTiles } = window.QPOWERS;

  function enemiesInScope(G, piece, scope) {
    return scopeTiles(G, piece, scope)
      .map(([c, r]) => G.pieceAt(c, r))
      .filter(p => p && p.owner !== piece.owner).length;
  }

  function friendsInScope(G, piece, scope) {
    return scopeTiles(G, piece, scope)
      .map(([c, r]) => G.pieceAt(c, r))
      .filter(p => p && p.owner === piece.owner && p !== piece).length;
  }

  // would an enemy be able to step onto (c,r) next turn?
  function threatened(G, me, c, r) {
    const elev = G.tile(c, r).elev;
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc = c + dc, nr = r + dr;
      if (!G.inBounds(nc, nr)) continue;
      const p = G.pieceAt(nc, nr);
      if (!p || p.owner === me.owner) continue;
      const theirElev = G.tile(nc, nr).elev;
      if (p.climb || elev - theirElev <= 1) return true;
    }
    return false;
  }

  function nearestDist(G, c, r, predicate) {
    let best = Infinity;
    for (let cc = 0; cc < G.COLS; cc++)
      for (let rr = 0; rr < G.ROWS; rr++)
        if (predicate(cc, rr))
          best = Math.min(best, Math.abs(cc - c) + Math.abs(rr - r));
    return best;
  }

  function scoreMove(G, piece, c, r) {
    let s = Math.random() * 0.8;
    const victim = G.pieceAt(c, r);
    const t = G.tile(c, r);

    // grow bolder as the game drags on so matches actually finish:
    // caution fades to nothing, breaking midline standoffs
    const aggression = 1 + Math.min(3, G.movesPlayed / 80);
    const caution = Math.max(0, 6 - G.movesPlayed / 25);

    // moving a mined piece detonates it — only worth it for a desperate trade
    if (piece.mined) s -= victim ? 20 : 45;

    if (victim) s += (12 + victim.powers.length * 2) * aggression;
    if (t.orb) s += 8;
    if (t.acidic) s -= 4;
    if (threatened(G, piece, c, r)) s -= caution;
    if (!victim && !t.orb) {
      // drift toward the nearest orb, else toward the enemy
      const dOrb = nearestDist(G, c, r, (cc, rr) => G.tile(cc, rr).orb);
      if (dOrb < Infinity) s += Math.max(0, 5 - dOrb) * 0.6;
      const dFoe = nearestDist(G, c, r, (cc, rr) => {
        const p = G.pieceAt(cc, rr);
        return p && p.owner !== piece.owner;
      });
      if (dFoe < Infinity) s += Math.max(0, 14 - dFoe) * 0.3 * aggression;
    }
    // avoid pointless climbs into deep trenches
    s += t.elev * 0.3;
    return s;
  }

  function scorePower(G, piece, key) {
    const def = POWERS[key];
    const base = def.key.replace(/_(row|col|radial)$/, "");
    const foes = def.scope ? enemiesInScope(G, piece, def.scope) : 0;
    const pals = def.scope ? friendsInScope(G, piece, def.scope) : 0;

    switch (base) {
      case "trench": {
        // sinks friend and foe alike now — want a clear majority of foes
        const net = foes - pals;
        return net >= 2 ? 9 + net * 2 : Math.max(0, net * 2);
      }
      case "invert":    return foes >= 2 ? 7 + foes : 0;
      case "flatten":   return 0.5;
      case "acidic":    return foes >= 3 ? 8 : foes;
      case "plateau": {
        // lifts friend and foe alike now
        const net = pals - foes;
        return (net >= 2 && G.tile(piece.col, piece.row).elev < 2) ? 6 : Math.max(0, net);
      }
      case "wall":      return 1;
      case "tripwire":  return foes * 2.5;
      case "inhibit":   return foes * 3;
      case "spyware":   return foes * 1.2;
      case "purify":    return foes * 2.5;
      case "learn":     return foes * 2.5;
      case "bankrupt":  return foes * 3;
      case "raise_tile":
        // don't stack plateaus into the sky
        if (G.tile(piece.col, piece.row).elev >= 2) return 0;
        return threatened(G, piece, piece.col, piece.row) ? 8 : 1.5;
      case "multiply":
        // reinforcements matter when outnumbered, not when winning
        return G.livePieces(piece.owner).length <
               G.livePieces(1 - piece.owner).length ? 8 : 2;
      case "relocate":       return G.legalMoves(piece).length === 0 ? 12 : 0.3;
      case "teleport":       return 0; // needs targeting; skip for simplicity
      case "climb":          return 4;
      case "jump_proof":     return 6;
      case "smart_bomb":     return 6;
      case "kamikaze":       return foesAdjacent(G, piece) >= 3 ? 10 : 0;
      case "orbic_rehash":   return 1;
      case "grow_quadradius":return 5;
      case "switcheroo":     return 1;
      default: return 0;
    }
  }

  function foesAdjacent(G, piece) {
    let n = 0;
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) {
        if (!G.inBounds(piece.col + dc, piece.row + dr)) continue;
        const p = G.pieceAt(piece.col + dc, piece.row + dr);
        if (p && p.owner !== piece.owner) n++;
      }
    return n;
  }

  // choose and execute one action for player `owner`
  function takeTurn(G, owner) {
    let bestMove = null, bestMoveScore = -Infinity, bestMoveUrgent = false;
    for (const piece of G.livePieces(owner)) {
      for (const [c, r] of G.legalMoves(piece)) {
        const s = scoreMove(G, piece, c, r);
        if (s > bestMoveScore) {
          bestMoveScore = s;
          bestMove = { piece, c, r };
          bestMoveUrgent = !!G.pieceAt(c, r) || G.tile(c, r).orb;
        }
      }
    }

    let bestPow = null, bestPowScore = -Infinity;
    for (const piece of G.livePieces(owner)) {
      if (piece.inhibited > 0) continue;
      piece.powers.forEach((key, idx) => {
        const def = POWERS[key];
        if (def.targeted) return;
        if (def.canUse && !def.canUse(G, piece)) return;
        const s = scorePower(G, piece, key) + Math.random() * 0.5;
        if (s > bestPowScore) { bestPowScore = s; bestPow = { piece, idx }; }
      });
    }

    // captures and orb grabs come first; otherwise spend a decent power
    // rather than hoarding forever
    if (bestMove && bestMoveUrgent) {
      return G.doMove(bestMove.piece, bestMove.c, bestMove.r);
    }
    if (bestPow && bestPowScore >= 6) {
      return G.doPower(bestPow.piece, bestPow.idx);
    }
    if (bestMove) {
      return G.doMove(bestMove.piece, bestMove.c, bestMove.r);
    }
    if (bestPow) {
      return G.doPower(bestPow.piece, bestPow.idx);
    }
    return false;
  }

  const TAUNTS = [
    "beep boop. calculating your demise.",
    "nice move. shame about the next one.",
    "my circuits are tingling.",
    "you fight well, for a human.",
    "that trench looked comfy, no?",
    "I run on victory and spare voltage.",
  ];

  function taunt() { return TAUNTS[(Math.random() * TAUNTS.length) | 0]; }

  window.QAI = { takeTurn, taunt };
})();
