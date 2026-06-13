/* ============================================================
   RENDER — HD canvas drawing: industrial tiles with elevation,
   glossy mechanical pieces, power orbs, highlights and FX.
   All artwork is drawn procedurally — no image assets.
   ============================================================ */

(function () {
  "use strict";

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");

  const PLAYER_COLORS = [
    { core: "#e02418", coreHi: "#ffb9ad", coreLo: "#5e0c05", glow: "rgba(255,70,50," },   // red
    { core: "#2aa39b", coreHi: "#c2f7f2", coreLo: "#0c4a4e", glow: "rgba(60,220,210," },  // teal
  ];

  const R = {
    G: null,             // game
    tileSize: 80,
    ox: 0, oy: 0,        // board origin in px
    selected: null,      // selected piece id
    legal: [],           // highlighted move targets
    targeting: false,    // teleport-style targeting mode
    targetTiles: [],
    viewer: 0,
    drag: null,          // {id, x, y} piece carried by the cursor
    pieceAnims: {},      // pieceId -> sliding move animation
    anims: [],
    shakes: 0,
    time: 0,
    noise: null,         // cached grunge pattern
  };

  /* ---------------- layout ---------------- */

  function resize() {
    const area = document.getElementById("boardArea");
    canvas.width = area.clientWidth;
    canvas.height = area.clientHeight;
    if (!R.G) return;
    const pad = 40;
    R.tileSize = Math.floor(Math.min(
      (canvas.width - pad * 2) / R.G.COLS,
      (canvas.height - pad * 2) / R.G.ROWS));
    R.ox = Math.floor((canvas.width - R.tileSize * R.G.COLS) / 2);
    R.oy = Math.floor((canvas.height - R.tileSize * R.G.ROWS) / 2);
  }
  window.addEventListener("resize", resize);

  const ELEV_LIFT = 0.14;   // px offset per elevation level, in tile sizes

  function visElev(t) {
    if (t.hole) return 0;
    if (t.renderElev === undefined) t.renderElev = t.elev;
    return t.renderElev;
  }

  function tileCenter(c, r) {
    return {
      x: R.ox + c * R.tileSize + R.tileSize / 2,
      y: R.oy + r * R.tileSize + R.tileSize / 2 -
         visElev(R.G.tile(c, r)) * R.tileSize * ELEV_LIFT,
    };
  }

  function pickTile(px, py) {
    const c = Math.floor((px - R.ox) / R.tileSize);
    const r = Math.floor((py - R.oy) / R.tileSize);
    if (!R.G || c < 0 || c >= R.G.COLS || r < 0 || r >= R.G.ROWS) return null;
    return [c, r];
  }

  /* ---------------- grunge texture ---------------- */

  function makeNoise() {
    const n = document.createElement("canvas");
    n.width = n.height = 128;
    const nx = n.getContext("2d");
    for (let i = 0; i < 900; i++) {
      nx.fillStyle = "rgba(" + (Math.random() < 0.5 ? "0,0,0" : "255,255,255") +
        "," + (Math.random() * 0.05).toFixed(3) + ")";
      nx.fillRect(Math.random() * 128, Math.random() * 128,
                  1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    // a few rust stains
    for (let i = 0; i < 6; i++) {
      const g = nx.createRadialGradient(
        Math.random() * 128, Math.random() * 128, 0,
        Math.random() * 128, Math.random() * 128, 10 + Math.random() * 24);
      g.addColorStop(0, "rgba(80,46,24,0.10)");
      g.addColorStop(1, "rgba(80,46,24,0)");
      nx.fillStyle = g;
      nx.fillRect(0, 0, 128, 128);
    }
    R.noise = ctx.createPattern(n, "repeat");
  }

  /* ---------------- tiles ---------------- */

  function drawTile(c, r) {
    const t = R.G.tile(c, r);
    const s = R.tileSize;
    const x = R.ox + c * s, y = R.oy + r * s;

    if (t.hole) {
      // bottomless pit
      const g = ctx.createRadialGradient(x + s/2, y + s/2, s*0.05, x + s/2, y + s/2, s*0.55);
      g.addColorStop(0, "#000");
      g.addColorStop(0.75, "#0a0908");
      g.addColorStop(1, "#1b1916");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, s, s);
      return;
    }

    const ev = visElev(t);
    const lift = ev * s * ELEV_LIFT;         // vertical offset for elevation
    const ty = y - lift;
    const bright = 1 + ev * 0.08;            // higher = brighter
    const px3d = s * 0.06 * Math.max(0, ev); // slight rightward skew for raised slabs

    if (lift > 0.5) {
      // raised slab: soft contact shadow + extruded front & right side walls
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = lift * 1.6;
      ctx.shadowOffsetY = lift * 0.55;
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
      ctx.restore();

      // front wall (slab thickness)
      const front = ctx.createLinearGradient(x, ty + s - lift, x, ty + s);
      front.addColorStop(0, "#736a5d");
      front.addColorStop(1, "#2f2b24");
      ctx.fillStyle = front;
      ctx.fillRect(x + 1, ty + s - 1, s - 2, lift + 2);
      // right wall, catching a touch of warm rim light
      const right = ctx.createLinearGradient(x + s - 2, ty, x + s - 2 + px3d, ty);
      right.addColorStop(0, "#5d544868");
      right.addColorStop(1, "#3a352c");
      if (px3d > 0.5) { ctx.fillStyle = right; ctx.fillRect(x + s - 2, ty + 1, px3d, s + lift); }
      // per-level seam grooves on the front wall
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1;
      for (let i = 1; i < ev; i++) {
        const yy = ty + s - 1 + (i / ev) * lift;
        ctx.beginPath(); ctx.moveTo(x + 2, yy); ctx.lineTo(x + s - 2, yy); ctx.stroke();
      }
      // warm accent along the top lip
      ctx.fillStyle = "rgba(255,212,150,0.22)";
      ctx.fillRect(x + 1, ty + s - 1, s - 2, 2);
    } else if (lift < -0.5) {
      // trench: looking down into a recessed pit with shaded inner walls
      const depth = -lift;
      ctx.fillStyle = "#15120d";
      ctx.fillRect(x, y, s, s);
      // upper/back inner wall, lighter toward the sunken floor
      const back = ctx.createLinearGradient(x, y, x, y + depth);
      back.addColorStop(0, "#0c0a07");
      back.addColorStop(1, "#3b352b");
      ctx.fillStyle = back;
      ctx.fillRect(x + 1, y, s - 2, depth + 2);
      // soft inner shadow down the left edge for roundness
      const lsh = ctx.createLinearGradient(x, y, x + s * 0.3, y);
      lsh.addColorStop(0, "rgba(0,0,0,0.5)");
      lsh.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lsh;
      ctx.fillRect(x + 1, y, s * 0.3, s);
      // cool accent along the lip you peer over
      ctx.fillStyle = "rgba(130,180,220,0.16)";
      ctx.fillRect(x + 1, y, s - 2, 2);
    }

    // face
    const base = t.acidic ? [104, 122, 84] : [122, 116, 106];
    const g = ctx.createLinearGradient(x, ty, x, ty + s);
    g.addColorStop(0, rgb(base, 1.10 * bright));
    g.addColorStop(0.5, rgb(base, 0.97 * bright));
    g.addColorStop(1, rgb(base, 0.82 * bright));
    ctx.fillStyle = g;
    ctx.fillRect(x + 1, ty + 1, s - 2, s - 2);

    // grunge + bevel
    ctx.fillStyle = R.noise;
    ctx.fillRect(x + 1, ty + 1, s - 2, s - 2);
    ctx.strokeStyle = "rgba(255,255,255," + (0.10 * bright) + ")";
    ctx.strokeRect(x + 1.5, ty + 1.5, s - 3, s - 3);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.strokeRect(x + 0.5, ty + 0.5, s - 1, s - 1);

    // etched dial emblem (gauge circle with a needle)
    const cx = x + s/2, cy = ty + s/2;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#2c2a26";
    ctx.lineWidth = Math.max(1.5, s * 0.025);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - s * 0.34, cy + s * 0.34);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.04, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // trench floors pool extra shadow
    if (ev < 0) {
      ctx.fillStyle = "rgba(0,0,0," + Math.min(0.5, -ev * 0.12) + ")";
      ctx.fillRect(x + 1, ty + 1, s - 2, s - 2);
    }

    // acid shimmer
    if (t.acidic) {
      ctx.fillStyle = "rgba(120,200,60," + (0.10 + 0.06 * Math.sin(R.time / 300 + c + r)) + ")";
      ctx.fillRect(x + 1, ty + 1, s - 2, s - 2);
    }

    // power orb
    if (t.orb) drawOrb(cx, cy, s);
  }

  function drawOrb(cx, cy, s) {
    const rr = s * 0.16 * (1 + 0.05 * Math.sin(R.time / 350 + cx));
    ctx.save();
    // drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(cx + rr*0.25, cy + rr*0.9, rr*1.05, rr*0.45, 0, 0, Math.PI*2);
    ctx.fill();
    // chrome ball, half dark half light like a bearing
    const g = ctx.createRadialGradient(cx - rr*0.45, cy - rr*0.5, rr*0.1, cx, cy, rr*1.2);
    g.addColorStop(0, "#fdfdfa");
    g.addColorStop(0.35, "#b9b4ab");
    g.addColorStop(0.65, "#4a463f");
    g.addColorStop(1, "#15130f");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(cx - rr*0.35, cy - rr*0.4, rr*0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------- pieces ---------------- */

  function drawPiece(p, px, py, scale) {
    const s = R.tileSize * (scale || 1);
    const col = PLAYER_COLORS[p.owner];
    const ringR = s * 0.36;
    const coreR = s * 0.155;

    ctx.save();

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(px + s*0.03, py + ringR*0.55, ringR*1.02, ringR*0.5, 0, 0, Math.PI*2);
    ctx.fill();

    // selection glow
    if (R.selected === p.id) {
      ctx.shadowColor = col.glow + "0.9)";
      ctx.shadowBlur = s * 0.25;
    }

    // mechanical ring body
    const body = ctx.createRadialGradient(px - ringR*0.4, py - ringR*0.5, ringR*0.15, px, py, ringR*1.15);
    body.addColorStop(0, "#f4f1ea");
    body.addColorStop(0.55, "#cfc9bd");
    body.addColorStop(0.85, "#8f887b");
    body.addColorStop(1, "#5b554a");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(px, py, ringR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // shutter segment lines
    ctx.strokeStyle = "rgba(60,55,46,0.55)";
    ctx.lineWidth = Math.max(1, s * 0.012);
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + Math.PI / 7;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a0) * coreR * 1.25, py + Math.sin(a0) * coreR * 1.25);
      const a1 = a0 + 0.5;
      ctx.lineTo(px + Math.cos(a1) * ringR * 0.96, py + Math.sin(a1) * ringR * 0.96);
      ctx.stroke();
    }
    // rivet dots arc
    ctx.fillStyle = "rgba(60,55,46,0.5)";
    for (let i = 0; i < 5; i++) {
      const a = -0.5 + i * 0.18;
      ctx.beginPath();
      ctx.arc(px + Math.cos(a) * ringR * 0.8, py + Math.sin(a) * ringR * 0.8, s*0.012, 0, Math.PI*2);
      ctx.fill();
    }

    // ring rim
    ctx.strokeStyle = "rgba(40,36,30,0.7)";
    ctx.lineWidth = Math.max(1, s * 0.015);
    ctx.beginPath();
    ctx.arc(px, py, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // glossy core orb
    const core = ctx.createRadialGradient(px - coreR*0.4, py - coreR*0.5, coreR*0.08, px, py, coreR*1.25);
    core.addColorStop(0, col.coreHi);
    core.addColorStop(0.45, col.core);
    core.addColorStop(1, col.coreLo);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(px, py, coreR, 0, Math.PI * 2);
    ctx.fill();
    // socket shadow + specular
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.beginPath();
    ctx.arc(px, py, coreR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(px - coreR*0.32, py - coreR*0.38, coreR*0.22, 0, Math.PI*2);
    ctx.fill();

    // spyware bug — small dark-green dome clamped to the rim
    if (Object.keys(p.buggedBy).length) {
      ctx.fillStyle = "#3c4a32";
      ctx.beginPath();
      ctx.arc(px + ringR*0.72, py + ringR*0.35, s*0.055, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = "rgba(170,210,140,0.65)";
      ctx.beginPath();
      ctx.arc(px + ringR*0.70, py + ringR*0.32, s*0.018, 0, Math.PI*2);
      ctx.fill();
    }

    // strapped mine — blinking charge clamped to the rim
    if (p.mined) {
      const blink = 0.5 + 0.5 * Math.sin(R.time / 180);
      ctx.fillStyle = "#23201b";
      ctx.beginPath();
      ctx.arc(px - ringR*0.72, py + ringR*0.35, s*0.06, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,46,20," + (0.35 + 0.65 * blink) + ")";
      ctx.beginPath();
      ctx.arc(px - ringR*0.72, py + ringR*0.35, s*0.024, 0, Math.PI*2);
      ctx.fill();
    }

    // inhibited — flickering jam static
    if (p.inhibited > 0) {
      ctx.fillStyle = "rgba(255,60,30," + (0.18 + 0.12*Math.sin(R.time/90)) + ")";
      ctx.beginPath();
      ctx.arc(px, py, ringR, 0, Math.PI * 2);
      ctx.fill();
    }

    // climb — spinning propeller mounted on a hub above the piece
    if (p.climb) {
      const spin = R.time / 60;
      const hubY = py - ringR * 0.92;
      // support mast
      ctx.strokeStyle = "rgba(40,36,30,0.8)";
      ctx.lineWidth = Math.max(1.5, s * 0.025);
      ctx.beginPath();
      ctx.moveTo(px, py - ringR * 0.55);
      ctx.lineTo(px, hubY);
      ctx.stroke();
      // motion blur disc
      ctx.fillStyle = "rgba(150,170,190,0.18)";
      ctx.beginPath();
      ctx.ellipse(px, hubY, ringR * 0.95, ringR * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      // two blades, foreshortened by the spin angle so they look like they turn
      for (const off of [0, Math.PI]) {
        const a = spin + off;
        const bx = Math.cos(a) * ringR * 0.95;
        const grad = ctx.createLinearGradient(px - bx, hubY, px + bx, hubY);
        grad.addColorStop(0, "#9aa6b2");
        grad.addColorStop(0.5, "#e8eef4");
        grad.addColorStop(1, "#6c7884");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(px, hubY, Math.abs(bx), ringR * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // hub cap
      ctx.fillStyle = "#3a3630";
      ctx.beginPath();
      ctx.arc(px, hubY, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.arc(px - s*0.012, hubY - s*0.012, s * 0.015, 0, Math.PI * 2);
      ctx.fill();
    }

    // jump-proof — translucent energy force field bubble over the piece
    if (p.jumpProof > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(R.time / 220);
      const fieldR = ringR * 1.28;
      ctx.save();
      const fg = ctx.createRadialGradient(px - fieldR*0.3, py - fieldR*0.35, fieldR*0.1,
                                          px, py, fieldR);
      fg.addColorStop(0, "rgba(150,225,255,0.05)");
      fg.addColorStop(0.7, "rgba(120,200,255," + (0.10 + 0.06*pulse) + ")");
      fg.addColorStop(0.92, "rgba(160,235,255," + (0.32 + 0.18*pulse) + ")");
      fg.addColorStop(1, "rgba(90,170,235,0.06)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(px, py, fieldR, 0, Math.PI * 2);
      ctx.fill();
      // crackling hex shimmer ring
      ctx.strokeStyle = "rgba(180,240,255," + (0.45 + 0.3*pulse) + ")";
      ctx.lineWidth = Math.max(1.5, s * 0.02);
      ctx.beginPath();
      ctx.arc(px, py, fieldR, 0, Math.PI * 2);
      ctx.stroke();
      // bright specular highlight on the dome
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = Math.max(1, s * 0.012);
      ctx.beginPath();
      ctx.arc(px, py, fieldR * 0.97, Math.PI * 1.15, Math.PI * 1.6);
      ctx.stroke();
      ctx.restore();
    }

    // power count pips
    if (p.powers.length) {
      ctx.fillStyle = "rgba(255,235,160,0.9)";
      const n = Math.min(p.powers.length, 6);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI/2 + (i - (n-1)/2) * 0.3;
        ctx.beginPath();
        ctx.arc(px + Math.cos(a)*ringR*1.12, py + Math.sin(a)*ringR*1.12, s*0.02, 0, Math.PI*2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // gooey membrane connecting a dividing cell back to its parent
  function drawDivideNeck(p, pos) {
    if (!pos.parent) return;
    const col = PLAYER_COLORS[p.owner];
    const w = R.tileSize * 0.22 * pos.pinch;
    if (w < 1) return;
    const mx = (pos.x + pos.parent.x) / 2, my = (pos.y + pos.parent.y) / 2;
    ctx.save();
    ctx.fillStyle = col.core;
    ctx.globalAlpha = 0.55 * pos.pinch;
    ctx.beginPath();
    ctx.ellipse(mx, my,
      Math.hypot(pos.x - pos.parent.x, pos.y - pos.parent.y) / 2 + w, w,
      Math.atan2(pos.y - pos.parent.y, pos.x - pos.parent.x), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------- highlights & fx ---------------- */

  function drawHighlights() {
    const s = R.tileSize;
    const pulse = 0.45 + 0.2 * Math.sin(R.time / 250);
    const list = R.targeting ? R.targetTiles : R.legal;
    const color = R.targeting ? "rgba(255,200,60," : "rgba(140,255,180,";
    for (const [c, r] of list) {
      const t = R.G.tile(c, r);
      const lift = visElev(t) * s * ELEV_LIFT;
      const x = R.ox + c * s, y = R.oy + r * s - lift;
      ctx.strokeStyle = color + pulse + ")";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 3, y + 3, s - 6, s - 6);
    }
  }

  // simple transient FX (expanding rings, debris)
  function addFx(kind, c, r) {
    const { x, y } = tileCenter(c, r);
    R.anims.push({ kind, x, y, t0: performance.now() });
    if (kind === "explosion") R.shakes = 14;
  }

  function drawFx(now) {
    R.anims = R.anims.filter(a => now - a.t0 < 650);
    for (const a of R.anims) {
      const k = (now - a.t0) / 650;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      if (a.kind === "explosion" || a.kind === "capture") {
        ctx.strokeStyle = a.kind === "explosion" ? "#ffb347" : "#fff";
        ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(a.x, a.y, R.tileSize * (0.2 + k * 0.7), 0, Math.PI * 2);
        ctx.stroke();
      } else if (a.kind === "power") {
        ctx.strokeStyle = "#7be3ff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(a.x, a.y, R.tileSize * (0.1 + k * 1.1), 0, Math.PI * 2);
        ctx.stroke();
      } else if (a.kind === "orb") {
        ctx.fillStyle = "#fff";
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2 + k * 2;
          ctx.beginPath();
          ctx.arc(a.x + Math.cos(ang) * k * R.tileSize * 0.5,
                  a.y + Math.sin(ang) * k * R.tileSize * 0.5, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  /* ---------------- main frame ---------------- */

  // sliding move animation for a piece (used for clicks, AI, transports).
  // Anything farther than one square floats: the piece lifts off, arcs
  // across the board and sets down, instead of just sliding.
  function animateMove(id, from, to) {
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const float = dist > 1.01;
    R.pieceAnims[id] = {
      fc: from[0], fr: from[1], tc: to[0], tr: to[1],
      t0: performance.now(),
      dur: float ? Math.min(1000, 350 + dist * 110) : 230,
      float,
    };
  }

  // cell-division animation: the offspring buds out of the parent tile,
  // stretching across like a dividing cell before settling on its tile.
  function animateDivide(childId, from, to) {
    R.pieceAnims[childId] = {
      fc: from[0], fr: from[1], tc: to[0], tr: to[1],
      t0: performance.now(), dur: 620, divide: true,
    };
  }

  function animatedPos(p) {
    const a = R.pieceAnims[p.id];
    if (!a) return null;
    const k = (R.time - a.t0) / a.dur;
    if (k >= 1) { delete R.pieceAnims[p.id]; return null; }
    const e = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;  // ease in-out
    const f = tileCenter(a.fc, a.fr), t = tileCenter(a.tc, a.tr);
    const pos = { x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e,
                  scale: 1, floating: false, groundY: 0, pinch: 0 };
    if (a.float) {
      const arc = Math.sin(Math.PI * e);   // 0 -> 1 -> 0 over the flight
      pos.floating = true;
      pos.groundY = pos.y;
      pos.y -= arc * R.tileSize * 0.6;     // lift off the board
      pos.scale = 1 + arc * 0.22;          // closer to the camera
    } else if (a.divide) {
      // grows from a small bud, with a membrane "neck" back to the parent
      pos.scale = 0.35 + 0.65 * e;
      pos.pinch = 1 - e;                    // 1 = fully joined, 0 = separated
      pos.parent = f;
    }
    return pos;
  }

  function frame(now) {
    R.time = now;
    if (!R.G) { requestAnimationFrame(frame); return; }

    // ease tile elevations toward their true values
    for (let c = 0; c < R.G.COLS; c++)
      for (let r = 0; r < R.G.ROWS; r++) {
        const t = R.G.tile(c, r);
        if (t.renderElev === undefined) t.renderElev = t.elev;
        t.renderElev += (t.elev - t.renderElev) * 0.10;
        if (Math.abs(t.elev - t.renderElev) < 0.01) t.renderElev = t.elev;
      }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (R.shakes > 0) {
      ctx.translate((Math.random() - 0.5) * R.shakes, (Math.random() - 0.5) * R.shakes);
      R.shakes *= 0.82;
      if (R.shakes < 0.5) R.shakes = 0;
    }

    // board backdrop plate
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(R.ox - 10, R.oy - 10, R.tileSize * R.G.COLS + 20, R.tileSize * R.G.ROWS + 20);

    // tiles back-to-front, low elevation first so raised tiles overlap
    const order = [];
    for (let c = 0; c < R.G.COLS; c++)
      for (let r = 0; r < R.G.ROWS; r++) order.push([c, r]);
    order.sort((a, b) => visElev(R.G.tile(a[0], a[1])) - visElev(R.G.tile(b[0], b[1])));
    for (const [c, r] of order) drawTile(c, r);

    drawHighlights();

    // pieces, top row first; floating pieces render above everything,
    // and the dragged piece rides the cursor on top of all
    const ps = R.G.pieces
      .filter(p => p.alive && !(R.drag && R.drag.id === p.id))
      .sort((a, b) => a.row - b.row);
    const airborne = [];
    for (const p of ps) {
      const pos = animatedPos(p) || tileCenter(p.col, p.row);
      if (pos.floating) { airborne.push([p, pos]); continue; }
      if (pos.pinch > 0) drawDivideNeck(p, pos);
      drawPiece(p, pos.x, pos.y, pos.scale || 1);
    }
    for (const [p, pos] of airborne) {
      // detached ground shadow tracking the flight path
      const h = (pos.groundY - pos.y) / (R.tileSize * 0.6);  // 0..1 altitude
      ctx.fillStyle = "rgba(0,0,0," + (0.4 - h * 0.22) + ")";
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.groundY + R.tileSize * 0.16,
                  R.tileSize * (0.34 - h * 0.1), R.tileSize * (0.15 - h * 0.05),
                  0, 0, Math.PI * 2);
      ctx.fill();
      drawPiece(p, pos.x, pos.y, pos.scale);
    }
    if (R.drag) {
      const p = R.G.pieces.find(q => q.id === R.drag.id && q.alive);
      if (p) drawPiece(p, R.drag.x, R.drag.y, 1.12);
    }

    drawFx(now);
    ctx.restore();
    requestAnimationFrame(frame);
  }

  /* ---------------- helpers ---------------- */

  function rgb(base, mul) {
    return "rgb(" + base.map(v => Math.max(0, Math.min(255, Math.round(v * mul)))).join(",") + ")";
  }
  function shade(hex, mul) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) * mul, g = ((n >> 8) & 255) * mul, b = (n & 255) * mul;
    return "rgb(" + [r, g, b].map(v => Math.round(Math.min(255, v))).join(",") + ")";
  }

  makeNoise();
  requestAnimationFrame(frame);

  window.QRender = {
    state: R,
    resize,
    pickTile,
    tileCenter,
    addFx,
    animateMove,
    animateDivide,
    setGame(G) {
      R.G = G;
      R.selected = null;
      R.legal = [];
      R.targeting = false;
      R.drag = null;
      R.pieceAnims = {};
      resize();
    },
  };
})();
