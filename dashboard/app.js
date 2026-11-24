// Token Radar dashboard, radar-2.
//
// The page reads window.RADAR (main.ts writes it beside dashboard/ as
// data.js) and renders the ranked board: a filterable, sortable table,
// a detail drawer per protocol with the model's own arithmetic and a
// seven-step farm plan, and the category-comparables table the model is
// priced from. It makes no network requests: everything on screen is
// already in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var root = document.getElementById('board');

  // The page's state, read from and written back to the URL hash so a
  // filtered view or an open protocol is a link you can share.
  var view = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    var q = params.get('q');
    var cat = params.get('category');
    var p = params.get('p');
    if (q) view.q = q;
    if (cat) view.category = cat;
    if (p) view.selected = p;
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    var url = next ? '#' + next : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  // ---- formatting ----

  var wholeUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return wholeUsd.format(n);
  }

  function signedPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function multLabel(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }

  function multLabel4(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(4);
  }

  // ---- the model, recomputed in the page ----

  // The page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's arithmetic and the board's
  // data are visibly the same. The category multiple is the row's own —
  // a median of live-token mcap/TVL in its category, or the whole
  // market's median where the category has too few live comparables —
  // and the chain multiplier is 1 + 3% per extra chain, capped at four.
  function recompute(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthX = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var chainX = 1 + Math.min(Math.max(chains - 1, 0), model.chain_max_bonus) * model.chain_step;
    var multiple = row.category_multiple === null || row.category_multiple === undefined ? DATA.overall_multiple : row.category_multiple;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthX * maturity * chainX));
  }

  // ---- DOM ----

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Build an element from a tag, attributes and child nodes. Attribute
  // keys starting with "on" become listeners; "text" becomes text
  // content; "html" becomes inner HTML; anything else becomes an
  // attribute unless it is null or undefined.
  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) kid.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof kid === 'string') node.appendChild(document.createTextNode(kid));
      else node.appendChild(kid);
    });
    return node;
  }

  function chainList(p) {
    return (p.chains && p.chains.length) ? p.chains.slice(0, 2).join(', ') : 'an unnamed chain';
  }

  function protocolSub(p) {
    return (p.category || 'Other') + ' on ' + chainList(p);
  }

  // ---- the farm plan, same derivation as board.json ----

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the
  // hold and every cost and time. No name is special-cased.
  function firstChain(p) { return (p.chains && p.chains.length > 0) ? p.chains[0] : 'its main chain'; }

  function capitalNeeded(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdDays(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function gasLabel(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum' || c === 'tron' || c === 'binance') return 'about $8 of gas on a high-fee chain';
    if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'hyperliquid l1') return 'under $1 of gas';
    return 'about $1 of gas on a cheap chain';
  }

  // Each rule pairs a category test with the action it produces. The
  // first matching rule wins; the last rule is the fallback for every
  // category the table does not name.
  var MAIN_ACTIONS = [
    [/lend|cdp|collateral/, function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; }],
    [/dex|yield|leveraged farm/, function (name, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'; }],
    [/bridge/, function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'; }],
    [/staking|restak/, function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'; }],
    [/perpetual|derivative/, function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'; }],
    [/prediction/, function (name, capital, chain) { return 'Fund $' + capital + ' and place one market position on ' + name + '.'; }],
    [/curator|allocator/, function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.'; }],
    [/stable/, function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; }],
    [/rwa/, function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; }],
    [/insurance/, function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'; }]
  ];

  var SECOND_ACTIONS = [
    [/lend|cdp|collateral/, function (name) { return 'Borrow $20 against the supply on ' + name + ' and repay it the same week, so the wallet shows both sides of the market.'; }],
    [/dex|yield|leveraged farm/, function (name, chain) { return "Swap $20 through " + name + "'s pool on " + chain + ' once, so the wallet is a trader as well as a liquidity provider.'; }],
    [/bridge/, function (name, chain) { return 'Use the bridged funds in a second app on ' + chain + ', for example a swap or a deposit, instead of bridging them straight back.'; }],
    [/staking|restak/, function (name) { return 'Claim the staking rewards once and restake them through ' + name + ', so the position compounds.'; }],
    [/perpetual|derivative/, function () { return 'Close the hedge and open one more small position the following week, so the account stays active.'; }],
    [/prediction/, function (name) { return 'Settle the first position and place a second one on a different market on ' + name + '.'; }],
    [/curator|allocator/, function (name) { return 'Deposit $20 into a second ' + name + ' vault on a different chain, so the wallet is diversified.'; }],
    [/stable/, function () { return 'Use the minted stable asset once, for example a swap or a payment, instead of leaving it idle.'; }],
    [/rwa/, function (name) { return "Check the yield asset's redemption terms on " + name + ' and redeem a $20 test amount once.'; }],
    [/insurance/, function (name) { return 'File a test claim inquiry on ' + name + ' so you know the process before you ever need it.'; }]
  ];

  function pickAction(rules, p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(c)) return rules[i][1](p.name, capital, chain);
    }
    return null;
  }

  function mainAction(p, capital, chain) {
    return pickAction(MAIN_ACTIONS, p, capital, chain) || ('Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.');
  }

  function secondAction(p, capital, chain) {
    return pickAction(SECOND_ACTIONS, p, capital, chain) || ('Make one more qualifying action on ' + p.name + ', such as a swap or a vote, within the same week.');
  }

  function oneStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  function farmPlan(p) {
    var chain = firstChain(p);
    var capital = capitalNeeded(p);
    var hold = holdDays(p.age_days);
    var gas = gasLabel(chain);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainAction(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondAction(p, capital, chain), cost: 'about $20 of capital and ' + gas, time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'If the protocol\'s TVL falls by half or its points page goes silent for two weeks, unwind the position and move on. Write the wallet, the dates and every transaction in a farm log.', cost: 'the $' + capital + ' returns to your wallet', time: '15 minutes to unwind' }
    ];
    return steps.map(oneStep);
  }

  // ---- filtering and sorting ----

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortValue(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
    return r.implied_value_usd;
  }

  function orderedRows(list) {
    var key = view.sort;
    var dir = view.dir;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- sections ----

  function topBar() {
    return h('header', { class: 'top' }, [
      h('div', { class: 'brand' }, [
        h('span', { class: 'mark', 'aria-hidden': 'true' }),
        h('span', { class: 'brand-name', text: 'Token Radar' })
      ]),
      h('div', { class: 'top-meta' }, [
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })
      ])
    ]);
  }

  function intro() {
    var facts = [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Early rows below the floor', String(DATA.early_size)],
      ['Market median multiple', multLabel(DATA.overall_multiple)],
      ['Live-token protocols set aside', String(DATA.live_size)]
    ];
    return h('section', { class: 'lede' }, [
      h('div', null, [
        h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every one of them. Each protocol is priced at the multiple its own category trades at, read from the live tokens in this same snapshot — not one flat number for all of them. Implied value is a model, not a promise.' })
      ]),
      h('div', { class: 'facts' }, facts.map(function (f) {
        return h('div', { class: 'fact' }, [h('span', { text: f[0] }), h('b', { text: f[1] })]);
      }))
    ]);
  }

  function filterBar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeHash(); render(); });
    var select = h('select', { id: 'category', 'aria-label': 'Filter by category' }, [
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) {
        return h('option', { value: c, text: c, selected: c === view.category ? 'selected' : null });
      })
    ]);
    select.addEventListener('change', function () { view.category = select.value; writeHash(); render(); });
    var preTab = h('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; render(); } });
    var liveTab = h('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; render(); } });
    var shown = view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return h('div', { class: 'controls' }, [
      h('div', { class: 'field' }, [h('label', { for: 'q', text: 'Search' }), search]),
      h('div', { class: 'field' }, [h('label', { for: 'category', text: 'Category' }), select]),
      h('div', { class: 'field' }, [h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, [preTab, liveTab])]),
      h('span', { class: 'count', text: shown })
    ]);
  }

  function sortButton(key, label) {
    var arrow = view.sort === key ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null;
    return h('th', { scope: 'col' }, [
      h('button', {
        type: 'button',
        onclick: function () {
          if (view.sort === key) view.dir = -view.dir;
          else { view.sort = key; view.dir = -1; }
          render();
        }
      }, [label, arrow])
    ]);
  }

  function rankCell(r) {
    var cls = r.rank <= 3 ? 'rank-top rank-' + r.rank : '';
    return h('td', { class: 'num ' + cls, text: String(r.rank) });
  }

  function nameCell(r) {
    return h('td', null, [
      h('div', { class: 'name' }, [h('b', { text: r.name }), h('span', { class: 'sub', text: protocolSub(r) })])
    ]);
  }

  function impliedCell(r, max) {
    var pct = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
    return h('td', null, [
      h('div', { class: 'implied' }, [
        h('div', { class: 'bar', 'aria-hidden': 'true' }, [h('i', { style: 'width:' + pct + '%' })]),
        h('span', { class: 'num', text: money(r.implied_value_usd) })
      ])
    ]);
  }

  function boardTable() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, [
        h('div', { class: 'empty' }, [
          h('h2', { text: 'No protocol matches that filter' }),
          h('p', { text: 'Clear the search or pick another category to see the board again.' }),
          h('button', {
            class: 'button primary', type: 'button', text: 'Clear filters',
            onclick: function () { view.q = ''; view.category = 'all'; writeHash(); render(); }
          })
        ])
      ]);
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : signedPct(r.change_7d);
      var growthCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var row = h('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); }
        }
      }, [
        rankCell(r),
        nameCell(r),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthCls, text: growth }),
        h('td', { class: 'num', text: ageLabel(r.age_days) }),
        impliedCell(r, max),
        h('td', null, [h('span', { class: 'status', text: 'no token' })])
      ]);
      tbody.appendChild(row);
    });
    return h('div', { class: 'panel' }, [
      h('div', { class: 'table-wrap' }, [
        h('table', null, [
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, [
            h('tr', null, [
              sortButton('implied', 'Rank'),
              sortButton('name', 'Protocol'),
              sortButton('tvl', 'TVL'),
              sortButton('growth', '7d'),
              sortButton('age', 'Age'),
              sortButton('implied', 'Implied value'),
              h('th', { scope: 'col', text: 'Token' })
            ])
          ]),
          tbody
        ])
      ])
    ]);
  }

  function liveTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      var cls = (r.change_7d !== null && r.change_7d >= 0) ? 'pos' : 'neg';
      tbody.appendChild(h('tr', null, [
        h('td', { class: 'num', text: 'live' }),
        h('td', null, [h('div', { class: 'name' }, [h('b', { text: r.name }), h('span', { class: 'sub', text: protocolSub(r) })])]),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + cls, text: signedPct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, [h('span', { class: 'status', text: 'already trades' })])
      ]));
    });
    return h('div', { class: 'panel' }, [
      h('div', { class: 'table-wrap' }, [
        h('table', null, [
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, [
            h('tr', null, [
              h('th', { scope: 'col', text: 'Status' }),
              h('th', { scope: 'col', text: 'Protocol' }),
              h('th', { scope: 'col', text: 'TVL' }),
              h('th', { scope: 'col', text: '7d' }),
              h('th', { scope: 'col', text: 'Market cap' }),
              h('th', { scope: 'col', text: 'Token' })
            ])
          ]),
          tbody
        ])
      ])
    ]);
  }

  function modelSection() {
    var m = DATA.model;
    var body = (DATA.comparables || []).map(function (c) {
      return h('tr', null, [
        h('td', { text: c.category }),
        h('td', { class: 'num', text: String(c.comparables) }),
        h('td', { class: 'num', text: multLabel(c.median_multiple) }),
        h('td', { class: 'num', text: multLabel(c.multiple) }),
        h('td', { class: 'num', text: c.fallback ? 'market median' : 'category' })
      ]);
    });
    var formula = 'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.chain_max_bonus + ') x ' + m.chain_step + ') )';
    var explainer = 'The category multiple is the median market cap over TVL of the live-token protocols in that category, read from this same snapshot, clamped to ' + m.multiple_floor + 'x-' + m.multiple_cap + 'x. A $0 market cap is not a valuation and is excluded. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.';
    var caption = 'Median mcap/TVL per category over live-token protocols with a market cap above zero. A category with fewer than ' + m.min_comparables + ' live comparables uses the whole market median of ' + multLabel(DATA.overall_multiple) + ' instead of a number built on one or two points.';
    return h('section', { class: 'panel model' }, [
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' }, [formula]),
      h('p', { class: 'sub', text: explainer }),
      h('h3', { text: 'Category multiples, from the live tokens in this snapshot' }),
      h('div', { class: 'table-wrap' }, [
        h('table', { class: 'comparables' }, [
          h('caption', { class: 'sub', text: caption }),
          h('thead', null, [
            h('tr', null, [
              h('th', { scope: 'col', text: 'Category' }),
              h('th', { scope: 'col', text: 'Live tokens' }),
              h('th', { scope: 'col', text: 'Median' }),
              h('th', { scope: 'col', text: 'Multiple used' }),
              h('th', { scope: 'col', text: 'Source' })
            ])
          ]),
          h('tbody', null, body)
        ])
      ])
    ]);
  }

  function readingGuide() {
    return h('section', { class: 'panel model' }, [
      h('h2', { text: 'How to read this board' }),
      h('p', { class: 'sub', text: 'Start at the top: rank 1 is the largest implied value, not the largest TVL. A protocol can outrank a bigger one when its category trades at a higher multiple, when its TVL is growing, or when it has run longer with no token. Filter by category to compare like with like, and open a row to see the exact arithmetic and a seven-step farm plan with a cost and a time for every step.' }),
      h('p', { class: 'sub', text: 'What this board is not: a price, a prediction, or advice. Implied value is what the protocol would be worth if the market priced it like the live tokens in its category, on the day the snapshot was taken. A token launch can be worth far less, or never happen at all. Never farm with money you cannot afford to lose, and never pay anyone to claim a reward.' })
    ]);
  }

  // ---- detail drawer ----

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; writeHash(); });

  function equationRows(row) {
    var pairs = [
      ['TVL', money(row.tvl_usd)],
      ['Category multiple', multLabel(row.category_multiple)],
      ['Seven-day growth', signedPct(row.change_7d)],
      ['Age with no token', ageLabel(row.age_days)],
      ['Chains', String(row.chains ? row.chains.length : 0) + ' (' + multLabel(row.chain_multiplier) + ')'],
      ['Growth multiplier', multLabel4(row.growth_multiplier)],
      ['Maturity multiplier', multLabel4(row.maturity_multiplier)],
      ['Implied value', money(row.implied_value_usd)]
    ];
    return pairs.map(function (pair) {
      return h('div', null, [h('span', { text: pair[0] }), h('b', { class: 'num', text: pair[1] })]);
    });
  }

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    }
    if (!row) return;
    view.selected = slug;
    writeHash();
    dialog.textContent = '';
    var again = recompute(row, DATA.model);
    var note = 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(again) + (again === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.';
    var head = h('div', { class: 'detail-head' }, [
      h('div', null, [
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ]),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ]);
    var value = h('section', { class: 'detail-section' }, [
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' }, equationRows(row)),
      h('p', { class: 'sub', text: note })
    ]);
    var plan = h('section', { class: 'detail-section' }, [
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, farmPlan(row).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, [h('b', { text: action }), h('span', { class: 'cost', text: tail })]);
      }))
    ]);
    dialog.appendChild(head);
    dialog.appendChild(value);
    dialog.appendChild(plan);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // ---- render ----

  function render() {
    root.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? boardTable() : liveTable());
    if (view.tab === 'pre-token') {
      shell.appendChild(modelSection());
      shell.appendChild(readingGuide());
    }
    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) root.appendChild(dialog);
    if (view.selected) openDetail(view.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
