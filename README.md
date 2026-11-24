# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/halohalobandunugvngun/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/halohalobandunugvngun/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's `token-radar-01` bounty: 758 DefiLlama protocols in, 226
pre-token protocols ranked by implied value out. Built with Node 22 and the standard library only.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## What it does

`main.ts` reads the sealed snapshot (`/input/snapshot.json`, or `--input <file|dir>`), scores every
pre-token protocol, and writes:

- `board.json` — the ranked board (226 rows)
- `data.js` — the dashboard's dataset, written beside `dashboard/`
- `dashboard/` — a static page, no framework, no network
- `screenshots/` — three screenshots of the page (board, detail, filtered)
- `dossier.json` — the summary the judge reads, built with the vendored `vendor/makefun-board.ts`

## The model (radar-2)

The board covers all 40 watchlist slugs (TVL ≥ $50M, no token on record) plus every pre-token
protocol below the floor — 186 early rows, all of them. A protocol is pre-token when its index
entry records no market cap, no CoinGecko id and no symbol. Live-token protocols are set aside
with their market caps shown, and they double as the comparables the model is priced from.

Implied value, computed from the snapshot's own figures at run time — no name is special-cased,
no multiple is hard-coded:

```
category multiple = median(mcap_usd / tvl_usd) over live-token protocols in the same category
                    (at least 3 comparables; otherwise the whole market's median),
                    clamped to [0.05, 0.60]. A $0 market cap is not a valuation and is excluded.
growth     = clamp(change_7d, -60, 120) per cent
growthMult = 1 + (growth / 100) x 0.5
maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
chains     = 1 + min(max(chains - 1, 0), 4) x 0.03    (multi-chain distribution, at most +12%)
implied    = max(1, round(tvl_usd x category multiple x growthMult x maturity x chains))
```

Why a category multiple: live tokens do not trade at one multiple of TVL. In this snapshot,
Lending trades around 0.13x TVL, Dexs around 0.34x, RWA around 0.27x, while Bridge and Basis
Trading sit near 0.56x and 0.65x. A flat 0.25x would overvalue a lending protocol twofold and
undervalue a bridge threefold. Where a category has fewer than three live comparables — Risk
Curators, 12 of the 40 watchlist rows, has exactly one — the model falls back to the whole
market's median (0.214x) instead of inventing a number. The dashboard shows the full
comparables table, so every multiple can be checked against the snapshot.

The top of the board: Steakhouse Financial ($521M implied, $2.75B TVL), Gauntlet ($310M) and
Veda ($298M).

## Farm plans

Every row carries a seven-step farm plan derived from its own record (category, chains, TVL,
age): a fresh wallet, the category's main action, a second qualifying action so the wallet
shows real use, a weekly action, a hold window by age, claiming only from the protocol's own
link, and an exit rule (unwind if TVL halves or the points page goes silent for two weeks).
Each step states its cost — gas by chain band — and its time. Nothing in the plan is
hard-coded to a name.

## The dashboard

Sortable and filterable table, text search, category filter, Pre-token / Live token tabs, a
detail drawer per protocol that recomputes the row from the snapshot figures and checks it
against `board.json`, a model panel with the formula and the comparables table, and a "How to
read this board" section. Implied value is a model, not a price, and the page says so.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=xyb0fagg&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
