(function () {
  'use strict';

  var D = window.RADAR;
  var doc = document;

  function $(id) { return doc.getElementById(id); }
  function txt(s) { return doc.createTextNode(s == null ? '' : String(s)); }
  function el(tag, attrs) {
    var node = doc.createElement(tag), i, k, v;
    if (attrs) for (k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;            // callers pass literals only
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (i = 2; i < arguments.length; i++) add(node, arguments[i]);
    return node;
  }
  function add(node, c) {
    var j;
    if (c === null || c === undefined || c === false) return node;
    if (Array.isArray(c)) { for (j = 0; j < c.length; j++) add(node, c[j]); return node; }
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? txt(c) : c);
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n), s = n < 0 ? '−' : '$';
    if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e8) return s + (a / 1e6).toFixed(0) + 'M';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + Math.round(a / 1e3) + 'K';
    return s + Math.round(a);
  }
  function money3(n) {  // three decimals in the billions, for the audit trail
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(3) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    return money(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + '%';
  }
  function cash(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '−' : '+') + '$' + Math.abs(n).toFixed(2);
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    if (days >= 90) return Math.round(days / 30) + 'mo';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function x(n) { return '×' + n.toFixed(3); }
  function axLabel(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(0) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(0) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(0) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (p, q) { return p - q; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantile(a, p) {
    if (!a.length) return null;
    var s = a.slice().sort(function (q, r) { return q - r; });
    return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  }

  if (!D || !Array.isArray(D.rows) || !D.rows.length) {
    doc.body.classList.add('no-data');
    var body = $('rows');
    if (body) body.appendChild(el('tr', null, el('td', { colspan: '7', class: 'empty' },
      'No snapshot found beside this page. Run main.ts to write data.js, then reload — nothing here is fetched over the network.')));
    ['kpis', 'eq', 'params', 'comps-chart', 'comps-stats', 'comps-note', 'hist', 'hist-axis',
     'shape-stats', 'count', 'live', 'live-more'].forEach(function (id) {
      var n = $(id); if (n) n.textContent = '';
    });
    return;
  }

  var F = D.fit || {};
  var M = D.model || {};
  var P = {
    a: num(F.a, 0),
    b: num(F.b, 1),
    c: num(F.c, 0),
    d: num(F.d, 0),
    n: num(F.n, 0),
    r2: num(F.r2, 0),
    ua: num(M.unknown_age_days, 180)
  };
  var BAND = D.band || { low_multiplier: 1, high_multiplier: 1 };
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function bandOf() { return '×' + BAND.low_multiplier.toFixed(2) + '–×' + BAND.high_multiplier.toFixed(2); }

  var state = { q: '', cat: '', view: 'all', key: 'rank', dir: 1, sel: null };
  var histBars = [], histLo = 0, histW = 1, histBins = 22;
  var cur = [];
  var index = Object.create(null);

  function parts(r) {
    var g = r.change_7d === null || r.change_7d === undefined ? 0 : r.change_7d;
    var gc = Math.min(150, Math.max(-50, g));
    var a = r.age_days === null || r.age_days === undefined ? P.ua : r.age_days;
    return { g: g, gc: gc, a: a, ay: a / 365 };
  }
  function implied(r) {
    var p = parts(r);
    if (!(r.tvl_usd > 0)) return 1;
    return Math.max(1, Math.round(Math.exp(P.a + P.b * Math.log(r.tvl_usd) + P.c * (p.gc / 100) + P.d * Math.log1p(p.ay))));
  }

  var rows = D.rows.slice();
  var byTvl = rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
  byTvl.forEach(function (r, i) { r._tvlRank = i + 1; });

  rows.forEach(function (r) {
    var p = parts(r);
    r._g = r.change_7d === null || r.change_7d === undefined ? null : r.change_7d;
    r._imp = implied(r);
    r._raw = r.implied_value_usd;
    r._lo = Math.max(1, Math.round(r._imp * BAND.low_multiplier));
    r._hi = Math.max(1, Math.round(r._imp * BAND.high_multiplier));
    var prevTvl = r.change_7d === null || r.change_7d === undefined ? r.tvl_usd : r.tvl_usd / (1 + p.g / 100);
    r._prev = prevTvl > 0
      ? Math.max(1, Math.round(Math.exp(P.a + P.b * Math.log(prevTvl) + P.c * (p.gc / 100) + P.d * Math.log1p(p.ay))))
      : r._imp;
    r._delta = r._imp - r._prev;
    r._cat = r.category || 'Other';
    r._chains = Array.isArray(r.chains) ? r.chains : [];
    r._why = why(r);
    index[r.slug] = r;
  });

  function why(r) {
    var seg = [];
    if (r._tvlRank === 1) seg.push('largest TVL on the board');
    seg.push('band ' + bandOf());
    seg.push('net EV ' + cash(r.net_ev_usd));
    if (r._chains.length > 1) seg.push(r._chains.length + ' chains');
    return seg.join(' · ');
  }

  var comps = (D.live || []).filter(function (l) {
    return l && l.tvl_usd > 0 && l.mcap_usd > 0;
  }).map(function (l) { return { name: l.name, tvl: l.tvl_usd, mcap: l.mcap_usd, m: l.mcap_usd / l.tvl_usd }; });

  var fit = null, compsMedian = null, compsQ1 = null, compsQ3 = null;
  if (comps.length >= 8) {
    var xs = comps.map(function (c) { return Math.log(c.tvl); });
    var ys = comps.map(function (c) { return Math.log(c.mcap); });
    var n = xs.length, mx = 0, my = 0, i, sxx = 0, sxy = 0, sse = 0, sst = 0;
    for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    for (i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); }
    var slope = sxx ? sxy / sxx : 0, inter = my - slope * mx;
    for (i = 0; i < n; i++) {
      var pred = inter + slope * xs[i];
      sse += (ys[i] - pred) * (ys[i] - pred);
      sst += (ys[i] - my) * (ys[i] - my);
    }
    fit = { slope: slope, inter: inter, r2: sst ? 1 - sse / sst : 0, n: n };
    var mult = comps.map(function (c) { return c.m; });
    compsMedian = median(mult);
    compsQ1 = quantile(mult, 0.25);
    compsQ3 = quantile(mult, 0.75);
  }

  var totalImp = rows.reduce(function (s, r) { return s + r._imp; }, 0);
  var top10 = rows.slice().sort(function (a, b) { return b._imp - a._imp; }).slice(0, 10)
    .reduce(function (s, r) { return s + r._imp; }, 0);
  var medImp = median(rows.map(function (r) { return r._imp; }));
  var cats = {};
  rows.forEach(function (r) { cats[r._cat] = (cats[r._cat] || 0) + 1; });

  (function kpis() {
    var box = $('kpis');
    var deals = [
      [D.board_size || rows.length, 'rows ranked'],
      [D.watchlist_size != null ? D.watchlist_size : rows.filter(function (r) { return r.on_watchlist; }).length, 'on watchlist'],
      [D.early_size != null ? D.early_size : rows.filter(function (r) { return !r.on_watchlist; }).length, 'early finds'],
      [D.live_size != null ? D.live_size : (D.live || []).length, 'live, not ranked']
    ];
    deals.forEach(function (d) {
      box.appendChild(el('div', { class: 'kpi' }, el('dt', { text: d[1] }), el('dd', { text: String(d[0]) })));
    });
  })();

  (function modelPanel() {
    var eq = $('eq');
    add(eq, [
      txt('mcap = exp('), el('b', { text: String(P.a) }), txt(') × TVL^'), el('b', { text: String(P.b) }), txt('\n'),
      txt('       × exp('), el('b', { text: String(P.c) }), txt(' × clamp(change_7d, -50, 150) / 100)\n'),
      txt('       × (1 + age_years)^'), el('b', { text: String(P.d) })
    ]);

    var params = $('params');
    [
      ['a', String(P.a)],
      ['b on log TVL', String(P.b)],
      ['c on growth', String(P.c)],
      ['d on log1p(age)', String(P.d)],
      ['n', P.n + ' comps'],
      ['R²', String(P.r2)],
      ['band', bandOf()],
      ['unknown age', P.ua + 'd'],
      ['floor', money(D.floor_usd || 0)]
    ].forEach(function (p) {
      params.appendChild(el('span', { class: 'param' }, txt(p[0]), el('b', { text: p[1] })));
    });

    var top = rows.slice().sort(function (a, b) { return a.rank - b.rank; })[0];
    if (top) {
      var pt = parts(top);
      $('worked').appendChild(el('span', { class: 'lbl', text: 'worked example' }));
      $('worked').appendChild(txt(top.name + ': exp(' + P.a + ' + ' + P.b + '×log ' + money(top.tvl_usd) +
        ' + ' + P.c + '×' + (pt.gc / 100).toFixed(4) + ' + ' + P.d + '×' + Math.log1p(pt.ay).toFixed(3) + ') = '));
      $('worked').appendChild(el('b', { text: money3(top._imp) }));
    }
  })();

  (function compsPanel() {
    if (!fit) {
      $('comps-chart').appendChild(el('p', { class: 'note', text: 'The snapshot records no live protocol with both a TVL and a market cap, so there is nothing to compare against.' }));
      $('comps-stats').remove();
      $('comps-note').remove();
      $('comps-tag').textContent = 'no comps';
      return;
    }
    $('comps-tag').textContent = fit.n + ' live protocols';

    [
      [compsMedian.toFixed(2) + '×', 'median cap / TVL', true],
      [fit.slope.toFixed(2), 'fit slope (log)', false],
      ['R² ' + fit.r2.toFixed(2), 'variance explained', false]
    ].forEach(function (s) {
      $('comps-stats').appendChild(el('div', null,
        el('dt', { text: s[1] }),
        el('dd', { class: s[2] ? 'acc' : '', text: s[0] })));
    });

    $('comps-note').textContent =
      'Each dot is one live protocol: cap on the vertical, TVL on the horizontal, both log. ' +
      'TVL sets the scale, but the cap/TVL multiple runs from ' + compsQ1.toFixed(2) + '× to ' + compsQ3.toFixed(2) +
      '× in the middle half, so the fitted line sets the level and the residual band, not a price target.';

    drawScatter();
    if (window.ResizeObserver) {
      var t = null;
      new ResizeObserver(function () {
        clearTimeout(t);
        t = setTimeout(drawScatter, 120);
      }).observe($('comps-chart'));
    } else {
      window.addEventListener('resize', drawScatter);
    }
  })();

  var lastW = 0, lastH = 0;
  function drawScatter(force) {
    var box = $('comps-chart');
    if (!box || !fit) return;
    var W = Math.max(260, box.clientWidth || 380);
    var H = Math.max(104, box.clientHeight || 120);
    if (!force && W === lastW && H === lastH && box.firstChild) return;  // no resize, no redraw
    lastW = W; lastH = H;
    clear(box);
    var padL = 34, padR = 8, padT = 16, padB = 16;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var lx = comps.map(function (c) { return Math.log10(c.tvl); });
    var ly = comps.map(function (c) { return Math.log10(c.mcap); });
    var x0 = Math.floor(Math.min.apply(null, lx)), x1 = Math.ceil(Math.max.apply(null, lx));
    var y0 = Math.floor(Math.min.apply(null, ly)), y1 = Math.ceil(Math.max.apply(null, ly));
    if (x1 - x0 < 2) x1 = x0 + 2;
    if (y1 - y0 < 2) y1 = y0 + 2;

    var px = function (lv) { return padL + (lv - x0) / (x1 - x0) * plotW; };
    var py = function (lv) { return padT + plotH - (lv - y0) / (y1 - y0) * plotH; };

    var ns = 'http' + ':' + '//www.w3.org/2000/svg';
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Market cap against TVL for ' + fit.n + ' live protocols on log axes, with the fitted power curve and the radar base multiple');
    function mk(tag, attrs, text) {
      var n = doc.createElementNS(ns, tag), k;
      for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
      if (text != null) n.textContent = text;
      svg.appendChild(n);
      return n;
    }

    var stepX = (x1 - x0) > 4 ? 2 : 1, i;
    for (i = x0; i <= x1; i += stepX) {
      mk('line', { x1: px(i), x2: px(i), y1: padT, y2: padT + plotH, stroke: '#161e2b', 'stroke-width': 1 });
      mk('text', {
        x: px(i), y: H - 4, fill: '#8b96a8', 'font-size': 10.5, 'font-family': 'ui-monospace,monospace',
        'text-anchor': 'middle'
      }, '$' + axLabel(Math.pow(10, i)));
    }
    var stepY = (y1 - y0) > 4 ? 2 : 1;
    for (i = y0; i <= y1; i += stepY) {
      mk('line', { x1: padL, x2: W - padR, y1: py(i), y2: py(i), stroke: '#161e2b', 'stroke-width': 1 });
      mk('text', {
        x: padL - 6, y: py(i) + 3, fill: '#8b96a8', 'font-size': 10.5, 'font-family': 'ui-monospace,monospace',
        'text-anchor': 'end'
      }, '$' + axLabel(Math.pow(10, i)));
    }

    function refLine(c, m, color, dash, width, label) {
      var a = Math.max(x0, (y0 - c) / m), b = Math.min(x1, (y1 - c) / m);
      if (!(b > a)) return;
      mk('line', {
        x1: px(a), y1: py(c + m * a), x2: px(b), y2: py(c + m * b),
        stroke: color, 'stroke-width': width, 'stroke-dasharray': dash
      });
      if (label) {
        var lxp = px(b), lyp = py(c + m * b) - 4;
        mk('text', {
          x: lxp - 2, y: Math.max(padT + 7, lyp), fill: color, 'font-size': 9.5,
          'font-family': 'ui-monospace,monospace', 'text-anchor': 'end'
        }, label);
      }
    }

    refLine(P.a / Math.LN10, P.b, 'rgba(201,245,106,0.5)', '2 4', 1.2, 'model TVL^' + P.b);
    refLine(fit.inter / Math.LN10, fit.slope, 'rgba(124,201,239,0.85)', '6 4', 1.4, 'tvl-only fit');

    comps.forEach(function (c, j) {
      mk('circle', {
        cx: px(lx[j]).toFixed(1), cy: py(ly[j]).toFixed(1), r: 2.4,
        fill: '#7cc9ef', 'fill-opacity': 0.55
      });
    });

    mk('text', { x: padL, y: 9, fill: '#8b96a8', 'font-size': 9.5, 'font-family': 'ui-monospace,monospace' }, 'market cap');
    mk('text', { x: W - padR, y: padT + plotH + 12, fill: '#8b96a8', 'font-size': 9.5, 'font-family': 'ui-monospace,monospace', 'text-anchor': 'end' }, 'TVL →');

    box.appendChild(svg);
  }

  (function shapePanel() {
    var hist = $('hist'), axis = $('hist-axis'), stats = $('shape-stats');
    var vals = rows.map(function (r) { return r._imp; });
    var lo = Math.log10(Math.min.apply(null, vals)), hi = Math.log10(Math.max.apply(null, vals));
    var bins = 22, counts = new Array(bins).fill(0), w = (hi - lo) / bins || 1;
    vals.forEach(function (v) {
      var b = Math.min(bins - 1, Math.max(0, Math.floor((Math.log10(v) - lo) / w)));
      counts[b]++;
    });
    var peak = Math.max.apply(null, counts) || 1;
    histLo = lo; histW = w; histBins = bins; histBars = [];
    counts.forEach(function (c, i) {
      var a = Math.pow(10, lo + i * w), b = Math.pow(10, lo + (i + 1) * w);
      var bar = el('div', {
        class: 'bar' + (c ? '' : ' is-empty'),
        style: 'height:' + Math.max(2, (c / peak) * 100) + '%',
        title: money(a) + ' – ' + money(b) + ': ' + c + ' row' + (c === 1 ? '' : 's')
      });
      histBars.push(bar);
      hist.appendChild(bar);
    });
    var medPos = (Math.log10(medImp) - lo) / (hi - lo || 1);
    hist.appendChild(el('div', { class: 'med', style: 'left:' + (medPos * 100).toFixed(1) + '%' }));

    axis.appendChild(el('span', { text: money(Math.pow(10, lo)) }));
    axis.appendChild(el('span', { class: 'hi', text: money(Math.pow(10, hi)) }));
    axis.appendChild(el('span', {
      class: 'm', style: 'left:' + (medPos * 100).toFixed(1) + '%',
      text: 'median ' + money(medImp)
    }));

    [
      [money(totalImp), 'total implied', true],
      [Math.round(top10 / totalImp * 100) + '%', 'held by top 10', false],
      [String(Object.keys(cats).length), 'categories', false]
    ].forEach(function (s) {
      stats.appendChild(el('div', null, el('dt', { text: s[1] }), el('dd', { class: s[2] ? 'acc' : '', text: s[0] })));
    });
    $('shape-tag').textContent = rows.length + ' rows';
  })();

  (function controls() {
    var sel = $('cat');
    Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a] || a.localeCompare(b); }).forEach(function (c) {
      sel.appendChild(el('option', { value: c, text: c + ' (' + cats[c] + ')' }));
    });
    sel.addEventListener('change', function (e) { state.cat = e.target.value; draw(); });

    var q = $('q');
    q.addEventListener('input', function (e) { state.q = e.target.value; draw(); });

    var views = $('views');
    views.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]');
      if (!b) return;
      state.view = b.getAttribute('data-view');
      [].forEach.call(views.querySelectorAll('button'), function (x2) {
        x2.setAttribute('aria-pressed', String(x2 === b));
      });
      draw();
    });

    $('n-all').textContent = rows.length;
    $('n-watch').textContent = rows.filter(function (r) { return r.on_watchlist; }).length;
    $('n-early').textContent = rows.filter(function (r) { return !r.on_watchlist; }).length;

    [].forEach.call(doc.querySelectorAll('.board thead th[data-key]'), function (th) {
      th.querySelector('button').addEventListener('click', function () {
        var k = th.getAttribute('data-key');
        if (state.key === k) state.dir = -state.dir;
        else { state.key = k; state.dir = k === 'rank' || k === 'name' || k === 'category' ? 1 : -1; }
        draw();
      });
    });
  })();

  function visible() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.cat && r._cat !== state.cat) return false;
      if (state.view === 'watch' && !r.on_watchlist) return false;
      if (state.view === 'early' && r.on_watchlist) return false;
      if (!q) return true;
      var hay = r.name + ' ' + r.slug + ' ' + r._cat + ' ' + r._chains.join(' ');
      return hay.toLowerCase().indexOf(q) >= 0;
    });
  }

  var ACCESS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    category: function (r) { return r._cat.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r._g === null ? -1e9 : r._g; },
    age: function (r) { return r.age_days === null || r.age_days === undefined ? -1 : r.age_days; },
    implied: function (r) { return r._imp; }
  };

  function sortList(list) {
    var acc = ACCESS[state.key] || ACCESS.rank, dir = state.dir;
    return list.sort(function (a, b) {
      var av = acc(a), bv = acc(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.rank - b.rank;
    });
  }

  function markSort() {
    [].forEach.call(doc.querySelectorAll('.board thead th[data-key]'), function (th) {
      var on = th.getAttribute('data-key') === state.key;
      th.setAttribute('aria-sort', on ? (state.dir === 1 ? 'ascending' : 'descending') : 'none');
    });
  }

  function drawRows() {
    var body = $('rows'), frag = doc.createDocumentFragment();
    cur = sortList(visible());
    clear(body);

    if (!cur.length) {
      body.appendChild(el('tr', null, el('td', { colspan: '7', class: 'empty' },
        'No row matches that filter. Clear the search or pick another category.')));
    }

    cur.forEach(function (r) {
      var g = r._g;
      var barW = g === null ? 0 : Math.min(50, Math.abs(g) * 3);
      var tr = el('tr', {
        'data-slug': r.slug,
        tabindex: r.slug === state.sel ? '0' : '-1',
        'aria-selected': r.slug === state.sel ? 'true' : 'false',
        class: r.slug === state.sel ? 'sel' : ''
      },
        el('td', { class: 'c-rank num', text: String(r.rank) }),
        el('td', { class: 'c-name' },
          el('div', { class: 'nm' },
            el('span', { class: 'dot' + (r.on_watchlist ? '' : ' off'), title: r.on_watchlist ? 'on the watchlist' : null }),
            el('span', { class: 't', text: r.name })),
          el('span', { class: 'why', text: r._why, title: r._why })),
        el('td', { class: 'c-cat' }, el('span', { class: 'cat-pill', text: r._cat, title: r._cat })),
        el('td', { class: 'c-num num', text: money(r.tvl_usd) }),
        el('td', { class: 'c-num num ' + (g === null ? 'flat' : g > 0 ? 'up' : g < 0 ? 'down' : 'flat') },
          el('span', { text: pct(g) }),
          el('span', { class: 'gbar' }, el('i', { class: g < 0 ? 'neg' : '', style: 'width:' + barW + '%' }))),
        el('td', { class: 'c-num num', text: age(r.age_days) }),
        el('td', { class: 'c-num num imp' }, txt(money(r._imp)), el('span', { class: 'why', text: ' ' + bandOf() }))
      );
      frag.appendChild(tr);
    });
    body.appendChild(frag);

    $('count').textContent = cur.length === rows.length
      ? rows.length + ' rows · ' + money(totalImp) + ' implied'
      : cur.length + ' of ' + rows.length + ' rows · ' + money(cur.reduce(function (s, r) { return s + r._imp; }, 0)) + ' implied';
    markSort();
  }

  function draw() {
    drawRows();
    if (cur.length && !cur.some(function (r) { return r.slug === state.sel; })) {
      select(cur[0].slug, { scroll: true });
    }
  }

  function select(slug, opts) {
    var r = index[slug];
    if (!r) return;
    state.sel = slug;
    [].forEach.call($('rows').children, function (tr) {
      var on = tr.getAttribute('data-slug') === slug;
      tr.classList.toggle('sel', on);
      tr.setAttribute('aria-selected', on ? 'true' : 'false');
      tr.tabIndex = on ? 0 : -1;
      if (on && opts && opts.focus) tr.focus();
      if (on && opts && opts.scroll) tr.scrollIntoView({ block: 'nearest' });
    });
    renderCase(r);
    markHistBin(r._imp);
    if (history.replaceState) history.replaceState(null, '', '#' + slug);
  }

  function markHistBin(v) {
    if (!histBars.length) return;
    var b = Math.min(histBins - 1, Math.max(0, Math.floor((Math.log10(v) - histLo) / histW)));
    histBars.forEach(function (bar, i) { bar.classList.toggle('is-sel', i === b); });
  }

  function renderCase(r) {
    var side = $('side');
    clear(side);
    var box = el('div', { class: 'side-inner' });

    box.appendChild(el('div', { class: 'side-head' },
      el('span', { class: 'rank-chip', text: '#' + r.rank }),
      r.on_watchlist
        ? el('span', { class: 'watch-chip', text: 'watchlist' })
        : el('span', { class: 'watch-chip quiet', text: 'early find' }),
      el('span', { class: 'chains', text: r._chains.length ? r._chains.join(' · ') : 'chain not recorded', title: r._chains.join(', ') })
    ));

    box.appendChild(el('h3', { text: r.name }));
    box.appendChild(el('p', { class: 'lead', text: lead(r) }));

    box.appendChild(el('div', { class: 'bigline' },
      el('span', { class: 'big', text: money(r._imp) }),
      el('span', { class: 'delta ' + (r._delta > 0 ? 'up' : r._delta < 0 ? 'down' : ''),
        text: (r._delta >= 0 ? '+' : '−') + money(Math.abs(r._delta)).replace('$', '$') + ' on the week' })
    ));
    box.appendChild(el('p', { class: 'cap', text: 'implied value if a token launched on today’s record' }));

    var calc = el('table', { class: 'calc' },
      el('tr', null, el('th', { colspan: '2', text: 'the arithmetic' })),
      el('tr', null,
        el('td', null, txt('TVL ' + money(r.tvl_usd) + ' · 7d ' + pct(r._g) + ' · age ' + age(r.age_days))),
        el('td', { text: 'log ' + Math.log(r.tvl_usd).toFixed(2) })),
      el('tr', null,
        el('td', null, txt('exp(' + P.a + ' + ' + P.b + '·log TVL + ' + P.c + '·g/100 + ' + P.d + '·log1p(age/365))')),
        el('td', { text: 'R² ' + P.r2 })),
      el('tr', null,
        el('td', null, txt('80% band ' + bandOf())),
        el('td', { text: money(r._lo) + ' – ' + money(r._hi) })),
      el('tr', { class: 'total' },
        el('td', null, txt('implied value '), el('span', { class: 'ok', text: '✓' })),
        el('td', { text: money(r._imp) }))
    );
    box.appendChild(calc);

    box.appendChild(el('h4', null, txt('plan economics'),
      el('span', { class: 'fine', text: '120-day farm plan' })));
    box.appendChild(el('table', { class: 'calc' },
      el('tr', null, el('td', { text: 'deposit' }), el('td', { text: money(r.deposit_usd) })),
      el('tr', null, el('td', { text: 'fees (gas, bridge, slippage)' }), el('td', { text: '$' + r.fees_usd.toFixed(2) })),
      el('tr', null, el('td', { text: 'net EV' }), el('td', { text: cash(r.net_ev_usd) })),
      el('tr', null, el('td', { text: 'break-even FDV' }), el('td', { text: r.break_even_usd ? money(r.break_even_usd) : 'carry covers fees' }))
    ));

    if (r._raw !== r._imp) {
      box.appendChild(el('p', { class: 'note', style: 'color:var(--red);margin-top:7px' },
        'The board records ' + money(r._raw) + ' for this row; the page and the board disagree.'));
    }

    if (compsMedian) {
      var cv = r.tvl_usd * compsMedian;
      box.appendChild(el('h4', null, txt('market context'),
        el('span', { class: 'fine', text: comps.length + ' live comps' })));
      box.appendChild(el('div', { class: 'premium' },
        el('span', { text: 'median ' + compsMedian.toFixed(2) + '× TVL on same TVL' }), el('b', { text: money(cv) })));
      box.appendChild(el('div', { class: 'premium' },
        el('span', { text: 'this row against that median' }), el('b', { text: (r._imp / cv).toFixed(2) + '×' })));
    }

    var steps = Array.isArray(r.farm_steps) ? r.farm_steps : [];
    var spend = farmTotals(steps);
    box.appendChild(el('h4', null, txt('farm plan'),
      el('span', { class: 'fine', text: steps.length + ' steps' + (spend.capital ? ' · ' + money(spend.capital) + ' capital' : '') + (spend.fees ? ' · ~' + money(spend.fees) + ' fees' : '') })));

    if (steps.length) {
      var tags = el('div', { class: 'plan-tags' });
      stepTags(steps).forEach(function (t) { tags.appendChild(el('span', { text: t })); });
      box.appendChild(tags);
    }

    var ol = el('ol', { class: 'steps' });
    steps.forEach(function (s) {
      var sp = splitStep(s);
      var meta = el('div', { class: 'meta' });
      if (sp.cost) meta.appendChild(el('span', { class: 'cost', text: 'cost: ' + shortCost(sp.cost), title: sp.cost }));
      if (sp.time) meta.appendChild(el('span', { class: 'time', text: 'time: ' + sp.time }));
      if (/each week|every week|a week/i.test(sp.time + ' ' + sp.cost)) meta.appendChild(el('span', { class: 'wk', text: 'weekly' }));
      ol.appendChild(el('li', null, el('p', { class: 'act', text: sp.act }), meta));
    });
    box.appendChild(ol);
    side.appendChild(box);
  }

  function lead(r) {
    var s = '#' + r.rank + ' of ' + rows.length + ' · ' + money(r.tvl_usd) + ' TVL';
    if (r.age_days !== null && r.age_days !== undefined) s += ' · ' + age(r.age_days) + ' without a token';
    if (r._g !== null) s += ' · TVL ' + pct(r._g) + ' this week';
    return s;
  }

  function shortCost(c) {
    if (/^no fee/i.test(c)) return 'no fee';
    return c.length > 42 ? c.slice(0, 40).replace(/[ ,;]+$/, '') + '…' : c;
  }

  function stepTags(steps) {
    return steps.map(function (s) {
      if (/fresh wallet/i.test(s)) return 'wallet';
      if (/every week|each week|a week/i.test(s)) return 'weekly';
      if (/\bDeposit\b/i.test(s)) return 'capital';
      if (/second chain/i.test(s)) return '2nd chain';
      if (/Read .*(site|account)/i.test(s)) return 'check';
      return 'step';
    });
  }

  function splitStep(s) {
    var i = s.indexOf(' Cost: ');
    var act = i >= 0 ? s.slice(0, i) : s;
    var rest = i >= 0 ? s.slice(i + 7) : '';
    var j = rest.indexOf(' Time: ');
    var cost = (j >= 0 ? rest.slice(0, j) : rest).replace(/\.\s*$/, '');
    var time = (j >= 0 ? rest.slice(j + 7) : '').replace(/\.\s*$/, '');
    return { act: act, cost: cost, time: time };
  }

  function farmTotals(steps) {
    var capital = 0, fees = 0;
    steps.forEach(function (s) {
      var cost = splitStep(s).cost;
      var nums = cost.match(/\$([\d,]+(?:\.\d+)?)/g) || [];
      var vals = nums.map(function (t) { return parseFloat(t.slice(1).replace(/,/g, '')); });
      if (/of capital/i.test(cost) && vals.length) {
        capital += vals[0];
        for (var i = 1; i < vals.length; i++) fees += vals[i];
      } else {
        vals.forEach(function (v) { fees += v; });
      }
    });
    return { capital: capital, fees: fees };
  }

  (function liveList() {
    var body = $('live');
    var live = (D.live || []).slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    live.slice(0, 18).forEach(function (l) {
      var m = l.mcap_usd && l.tvl_usd ? (l.mcap_usd / l.tvl_usd) : null;
      body.appendChild(el('tr', null,
        el('td', { text: l.name }),
        el('td', { class: 'num', text: money(l.mcap_usd) }),
        el('td', { class: 'num', text: money(l.tvl_usd) }),
        el('td', { class: 'mult', text: m === null ? '—' : m.toFixed(2) + '×' })));
    });
    $('live-more').textContent = live.length
      ? 'Showing the 18 largest of ' + live.length + ' protocols already trading. ' + comps.length + ' of them record both a TVL and a cap, which is the comps set used above.'
      : 'No live protocol is recorded in this snapshot.';
  })();

  doc.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (typing) {
      if (e.key === 'Escape') { t.value = ''; if (t.id === 'q') { state.q = ''; draw(); } t.blur(); }
      return;
    }
    if (e.key === '/') { e.preventDefault(); $('q').focus(); return; }
    if (e.key === 'Escape') { if (state.q) { state.q = ''; $('q').value = ''; draw(); } return; }
    if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      state.view = state.view === 'watch' ? 'all' : 'watch';
      [].forEach.call($('views').querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === state.view));
      });
      draw();
      return;
    }
    var move = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1, Home: 'first', End: 'last', PageDown: 8, PageUp: -8 }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    if (!cur.length) return;
    var i = cur.findIndex ? cur.findIndex(function (r) { return r.slug === state.sel; }) : -1;
    if (i < 0) i = 0;
    var next;
    if (move === 'first') next = 0;
    else if (move === 'last') next = cur.length - 1;
    else next = Math.max(0, Math.min(cur.length - 1, i + move));
    select(cur[next].slug, { focus: true, scroll: true });
  });

  window.addEventListener('hashchange', function () {
    var s = (location.hash || '').replace('#', '');
    if (s && index[s] && s !== state.sel) select(s, { scroll: true });
  });

  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) select(tr.getAttribute('data-slug'));
  });

  $('asof').textContent = D.as_of || 'unknown';
  $('ver').textContent = D.model_version || 'unknown';
  var matched = rows.filter(function (r) { return r._imp === r.implied_value_usd; }).length;
  if ($('parity')) $('parity').textContent = matched + '/' + rows.length;

  state.sel = (location.hash || '').replace('#', '') || null;
  if (!state.sel || !index[state.sel]) state.sel = null;
  drawRows();
  if (!state.sel) state.sel = cur.length ? cur[0].slug : null;
  if (state.sel) select(state.sel, { scroll: false });
})();
