/* =============================================================
   Drifting node-link network background.
   Tunables live in CFG. Colours come from the CSS tokens.
   ============================================================= */
(function () {
  var canvas = document.getElementById('network');
  if (!canvas || !canvas.getContext) return;

  var CFG = {
    areaPerNode: 10500,  // one node per N css-pixels² of canvas
    minNodes: 34,
    maxNodes: 160,
    radius: 4,           // plain node radius, px
    pageRadius: 9.5,     // page node radius, px
    linkDist: 215,       // link nodes closer than this
    linkOpacity: 0.6,    // opacity of a zero-length link
    lineWidth: 1,
    speed: 0.5,         // base drift of the plain mesh, px per frame
    pageSpeed: 0.5,     // page nodes drift at this fraction of it

    // Circular well for the page nodes only. Radius is half the canvas height
    // times this factor, so it spans the screen vertically.
    circleScale: 1.0,
    centerPull: 0.02,    // fraction of the overshoot a page home recovers per frame
    pageHome: 0.55,      // page nodes seed within this fraction of the radius

    // Return easing. Fraction of the remaining gap closed per frame. No spring,
    // no velocity, so overshoot is impossible by construction. Lower = slower.
    returnRate: 0.045,
    maxDisplace: 280,    // a node can never be pushed further than this from home

    opacityMin: 0.25,
    opacityMax: 0.75,
    twinkle: 0.0022,
    grabDist: 190,       // cursor reach for the hover "grab" lines
    grabOpacity: 0.5,
    labelSize: 14,
    hitPad: 10,          // extra px around a node that still counts as a hit
    dragSlop: 4,         // movement under this many px counts as a click

    pushRange: 900,      // a held node repels everything within this radius
    pushForce: 3.2,      // push in px/frame at zero distance, falling off with d²
    plainPushScale: 2    // dragging a plain node pushes this much harder than a page node
  };

  var ctx = canvas.getContext('2d');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var nodes = [];
  var W = 0, H = 0;
  var pointer = { x: null, y: null };
  var raf = null;
  var C = readTokens();

  var pages = [];
  try { pages = JSON.parse(canvas.getAttribute('data-pages') || '[]'); } catch (e) { pages = []; }

  var drag = null;
  var hovered = null;

  // ---- performance scaffolding -------------------------------------------
  // Uniform grid with cells the size of linkDist, so a node only has to be
  // tested against its own cell and four neighbours instead of every node.
  // Purely a lookup optimisation: the set of links produced is identical.
  var cells = [], gcols = 0, grows = 0, gcell = 0, goff = 0;

  // Links are bucketed by opacity and each bucket stroked as ONE path. This
  // replaces ~900 stroke() calls per frame (each with its own rgba string to
  // build and parse) with at most LINK_BUCKETS of them. 64 levels is finer
  // than the eye can resolve on a faint hairline.
  // half-neighbourhood offsets, so each cell pair is considered once
  var NEIGH = [[1, 0], [-1, 1], [0, 1], [1, 1]];

  var LINK_BUCKETS = 64;
  var buckets = [], bucketStyle = [];
  for (var bi = 0; bi < LINK_BUCKETS; bi++) { buckets.push([]); bucketStyle.push(''); }
  var styleLine = '';   // cached token so styles are rebuilt only on theme change

  function rebuildStyles() {
    styleLine = C.line;
    for (var i = 0; i < LINK_BUCKETS; i++) {
      var a = CFG.linkOpacity * ((i + 0.5) / LINK_BUCKETS);
      bucketStyle[i] = 'rgba(' + C.line + ',' + a.toFixed(4) + ')';
    }
  }

  function buildGrid() {
    gcell = CFG.linkDist;
    goff = CFG.maxDisplace + CFG.linkDist * 2;
    gcols = Math.max(1, Math.ceil((W + goff * 2) / gcell));
    grows = Math.max(1, Math.ceil((H + goff * 2) / gcell));
    var need = gcols * grows;
    if (cells.length !== need) {
      cells = new Array(need);
      for (var i = 0; i < need; i++) cells[i] = [];
    } else {
      for (var j = 0; j < need; j++) cells[j].length = 0;
    }
    for (var k = 0; k < nodes.length; k++) {
      var nd = nodes[k];
      var cx = ((nd.x + goff) / gcell) | 0;
      var cy = ((nd.y + goff) / gcell) | 0;
      if (cx < 0) cx = 0; else if (cx >= gcols) cx = gcols - 1;
      if (cy < 0) cy = 0; else if (cy >= grows) cy = grows - 1;
      cells[cy * gcols + cx].push(nd);
    }
  }

  function readTokens() {
    var s = getComputedStyle(document.documentElement);
    return {
      node: s.getPropertyValue('--graph-node').trim() || '#17171a',
      line: s.getPropertyValue('--graph-line').trim() || '23, 23, 26',
      hot: s.getPropertyValue('--graph-hot').trim() || '#0e6a5e',
      ink: s.getPropertyValue('--ink').trim() || '#17171a',
      paper: s.getPropertyValue('--paper').trim() || '#fbfaf7',
      font: getComputedStyle(document.body).fontFamily || 'sans-serif'
    };
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // The well: centred on the canvas, radius spans the height.
  function well() {
    return { cx: W / 2, cy: H / 2, r: (H / 2) * CFG.circleScale };
  }

  function radiusOf(n) { return n.page ? CFG.pageRadius : CFG.radius; }

  function clampToCanvas(n) {
    var r = radiusOf(n) + 4;
    n.x = Math.max(r, Math.min(W - r, n.x));
    n.y = Math.max(r, Math.min(H - r, n.y));
  }

  function baseDrift() {
    var a = Math.random() * Math.PI * 2;
    var sp = CFG.speed * (0.35 + Math.random() * 0.9);
    return { x: Math.cos(a) * sp, y: Math.sin(a) * sp };
  }

  function makeNode() {
    var d = baseDrift();
    return {
      x: 0, y: 0,
      hx: 0, hy: 0,                // home: where this node wants to be
      v0x: d.x, v0y: d.y,          // the home's own slow drift
      o: CFG.opacityMin + Math.random() * (CFG.opacityMax - CFG.opacityMin),
      dir: Math.random() < 0.5 ? -1 : 1,
      page: null,
      dragging: false
    };
  }

  function seed() {
    nodes = [];
    var n = Math.max(CFG.minNodes,
            Math.min(CFG.maxNodes, Math.round((W * H) / CFG.areaPerNode)));

    // Plain nodes: jittered grid across the whole canvas, seeded slightly
    // beyond each edge so the mesh bleeds off rather than stopping short.
    var pad = CFG.linkDist * 0.5;
    var gw = W + pad * 2, gh = H + pad * 2;
    var cols = Math.max(1, Math.round(Math.sqrt(n * gw / Math.max(gh, 1))));
    var rows = Math.max(1, Math.ceil(n / cols));
    var cw = gw / cols, ch = gh / rows;

    for (var i = 0; i < n; i++) {
      var node = makeNode();
      var cx = i % cols, cy = Math.floor(i / cols) % rows;
      node.x = -pad + (cx - 0.25 + Math.random() * 1.5) * cw;
      node.y = -pad + (cy - 0.25 + Math.random() * 1.5) * ch;
      node.hx = node.x; node.hy = node.y;
      nodes.push(node);
    }

    var w = well();

    // Page nodes start well inside the well, spread by angle so they do not
    // all pile up in one spot.
    var offset = Math.random() * Math.PI * 2;
    for (var p = 0; p < pages.length; p++) {
      var pn = makeNode();
      pn.page = pages[p];
      var ang = offset + (p / Math.max(1, pages.length)) * Math.PI * 2
                + (Math.random() - 0.5) * 0.7;
      var rr = w.r * CFG.pageHome * Math.sqrt(0.15 + Math.random() * 0.85);
      pn.x = w.cx + Math.cos(ang) * rr;
      pn.y = w.cy + Math.sin(ang) * rr;
      pn.hx = pn.x; pn.hy = pn.y;
      pn.v0x *= CFG.pageSpeed;
      pn.v0y *= CFG.pageSpeed;
      pn.o = 1;
      nodes.push(pn);
    }
  }

  function step() {
    var w = well();

    // A held node repels its neighbourhood. This is a direct displacement in
    // px, not an impulse — nothing accumulates in a velocity that has to be
    // bled off later, which is what used to cause the ringing.
    if (drag) {
      var dn = drag.node;
      // Plain nodes shove harder than page nodes when dragged.
      var force = CFG.pushForce * (dn.page ? 1 : CFG.plainPushScale);
      var pushRangeSq = CFG.pushRange * CFG.pushRange;
      for (var r = 0; r < nodes.length; r++) {
        var rn = nodes[r];
        if (rn === dn || rn.dragging) continue;
        var rdx = rn.x - dn.x, rdy = rn.y - dn.y;
        var rq = rdx * rdx + rdy * rdy;
        if (rq > pushRangeSq) continue;      // squared test, no sqrt for misses
        var rd = Math.sqrt(rq);
        if (rd < 0.001) {              // exactly coincident: pick any direction
          var a0 = Math.random() * Math.PI * 2;
          rdx = Math.cos(a0); rdy = Math.sin(a0); rd = 1;
        }
        var f = 1 - rd / CFG.pushRange;
        f = f * f * force;             // squared falloff: close nodes feel it most
        rn.x += (rdx / rd) * f;
        rn.y += (rdy / rd) * f;
      }
    }

    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];

      // A held node takes its home with it, so releasing it does not yank it
      // back to where it started.
      if (n.dragging) {
        n.hx = n.x; n.hy = n.y;
        continue;
      }

      // --- the home drifts ---
      n.hx += n.v0x;
      n.hy += n.v0y;

      if (n.page) {
        // Page node homes ease back inside the circle when they stray outside.
        var dx = n.hx - w.cx, dy = n.hy - w.cy;
        var d = Math.hypot(dx, dy);
        if (d > w.r && d > 0) {
          var pull = (d - w.r) * CFG.centerPull;
          n.hx -= (dx / d) * pull;
          n.hy -= (dy / d) * pull;
        }
      } else {
        // out_mode "out": the home leaves one edge and re-enters the opposite
        // one. The node is shifted with it so it does not have to travel back
        // across the whole canvas.
        var m = CFG.radius * 2;
        var spanX = W + m * 2, spanY = H + m * 2;
        if (n.hx < -m) { n.hx += spanX; n.x += spanX; }
        else if (n.hx > W + m) { n.hx -= spanX; n.x -= spanX; }
        if (n.hy < -m) { n.hy += spanY; n.y += spanY; }
        else if (n.hy > H + m) { n.hy -= spanY; n.y -= spanY; }
      }

      // --- cap how far a push can carry a node from its home ---
      var ex = n.x - n.hx, ey = n.y - n.hy;
      var ed = Math.sqrt(ex * ex + ey * ey);
      if (ed > CFG.maxDisplace) {
        var sc = CFG.maxDisplace / ed;
        n.x = n.hx + ex * sc;
        n.y = n.hy + ey * sc;
      }

      // --- ease straight back home ---
      // Closing a fixed fraction of the remaining gap each frame: monotone,
      // decelerating, and it can never travel past the target.
      n.x += (n.hx - n.x) * CFG.returnRate;
      n.y += (n.hy - n.y) * CFG.returnRate;

      if (n.page) {
        clampToCanvas(n);
        continue;                      // page nodes stay at full opacity
      }

      n.o += CFG.twinkle * n.dir;
      if (n.o <= CFG.opacityMin) { n.o = CFG.opacityMin; n.dir = 1; }
      else if (n.o >= CFG.opacityMax) { n.o = CFG.opacityMax; n.dir = -1; }
    }
  }

  function nodeAt(x, y) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var d = Math.hypot(n.x - x, n.y - y);
      if (d > radiusOf(n) + CFG.hitPad) continue;
      var score = d - (n.page ? 1000 : 0);   // page nodes win ties
      if (score < bestD) { bestD = score; best = n; }
    }
    return best;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = CFG.lineWidth;

    // ---- links -----------------------------------------------------------
    // Grid traversal: each cell is paired with itself and four neighbours,
    // which covers every unordered pair within linkDist exactly once. Links
    // are collected into opacity buckets and each bucket stroked as one path.
    buildGrid();
    for (var b = 0; b < LINK_BUCKETS; b++) buckets[b].length = 0;

    var maxD = CFG.linkDist, maxDSq = maxD * maxD;
    var scale = (LINK_BUCKETS - 1);

    for (var cy = 0; cy < grows; cy++) {
      for (var cx = 0; cx < gcols; cx++) {
        var A = cells[cy * gcols + cx];
        var na = A.length;
        if (!na) continue;

        // same cell: every unordered pair
        for (var ia = 0; ia < na; ia++) {
          var a1 = A[ia];
          for (var ja = ia + 1; ja < na; ja++) {
            var b1 = A[ja];
            var dx1 = a1.x - b1.x, dy1 = a1.y - b1.y;
            var q1 = dx1 * dx1 + dy1 * dy1;
            if (q1 > maxDSq) continue;
            var t1 = 1 - Math.sqrt(q1) / maxD;
            var k1 = (t1 * scale) | 0;
            buckets[k1].push(a1.x, a1.y, b1.x, b1.y);
          }
        }

        // half the neighbourhood, so no pair is visited twice
        for (var d = 0; d < 4; d++) {
          var ox = NEIGH[d][0], oy = NEIGH[d][1];
          var nx2 = cx + ox, ny2 = cy + oy;
          if (nx2 < 0 || nx2 >= gcols || ny2 < 0 || ny2 >= grows) continue;
          var B = cells[ny2 * gcols + nx2];
          var nb2 = B.length;
          if (!nb2) continue;
          for (var ib = 0; ib < na; ib++) {
            var a2 = A[ib];
            for (var jb = 0; jb < nb2; jb++) {
              var b2 = B[jb];
              var dx2 = a2.x - b2.x, dy2 = a2.y - b2.y;
              var q2 = dx2 * dx2 + dy2 * dy2;
              if (q2 > maxDSq) continue;
              var t2 = 1 - Math.sqrt(q2) / maxD;
              var k2 = (t2 * scale) | 0;
              buckets[k2].push(a2.x, a2.y, b2.x, b2.y);
            }
          }
        }
      }
    }

    for (var bk = 0; bk < LINK_BUCKETS; bk++) {
      var seg = buckets[bk];
      if (!seg.length) continue;
      ctx.strokeStyle = bucketStyle[bk];
      ctx.beginPath();
      for (var sIdx = 0; sIdx < seg.length; sIdx += 4) {
        ctx.moveTo(seg[sIdx], seg[sIdx + 1]);
        ctx.lineTo(seg[sIdx + 2], seg[sIdx + 3]);
      }
      ctx.stroke();
    }

    if (pointer.x !== null && !drag) {
      var grabSq = CFG.grabDist * CFG.grabDist;
      for (var gb = 0; gb < LINK_BUCKETS; gb++) buckets[gb].length = 0;
      for (var k = 0; k < nodes.length; k++) {
        var pnode = nodes[k];
        var gdx = pnode.x - pointer.x, gdy = pnode.y - pointer.y;
        var gq = gdx * gdx + gdy * gdy;
        if (gq > grabSq) continue;
        var gt = 1 - Math.sqrt(gq) / CFG.grabDist;
        var gk = (gt * (LINK_BUCKETS - 1)) | 0;
        buckets[gk].push(pointer.x, pointer.y, pnode.x, pnode.y);
      }
      for (var gbk = 0; gbk < LINK_BUCKETS; gbk++) {
        var gseg = buckets[gbk];
        if (!gseg.length) continue;
        var galpha = CFG.grabOpacity * ((gbk + 0.5) / LINK_BUCKETS);
        ctx.strokeStyle = 'rgba(' + styleLine + ',' + galpha.toFixed(4) + ')';
        ctx.beginPath();
        for (var gi = 0; gi < gseg.length; gi += 4) {
          ctx.moveTo(gseg[gi], gseg[gi + 1]);
          ctx.lineTo(gseg[gi + 2], gseg[gi + 3]);
        }
        ctx.stroke();
      }
    }

    for (var n2 = 0; n2 < nodes.length; n2++) {
      var q = nodes[n2];
      if (q.page) continue;
      var nearR = CFG.grabDist * 0.45, nearSq = nearR * nearR;
      var qdx = q.x - pointer.x, qdy = q.y - pointer.y;
      var near = pointer.x !== null && (qdx * qdx + qdy * qdy) < nearSq;
      ctx.globalAlpha = near ? Math.min(1, q.o + 0.3) : q.o;
      ctx.fillStyle = near ? C.hot : C.node;
      ctx.beginPath();
      ctx.arc(q.x, q.y, CFG.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.font = '500 ' + CFG.labelSize + 'px ' + C.font;
    ctx.textBaseline = 'middle';
    for (var m = 0; m < nodes.length; m++) {
      var g = nodes[m];
      if (!g.page) continue;
      var isHot = g === hovered || (drag && drag.node === g);
      var r = CFG.pageRadius * (isHot ? 1.25 : 1);

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = C.paper;
      ctx.beginPath();
      ctx.arc(g.x, g.y, r + 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = C.hot;
      ctx.beginPath();
      ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
      ctx.fill();

      var label = g.page.title;
      var tw = ctx.measureText(label).width;
      var left = g.x + r + 10 + tw > W - 8;
      var tx = left ? g.x - r - 10 - tw : g.x + r + 10;

      ctx.lineWidth = 3;
      ctx.strokeStyle = C.paper;
      ctx.globalAlpha = 0.85;
      ctx.strokeText(label, tx, g.y);
      ctx.globalAlpha = 1;
      ctx.fillStyle = isHot ? C.hot : C.ink;
      ctx.fillText(label, tx, g.y);
      ctx.lineWidth = CFG.lineWidth;
    }
    ctx.globalAlpha = 1;
  }

  function frame() {
    step();
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    resize();
    seed();
    rebuildStyles();
    hovered = null;
    drag = null;
    if (reduced.matches) { draw(); return; }
    raf = requestAnimationFrame(frame);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          if (raf === null && !reduced.matches) raf = requestAnimationFrame(frame);
        } else if (raf !== null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
      });
    }, { threshold: 0 }).observe(canvas);
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(start, 160);
  });

  function local(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function setCursor() {
    canvas.style.cursor = drag ? 'grabbing'
      : hovered ? (hovered.page ? 'pointer' : 'grab')
      : 'default';
  }

  canvas.addEventListener('pointerdown', function (e) {
    var pt = local(e);
    var hit = nodeAt(pt.x, pt.y);
    if (!hit) return;
    drag = { node: hit, dx: hit.x - pt.x, dy: hit.y - pt.y, moved: 0 };
    hit.dragging = true;
    canvas.style.touchAction = 'none';
    canvas.setPointerCapture(e.pointerId);
    setCursor();
    if (reduced.matches) draw();
  });

  canvas.addEventListener('pointermove', function (e) {
    var pt = local(e);
    pointer.x = pt.x;
    pointer.y = pt.y;

    if (drag) {
      var n0x = drag.node.x, n0y = drag.node.y;
      drag.node.x = pt.x + drag.dx;
      drag.node.y = pt.y + drag.dy;
      if (drag.node.page) clampToCanvas(drag.node);

      drag.moved += Math.hypot(drag.node.x - n0x, drag.node.y - n0y);
      // The push itself happens in step(), so it keeps acting even when the
      // pointer is held still.

      if (reduced.matches) draw();
      return;
    }

    var over = nodeAt(pt.x, pt.y);
    if (over !== hovered) { hovered = over; setCursor(); if (reduced.matches) draw(); }
  });

  function endDrag(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    canvas.style.touchAction = '';
    d.node.dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    if (d.moved < CFG.dragSlop && d.node.page) {
      window.location.href = d.node.page.url;
      return;
    }
    setCursor();
    if (reduced.matches) draw();
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointerleave', function () {
    pointer.x = pointer.y = null;
    hovered = null;
    setCursor();
  });

  reduced.addEventListener('change', start);

  window.addEventListener('themechange', function () {
    C = readTokens();
    rebuildStyles();
    if (reduced.matches) draw();
  });

  start();
})();
