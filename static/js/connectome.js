/* =============================================================
   Homepage connectome: a quiet top-down brain network.

   68 regions (34 per hemisphere) in the 7 canonical networks, a synthetic
   correlation matrix thresholded to its strongest 7% of edges. Everything
   is seeded, so the brain is the same on every visit. Signals travel along
   edges and sometimes cascade on through the arrival region. The hubs carry
   the navigation: one hub per page in site.yaml's nav, with a leader out to
   a label in the margin.

   Tunables live in CFG. Colours and fonts come from the CSS tokens.
   ============================================================= */
(function () {
  var canvas = document.getElementById('connectome');
  if (!canvas || !canvas.getContext) return;

  var CFG = {
    // motion
    breathe: 1.2,        // px of idle drift per region
    pulseEvery: 1.1,     // s, mean gap between new signals
    pulseDur: 1.6,       // s, one signal's travel time along an edge
    maxPulses: 5,        // signals on screen at once
    cascade: 0.6,        // chance a signal continues on from where it arrives
    cascadeDepth: 3,     // edges a signal may travel in a row
    flashFade: 1.4,      // per second: how fast an arrival's glow fades

    // drawing
    edgeWidth: 1.3,
    labelSize: 15,       // px, hub labels
    labelSizeSmall: 12.5, // px, hub labels on small canvases
    hitPadX: 16,         // px of clickable space left/right of a label
    hitPadY: 14,         // px of clickable space above/below a label
    labelSpacing: 1.4,   // px of letter-spacing on hub labels
    leaderWidth: 1.3,
    hubRadius: 6.5,      // px, the ring around a hub
    anchorWeight: 0.45,  // minimum weight of each region's strongest edge (0..1)
    kinkRun: 26,         // px, horizontal run of a leader's angled segment
    kinkRise: 16,        // px, how far a label sits above/below its hub
    hitPad: 12           // extra px around a region that still counts as a hit
  };

  // ==== the network ====================================================

  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    var u = 1 - r(), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Centroids in hemisphere coords (u: midline 0 -> lateral 1,
  // v: anterior 0 -> posterior 1). Several centroids = a split network.
  var MODULES = [
    { name: 'Frontoparietal',    c: [[0.55, 0.16], [0.62, 0.66]] },
    { name: 'Default mode',      c: [[0.14, 0.14], [0.12, 0.66], [0.82, 0.70]] },
    { name: 'Ventral attention', c: [[0.82, 0.30]] },
    { name: 'Limbic',            c: [[0.40, 0.04], [0.94, 0.46]] },
    { name: 'Somatomotor',       c: [[0.42, 0.44], [0.70, 0.44]] },
    { name: 'Dorsal attention',  c: [[0.44, 0.70]] },
    { name: 'Visual',            c: [[0.32, 0.92]] }
  ];
  var SIZES = [5, 6, 4, 4, 6, 4, 5];   // regions per network, per hemisphere
  var DMN = 1, DAN = 5;
  var ASPECT = 0.40;   // u-units -> v-units, makes distances isotropic
  var PER_HEMI = 34;
  var DENSITY = 0.07;

  // Half-ellipse hemisphere, slightly broader towards the back.
  function halfWidth(v) {
    var e = 1 - Math.pow((v - 0.5) / 0.5, 2);
    return e <= 0 ? 0 : Math.sqrt(e) * (0.86 + 0.14 * v);
  }

  // Mitchell's best-candidate sampling: evenly spread, never gridded.
  function sampleHemi(r) {
    var pts = [];
    while (pts.length < PER_HEMI) {
      var best = null, bestD = -1;
      for (var k = 0; k < 24; k++) {
        var v = 0.03 + r() * 0.94;
        var u = 0.06 + r() * 0.94;
        if (u > halfWidth(v) * 0.94) { k--; continue; }
        var d = Infinity;
        for (var i = 0; i < pts.length; i++) {
          var dx = (pts[i].u - u) * ASPECT, dy = pts[i].v - v;
          d = Math.min(d, dx * dx + dy * dy);
        }
        if (d > bestD) { bestD = d; best = { u: u, v: v }; }
      }
      pts.push(best);
    }
    return pts;
  }

  // Greedy capacity-constrained nearest-centroid assignment: networks stay
  // spatially coherent but none ends up with one lonely region.
  function assign(pts) {
    var pairs = [];
    pts.forEach(function (p, i) {
      for (var m = 0; m < MODULES.length; m++) {
        var best = Infinity;
        for (var c = 0; c < MODULES[m].c.length; c++) {
          var cc = MODULES[m].c[c];
          var dx = (cc[0] - p.u) * ASPECT, dy = cc[1] - p.v;
          best = Math.min(best, dx * dx + dy * dy);
        }
        pairs.push({ i: i, m: m, d: best });
      }
    });
    pairs.sort(function (a, b) { return a.d - b.d; });
    var left = SIZES.slice(), done = 0;
    for (var k = 0; k < pairs.length && done < pts.length; k++) {
      var q = pairs[k];
      if (pts[q.i].m !== undefined || left[q.m] === 0) continue;
      pts[q.i].m = q.m; left[q.m]--; done++;
    }
  }

  function buildNetwork() {
    var r = rng(20260913);
    var nodes = [];
    ['L', 'R'].forEach(function (h) {
      var pts = sampleHemi(r);
      assign(pts);
      pts.forEach(function (p) { nodes.push({ u: p.u, v: p.v, hemi: h, m: p.m }); });
    });

    // Canonical order: hemisphere, then network, then anterior -> posterior.
    nodes.sort(function (a, b) {
      return (a.hemi < b.hemi ? -1 : a.hemi > b.hemi ? 1 : 0) ||
             (a.m - b.m) || (a.v - b.v);
    });
    nodes.forEach(function (n, i) { n.i = i; });

    // Correlation-like values from shared network, hemisphere and distance.
    var N = nodes.length, R = [], i, j;
    for (i = 0; i < N; i++) R.push(new Float32Array(N));
    for (i = 0; i < N; i++) {
      for (j = i + 1; j < N; j++) {
        var a = nodes[i], b = nodes[j];
        var same = a.hemi === b.hemi;
        // distance after mirroring b into a's hemisphere
        var dx = (a.u - b.u) * ASPECT, dy = a.v - b.v;
        var d = Math.sqrt(dx * dx + dy * dy);
        var val;
        if (a.m === b.m) val = (same ? 0.62 : 0.50) - (same ? 0.55 : 0.85) * d;
        else if (same) val = 0.16 - 0.45 * d;
        else val = 0.04 - 0.2 * d;
        if ((a.m === DMN && b.m === DAN) || (a.m === DAN && b.m === DMN)) {
          val = -0.22 - 0.1 * r();          // the classic anticorrelation
        }
        val += gauss(r) * 0.07;
        R[i][j] = R[j][i] = Math.max(-0.6, Math.min(0.92, val));
      }
    }

    // Proportional threshold.
    var all = [];
    for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) all.push(R[i][j]);
    all.sort(function (x, y) { return y - x; });
    var thr = all[Math.floor(all.length * DENSITY)];

    var edges = [];
    nodes.forEach(function (n) { n.deg = 0; n.nb = []; n.edges = []; });
    for (i = 0; i < N; i++) {
      for (j = i + 1; j < N; j++) {
        if (R[i][j] <= thr) continue;
        var e = { a: i, b: j, w: Math.min(1, (R[i][j] - thr) / (0.92 - thr)) };
        edges.push(e);
        nodes[i].deg++; nodes[j].deg++;
        nodes[i].nb.push(j); nodes[j].nb.push(i);
        nodes[i].edges.push(e); nodes[j].edges.push(e);
      }
    }
    // The threshold can leave a region with no edges at all; give each such
    // region its single strongest connection so nothing floats alone.
    nodes.forEach(function (n) {
      if (n.deg > 0) return;
      var best = -1, bestR = -Infinity;
      for (var k = 0; k < N; k++) {
        if (k !== n.i && R[n.i][k] > bestR) { bestR = R[n.i][k]; best = k; }
      }
      var e = { a: Math.min(n.i, best), b: Math.max(n.i, best), w: 0 };
      edges.push(e);
      n.deg++; nodes[best].deg++;
      n.nb.push(best); nodes[best].nb.push(n.i);
      n.edges.push(e); nodes[best].edges.push(e);
    });

    // ...and draw every region's strongest connection clearly, so a region
    // whose only edges sit just above the threshold does not look alone.
    nodes.forEach(function (n) {
      var top = n.edges.reduce(function (a, b) { return b.w > a.w ? b : a; });
      top.w = Math.max(top.w, CFG.anchorWeight);
      top.anchor = true;
    });

    var maxDeg = 0;
    nodes.forEach(function (n) { maxDeg = Math.max(maxDeg, n.deg); });
    return { nodes: nodes, edges: edges, maxDeg: maxDeg };
  }

  // ==== state ==========================================================

  var net = buildNetwork();
  var nodes = net.nodes, edges = net.edges;
  var pages = [];
  try { pages = JSON.parse(canvas.getAttribute('data-pages') || '[]'); } catch (e) { pages = []; }

  // One hub per network (so at most seven pages), split evenly between the
  // hemispheres, highest degree first.
  var hubs = [];
  (function () {
    var byDeg = nodes.slice().sort(function (a, b) { return b.deg - a.deg; });
    var usedM = {}, perHemi = { L: 0, R: 0 }, cap = Math.ceil(pages.length / 2);
    for (var k = 0; k < byDeg.length && hubs.length < pages.length; k++) {
      var n = byDeg[k];
      if (usedM[n.m] || perHemi[n.hemi] >= cap) continue;
      usedM[n.m] = true; perHemi[n.hemi]++;
      hubs.push(n);
    }
    hubs.forEach(function (n, i) { n.page = pages[i]; });
  })();

  // idle motion: each region gets its own slow Lissajous wobble
  (function () {
    var r = rng(7);
    nodes.forEach(function (n) {
      n.ph = r() * Math.PI * 2;
      n.f = (2 * Math.PI) / (9 + r() * 7);
      n.side = n.hemi === 'L' ? -1 : 1;
      n.flash = 0;
    });
  })();

  var ctx = canvas.getContext('2d');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var labelPx = CFG.labelSize;
  var W = 0, H = 0, C = null, geo = null, P = [], Q = [], labels = [], outline = [];
  var hovered = null, hoverLabel = null;
  var pulses = [], nextPulse = 0.4;
  var raf = null, t0 = null, tNow = 0, lastT = 0, visible = true;

  function readTokens() {
    var s = getComputedStyle(document.documentElement);
    function g(name, d) { return s.getPropertyValue(name).trim() || d; }
    function rgb(hex) {
      hex = hex.replace('#', '');
      if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
      var n = parseInt(hex, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ');
    }
    var t = {
      ink: g('--ink', '#17171a'), ink2: g('--ink-2', '#4a4a52'), ink3: g('--ink-3', '#7c7c86'),
      paper: g('--paper', '#fbfaf7'), accent: g('--accent', '#0e6a5e'),
      mono: g('--font-mono', 'monospace')
    };
    t.inkRgb = rgb(t.ink); t.accentRgb = rgb(t.accent);
    return t;
  }

  function setLabelFont() {
    ctx.font = '400 ' + labelPx + 'px ' + C.mono;
    if ('letterSpacing' in ctx) ctx.letterSpacing = CFG.labelSpacing + 'px';
  }
  function resetSpacing() { if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; }

  // ==== layout =========================================================

  function layout() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    labelPx = W < 640 ? CFG.labelSizeSmall : CFG.labelSize;
    setLabelFont();
    var widest = 0;
    hubs.forEach(function (n) { widest = Math.max(widest, ctx.measureText(n.page.title.toUpperCase()).width); });
    resetSpacing();

    // narrow, tall canvas: keep the brain large; labels move above/below it.
    // A short canvas (phone held sideways) keeps the labels at the sides.
    var narrow = W < 520 && H > W * 0.9;
    var room = narrow ? Math.min(widest + 24, W * 0.13)
             : W < 640 ? widest + 46 : widest + 30 + CFG.kinkRun + 16;
    var bh = Math.min(H * 0.78, (W - room * 2) / 0.8);
    var bw = bh * 0.8, gap = bw * 0.05, half = bw / 2 - gap;
    var cy = narrow ? H / 2 : H / 2 - H * 0.02;   // stacked: label rows above and below need equal room
    geo = { cx: W / 2, cy: cy, top: cy - bh / 2, bh: bh, bw: bw, gap: gap, half: half };

    P = nodes.map(function (n) {
      return { x: geo.cx + n.side * (gap + n.u * half), y: geo.top + n.v * bh };
    });
    Q = P.map(function (p) { return { x: p.x, y: p.y }; });

    // the two hemispheres, as faint closed outlines
    outline = [-1, 1].map(function (s) {
      var pts = [[geo.cx + s * gap * 0.45, geo.top - 8]];
      for (var k = 1; k <= 80; k++) {
        var v = k / 80;
        pts.push([geo.cx + s * (gap * 0.45 + halfWidth(v) * half * 1.03 + 8 * Math.sin(Math.PI * v)),
                  geo.top - 8 + v * (bh + 16)]);
      }
      pts.push([geo.cx + s * gap * 0.45, geo.top + bh + 8]);
      return pts;
    });

    // Labels sit in the margin, a little above (upper half) or below (lower
    // half) their hub so every leader has a clear angled segment; stacked so
    // they never collide.
    labels = [];
    [-1, 1].forEach(function (s) {
      var side = hubs.filter(function (n) { return n.side === s; })
                     .map(function (n) {
                       var hy = P[n.i].y;
                       return { n: n, y: hy + (hy < geo.cy ? -1 : 1) * CFG.kinkRise };
                     })
                     .sort(function (a, b) { return a.y - b.y; });
      var minGap = labelPx * 3, last = -Infinity;
      side.forEach(function (L) {
        L.y = Math.max(L.y, last + minGap);
        last = L.y;
        var hx = P[L.n.i].x;
        var lx = geo.cx + s * (bw / 2 + Math.min(30, room * 0.2));
        // the angled segment must start outside the hub, never behind it
        lx = s > 0 ? Math.max(lx, hx + CFG.kinkRun + 22) : Math.min(lx, hx - CFG.kinkRun - 22);
        setLabelFont();
        var tw = ctx.measureText(L.n.page.title.toUpperCase()).width;
        resetSpacing();
        if (s > 0) lx = Math.min(lx, W - 12 - tw);      // keep the text on canvas
        else lx = Math.max(lx, 12 + tw);
        L.x = lx; L.side = s; L.tw = tw;
        // generous click target: the labels are far apart anyway
        L.box = { x: (s < 0 ? lx - 8 - tw : lx + 8) - CFG.hitPadX, y: L.y - labelPx / 2 - CFG.hitPadY,
                  w: tw + 2 * CFG.hitPadX, h: labelPx + 2 * CFG.hitPadY };
        labels.push(L);
      });
    });

    // If any label would reach into the brain, the margins are too narrow:
    // put the labels in a row above and a row below the brain instead.
    var outer = bw / 2 + 10;
    var collides = labels.some(function (L) {
      return L.side > 0 ? L.x + 8 < geo.cx + outer : L.x - 8 > geo.cx - outer;
    });
    if (collides) layoutRows();
  }

  // Topmost (side -1) or bottommost (side 1) y of the outline at horizontal
  // distance dx from the midline; beyond the brain's width there is none.
  function outlineEdge(dx, side) {
    var best = side < 0 ? Infinity : -Infinity;
    for (var k = 0; k <= 80; k++) {
      var v = k / 80;
      var ext = geo.gap * 0.45 + halfWidth(v) * geo.half * 1.03 + 8 * Math.sin(Math.PI * v);
      if (ext < dx) continue;
      var y = geo.top - 8 + v * (geo.bh + 16);
      best = side < 0 ? Math.min(best, y) : Math.max(best, y);
    }
    return best;
  }

  // Labels in two rows: the upper hubs above the brain, the lower ones below,
  // each label centred over its hub, then pushed apart and kept on canvas.
  function layoutRows() {
    labels = [];
    var byY = hubs.slice().sort(function (a, b) { return P[a.i].y - P[b.i].y; });
    var half = Math.ceil(byY.length / 2);
    [-1, 1].forEach(function (s) {
      var group = s < 0 ? byY.slice(0, half) : byY.slice(half);
      setLabelFont();
      var row = group.sort(function (a, b) { return P[a.i].x - P[b.i].x; }).map(function (n) {
        return { n: n, x: P[n.i].x, tw: ctx.measureText(n.page.title.toUpperCase()).width, side: s, row: true };
      });
      resetSpacing();
      // spread the row out: first label at the left end, last at the
      // right end, the rest evenly between (in hub order)
      // (on a wide canvas, only somewhat wider than the brain)
      var span = Math.min(W - 24, geo.bw * 1.6);
      var used = row.reduce(function (a, L) { return a + L.tw; }, 0);
      var gapX = row.length > 1 ? (span - used) / (row.length - 1) : 0;
      var x = (W - span) / 2;
      row.forEach(function (L) { L.x = row.length > 1 ? x + L.tw / 2 : W / 2; x += L.tw + gapX; });
      var y = s < 0 ? geo.top - 8 - 40 : geo.top + geo.bh + 8 + 40;
      row.forEach(function (L) {
        // Drop each label from the row line towards its hub, as far as the
        // outline allows: labels out at the sides can sit low beside the
        // curve of the brain, so the row gets varying heights.
        var hubY = P[L.n.i].y;
        var near = Math.max(0, Math.abs(L.x - geo.cx) - L.tw / 2);   // label edge nearest the midline
        var clear = labelPx / 2 + 10;
        var leader = CFG.hubRadius + 3 + CFG.kinkRise + labelPx / 2 + 12;
        var ly = s < 0 ? Math.min(outlineEdge(near, -1) - clear, hubY - leader)
                       : Math.max(outlineEdge(near, 1) + clear, hubY + leader);
        L.y = s < 0 ? Math.max(y, ly) : Math.min(y, ly);
        L.box = { x: L.x - L.tw / 2 - CFG.hitPadX, y: L.y - labelPx / 2 - CFG.hitPadY,
                  w: L.tw + 2 * CFG.hitPadX, h: labelPx + 2 * CFG.hitPadY };
        labels.push(L);
      });
    });
  }

  // ==== motion =========================================================

  function pos(i, t) {
    var n = nodes[i], p = P[i], a = CFG.breathe;
    return { x: p.x + a * Math.sin(t * n.f + n.ph), y: p.y + a * Math.cos(t * n.f * 0.8 + n.ph * 1.3) };
  }

  function spawn(from, viaEdge, depth) {
    var options = nodes[from].edges.filter(function (e) { return e !== viaEdge; });
    if (!options.length || pulses.length >= CFG.maxPulses) return;
    // stronger edges are likelier routes
    var total = 0;
    options.forEach(function (e) { total += 0.3 + e.w; });
    var pick = Math.random() * total, e = options[0];
    for (var k = 0; k < options.length; k++) {
      pick -= 0.3 + options[k].w;
      if (pick <= 0) { e = options[k]; break; }
    }
    pulses.push({ e: e, from: from, t: 0, depth: depth });
  }

  function stepSignals(dt) {
    if (dt <= 0) return;
    nextPulse -= dt;
    if (nextPulse <= 0) {
      spawn(Math.floor(Math.random() * nodes.length), null, 0);
      nextPulse = CFG.pulseEvery * (0.5 + Math.random());
    }
    var arrived = [];
    pulses.forEach(function (p) { p.t += dt / CFG.pulseDur; if (p.t >= 1) arrived.push(p); });
    pulses = pulses.filter(function (p) { return p.t < 1; });
    arrived.forEach(function (p) {
      var to = p.from === p.e.a ? p.e.b : p.e.a;
      nodes[to].flash = 1;
      if (p.depth + 1 < CFG.cascadeDepth && Math.random() < CFG.cascade) spawn(to, p.e, p.depth + 1);
    });
    nodes.forEach(function (n) { if (n.flash > 0) n.flash = Math.max(0, n.flash - CFG.flashFade * dt); });
  }

  // inter-hemispheric edges bow gently through the midline
  function ctrl(A, B) {
    return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 + (geo.cy - (A.y + B.y) / 2) * 0.35 };
  }
  function crosses(e) { return nodes[e.a].hemi !== nodes[e.b].hemi; }
  function edgePath(e, A, B) {
    ctx.moveTo(A.x, A.y);
    if (!crosses(e)) ctx.lineTo(B.x, B.y);
    else { var c = ctrl(A, B); ctx.quadraticCurveTo(c.x, c.y, B.x, B.y); }
  }
  function along(e, A, B, s) {
    if (!crosses(e)) return { x: A.x + (B.x - A.x) * s, y: A.y + (B.y - A.y) * s };
    var c = ctrl(A, B), u = 1 - s;
    return { x: u * u * A.x + 2 * u * s * c.x + s * s * B.x, y: u * u * A.y + 2 * u * s * c.y + s * s * B.y };
  }

  // ==== drawing ========================================================

  function draw(t) {
    var dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    stepSignals(dt);
    ctx.clearRect(0, 0, W, H);
    Q = nodes.map(function (_, i) { return pos(i, t); });

    // the hemispheres, barely there
    ctx.strokeStyle = 'rgba(' + C.inkRgb + ',0.09)';
    ctx.lineWidth = 1;
    outline.forEach(function (pts) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.closePath();
      ctx.stroke();
    });

    var focus = hovered, nbr = {};
    if (focus) { nbr[focus.i] = true; focus.nb.forEach(function (j) { nbr[j] = true; }); }

    // --- edges ---
    ctx.lineWidth = CFG.edgeWidth;
    ctx.lineCap = 'round';
    edges.forEach(function (e) {
      var a = 0.07 + 0.24 * e.w;
      if (crosses(e) && !e.anchor) a *= 0.6;
      var hot = focus && (e.a === focus.i || e.b === focus.i);
      if (focus && !hot) a *= 0.3;
      ctx.strokeStyle = hot ? 'rgba(' + C.accentRgb + ',0.75)' : 'rgba(' + C.inkRgb + ',' + a.toFixed(3) + ')';
      ctx.beginPath(); edgePath(e, Q[e.a], Q[e.b]); ctx.stroke();
    });

    // --- signals ---
    pulses.forEach(function (p) {
      var A = Q[p.e.a], B = Q[p.e.b];
      var env = Math.sin(Math.PI * p.t);
      ctx.strokeStyle = 'rgba(' + C.accentRgb + ',' + (0.55 * env).toFixed(3) + ')';
      ctx.lineWidth = CFG.edgeWidth + 0.4;
      ctx.beginPath(); edgePath(p.e, A, B); ctx.stroke();
      var d = along(p.e, A, B, p.from === p.e.a ? p.t : 1 - p.t);
      ctx.fillStyle = 'rgba(' + C.accentRgb + ',' + Math.max(0.35, env).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(d.x, d.y, 2.4, 0, Math.PI * 2); ctx.fill();
    });

    // --- regions ---
    nodes.forEach(function (n, i) {
      if (n.page) return;
      var q = Q[i];
      var rad = 1.3 + 2.4 * Math.sqrt(n.deg / net.maxDeg) + 1.2 * n.flash;
      ctx.fillStyle = focus && nbr[i] ? C.accent : 'rgba(' + C.inkRgb + ',' + (focus && !nbr[i] ? 0.25 : 0.9) + ')';
      ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, Math.PI * 2); ctx.fill();
      if (n.flash > 0.01 && !focus) {
        ctx.fillStyle = 'rgba(' + C.accentRgb + ',' + n.flash.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, Math.PI * 2); ctx.fill();
      }
    });

    // --- hubs, leaders, labels ---
    setLabelFont();
    ctx.textBaseline = 'middle';
    labels.forEach(function (L) {
      var n = L.n, q = Q[n.i], s = L.side;
      var hot = hovered === n || hoverLabel === L;
      var text = n.page.title.toUpperCase();

      // leader: straight out from the hub, then angled up or down to the label.
      // It starts at the hub's centre; the ring drawn on top hides that part,
      // so line and ring always meet without a gap.
      ctx.strokeStyle = hot ? C.accent : C.ink3;
      ctx.lineWidth = CFG.leaderWidth;
      ctx.beginPath();
      var tx;
      if (L.row) {
        // rows: straight up/down from the hub, then angled to the label
        var end = L.y - s * (labelPx / 2 + 5);
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x, end - s * CFG.kinkRise);
        ctx.lineTo(L.x, end);
        ctx.stroke();
        ctx.textAlign = 'center';
        tx = L.x;
      } else {
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(L.x - s * CFG.kinkRun, q.y);
        ctx.lineTo(L.x, L.y);
        ctx.stroke();
        ctx.textAlign = s < 0 ? 'right' : 'left';
        tx = s < 0 ? L.x - 8 : L.x + 8;
      }
      ctx.lineWidth = 4; ctx.strokeStyle = C.paper;     // halo where it crosses the mesh
      ctx.strokeText(text, tx, L.y + 0.5);
      ctx.fillStyle = hot ? C.accent : C.ink2;
      ctx.fillText(text, tx, L.y + 0.5);

      var r = CFG.hubRadius + (hot ? 1 : 0) + 1.5 * n.flash;
      ctx.fillStyle = C.paper;
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.7;
      ctx.stroke();
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(q.x, q.y, CFG.hubRadius * 0.45, 0, Math.PI * 2); ctx.fill();
    });
    resetSpacing();

    ctx.textAlign = 'left';
  }

  // ==== loop ===========================================================
  // Runs while visible; a single static frame under reduced motion.

  function frame(now) {
    if (t0 === null) t0 = now - tNow * 1000;
    tNow = (now - t0) / 1000;
    draw(tNow);
    raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf !== null) cancelAnimationFrame(raf); raf = null; t0 = null; }
  function go() {
    stop();
    if (reduced.matches || !visible) { lastT = tNow; draw(tNow); return; }
    raf = requestAnimationFrame(frame);
  }
  function redraw() { if (reduced.matches) { lastT = tNow; draw(tNow); } }

  // Re-measure whenever the canvas box changes (window resize, zoom, late
  // CSS, a scrollbar appearing), so the drawing is never stretched or blurry.
  var resizeTimer, lastSize = '';
  function relayout() {
    var rc = canvas.getBoundingClientRect();
    var key = rc.width + 'x' + rc.height + '@' + (window.devicePixelRatio || 1);
    if (key === lastSize) return;
    lastSize = key;
    layout(); lastT = tNow; draw(tNow); go();
  }
  function scheduleRelayout() { clearTimeout(resizeTimer); resizeTimer = setTimeout(relayout, 60); }
  window.addEventListener('resize', scheduleRelayout);
  if ('ResizeObserver' in window) new ResizeObserver(scheduleRelayout).observe(canvas);
  window.addEventListener('themechange', function () { C = readTokens(); lastT = tNow; draw(tNow); });
  reduced.addEventListener('change', go);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; go(); }).observe(canvas);
  }

  // ==== pointer ========================================================

  function local(e) {
    var rc = canvas.getBoundingClientRect();
    return { x: e.clientX - rc.left, y: e.clientY - rc.top };
  }
  function hit(pt) {
    for (var k = 0; k < labels.length; k++) {
      var b = labels[k].box;
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) {
        return { label: labels[k], node: labels[k].n };
      }
    }
    var best = null, bd = CFG.hitPad;
    nodes.forEach(function (n, i) {
      var d = Math.hypot(Q[i].x - pt.x, Q[i].y - pt.y);
      if (d < bd || (n.page && d < bd + 4)) { bd = d; best = n; }
    });
    return best ? { node: best, label: null } : null;
  }

  canvas.addEventListener('pointermove', function (e) {
    var h = hit(local(e));
    hovered = h ? h.node : null;
    hoverLabel = h ? h.label : null;
    canvas.style.cursor = hovered && hovered.page ? 'pointer' : 'default';
    redraw();
  });
  canvas.addEventListener('pointerleave', function () {
    hovered = hoverLabel = null;
    redraw();
  });
  canvas.addEventListener('click', function (e) {
    var h = hit(local(e));
    if (h && h.node.page) window.location.href = h.node.page.url;
  });

  C = readTokens();
  layout();
  lastSize = canvas.getBoundingClientRect().width + 'x' + canvas.getBoundingClientRect().height +
             '@' + (window.devicePixelRatio || 1);
  draw(0);      // paint synchronously so there is never a blank frame
  go();
})();
