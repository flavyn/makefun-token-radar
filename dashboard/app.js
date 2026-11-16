// Token Radar — the page. Reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, the model, a per-protocol detail view with its farm plan, and the live-token set-aside.
// No network: every byte it shows is in data.js, and it recomputes each row's implied value from the
// snapshot's own figures so the page's arithmetic and board.json are visibly the same.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;

  var M = D.model;
  var state = { q: '', cat: '', sort: 'rank', only: false, sel: null };

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) {
        for (var j = 0; j < c.length; j++) if (c[j]) node.appendChild(c[j]);
      }
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  // The model, in the page: the same function main.ts scored every row with.
  function implied(row) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(M.growth_cap, Math.max(M.growth_floor, g));
    var gm = 1 + (g / 100) * M.growth_weight;
    var a = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var mm = M.maturity_floor + (Math.min(Math.max(a, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * M.base_multiple * gm * mm));
  }

  function visible() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.cat && (r.category || 'Other') !== state.cat) return false;
      if (state.only && !r.on_watchlist) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category].concat(r.chains || []).join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var k = state.sort;
    var key = function (r) {
      if (k === 'tvl') return r.tvl_usd;
      if (k === 'growth') return r.change_7d === null ? -1e9 : r.change_7d;
      if (k === 'age') return r.age_days === null ? -1 : r.age_days;
      if (k === 'implied') return r.implied_value_usd;
      return -r.rank;
    };
    return list.slice().sort(function (a, b) {
      if (k === 'rank') return a.rank - b.rank;
      var d = key(b) - key(a);
      return d !== 0 ? d : a.rank - b.rank;
    });
  }

  function head() {
    var s = document.getElementById('stats');
    s.textContent = '';
    [[D.board_size, 'rows ranked'], [D.watchlist_size, 'watchlist'], [D.early_size, 'early finds'],
     [D.live_size, 'live set aside']].forEach(function (pair) {
      s.appendChild(el('div', null, el('dt', { text: pair[1] }), el('dd', { text: String(pair[0]) })));
    });
  }

  function modelPanel() {
    document.getElementById('eq').textContent =
      'implied = round( tvl_usd x ' + M.base_multiple +
      ' x (1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ')/100 x ' + M.growth_weight + ')' +
      ' x (' + M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ')/' + M.maturity_days + ' x ' + M.maturity_range + ') )';
    var notes = document.getElementById('notes');
    notes.textContent = '';
    [
      'Ranked: protocols that record <b>no token</b>, and are not an exchange, a bridge, a staking wrapper or a versioned pool.',
      'Set aside: every protocol that already records a token and a market cap, shown at the bottom with the market\'s own value.',
      'Growth is the seven-day change in TVL, clamped to ' + M.growth_floor + '% to +' + M.growth_cap + '%.',
      'Maturity grows with the time since first listing, up to ' + M.maturity_days + ' days: a protocol that has run longer without a token has more to farm.',
      'No protocol name is special-cased: one function scores every row.'
    ].forEach(function (t) {
      var li = el('li'); li.innerHTML = t; notes.appendChild(li);
    });
  }

  function controls() {
    var cats = {};
    D.rows.forEach(function (r) { cats[r.category || 'Other'] = 1; });
    var sel = document.getElementById('cat');
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: 'All categories' }));
    Object.keys(cats).sort().forEach(function (c) { sel.appendChild(el('option', { value: c, text: c })); });
    sel.value = state.cat;

    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; draw(); });
    sel.addEventListener('change', function (e) { state.cat = e.target.value; draw(); });
    document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; draw(); });
    document.getElementById('only').addEventListener('change', function (e) { state.only = e.target.checked; draw(); });
  }

  function drawRows() {
    var body = document.getElementById('rows');
    body.textContent = '';
    var list = sorted(visible());
    document.getElementById('count').textContent = list.length + ' of ' + D.rows.length + ' rows';
    list.forEach(function (r) {
      var g = r.change_7d;
      var tr = el('tr', { onclick: function () { detail(r.slug); } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('span', { class: 'name', text: r.name }),
          r.on_watchlist ? el('span', { class: 'tag', text: 'watch' }) : null),
        el('td', { text: r.category || 'Other' }),
        el('td', { class: 'num', text: money(r.tvl_usd) }),
        el('td', { class: 'num ' + (g > 0 ? 'up' : g < 0 ? 'down' : ''), text: pct(g) }),
        el('td', { class: 'num', text: age(r.age_days) }),
        el('td', { class: 'num', text: money(r.implied_value_usd) })
      );
      body.appendChild(tr);
    });
  }

  function detail(slug) {
    var r = D.rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    state.sel = slug;
    var box = document.getElementById('detail');
    box.textContent = '';
    var again = implied(r);
    box.appendChild(el('h3', { text: r.name }));
    box.appendChild(el('p', { class: 'meta', text: '#' + r.rank + ' of ' + D.board_size + ' · ' + (r.category || 'Other') + ' · ' + (r.chains || []).join(', ') }));
    box.appendChild(el('p', { class: 'cap', text: 'implied value if its token launched' }));
    box.appendChild(el('p', { class: 'big', text: money(r.implied_value_usd) }));
    box.appendChild(el('table', { class: 'calc' },
      el('tr', null, el('td', { text: 'TVL' }), el('td', { text: money(r.tvl_usd) })),
      el('tr', null, el('td', { text: '7-day growth' }), el('td', { text: pct(r.change_7d) })),
      el('tr', null, el('td', { text: 'time without a token' }), el('td', { text: age(r.age_days) })),
      el('tr', null, el('td', { text: 'growth multiplier' }), el('td', { text: 'x' + r.growth_multiplier.toFixed(3) })),
      el('tr', null, el('td', { text: 'maturity multiplier' }), el('td', { text: 'x' + r.maturity_multiplier.toFixed(3) })),
      el('tr', null, el('td', { text: 'recomputed here' }), el('td', { text: money(again) }))
    ));
    box.appendChild(el('h4', { text: 'farm plan' }));
    var ol = el('ol');
    (r.farm_steps || []).forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    box.appendChild(ol);
  }

  function liveList() {
    var ul = document.getElementById('live');
    ul.textContent = '';
    (D.live || []).slice(0, 24).forEach(function (r) {
      ul.appendChild(el('li', null,
        el('b', { text: r.name }),
        el('span', { text: money(r.mcap_usd) + ' cap · ' + money(r.tvl_usd) + ' TVL' })));
    });
  }

  function draw() { drawRows(); }
  document.getElementById('asof').textContent = D.as_of;
  document.getElementById('ver').textContent = D.model_version;
  head(); modelPanel(); controls(); liveList(); draw();
  if (D.rows.length) detail(D.rows[0].slug);
})();
