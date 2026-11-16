# Token Radar — pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/flavyn/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/flavyn/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's **Build the best token launch radar** bounty ($1,325 in USDC):
a single-file program that reads a sealed snapshot of 758 DeFi protocols, keeps the ones that
record no token, ranks them by what their token could be worth if it launched, and writes a board,
a static dashboard and the judge's dossier.

## What it does

- **Ranks only pre-token protocols.** A protocol is on the board when it records no token and no
  market cap, clears the snapshot's TVL floor, and is not an exchange, a bridge, a staking wrapper,
  a restaked or wrapped version of another asset, or a versioned pool. Every protocol that already
  trades is set aside and shown at its market cap, which is the whole point of a launch radar:
  the market has not priced the others yet.
- **Prices a row from the snapshot's own figures.** One function, no protocol name special-cased:

  ```
  g   = clamp(change_7d, -50, 150)
  age = days from listed_at to as_of
  implied = round(tvl_usd * 0.45 * (1 + g/100 * 1.55) * (0.85 + min(age,1095)/1095 * 0.4))
  ```

  TVL is what the protocol has to protect today, the seven-day change says which way it is moving,
  and time without a token says how much of a launch candidate it has become. The page recomputes
  every row from the same fields and prints its own result beside the board's.
- **Gives every protocol a farm plan**: four to five steps, each with a cost and a time — an account
  step, a capital step naming a real action and a dollar amount, a weekly cadence step, a check step
  that reads the protocol's own page for a token announcement, and a second-chain step when the
  protocol runs on several chains.
- **Fails closed.** Before writing, the program checks its own board: at least 100 rows, every
  watchlist slug present, ranks 1..N with no gap, implied value never rising with rank, and every
  farm step inside 20..600 characters. A board that breaks one exits 1 with a single line.

## Run it

```
node main.ts --input <snapshot.json|dir> --output <dir> [--verbose]
```

Node 22.18 or later, standard library only, no install and no build step. `--output` defaults to
`$MAKEFUN_OUTPUT_DIR` or `/output`. It writes `board.json`, `data.js` (what the dashboard reads),
a copy of `dashboard/` and `screenshots/`, and `dossier.json` last.

## What is in here

| Path | What it is |
| --- | --- |
| `main.ts` | The whole entry: the model, the gate it enforces, the board, the page data and the dossier |
| `dashboard/` | The static page: sortable and filterable board, a detail view with each protocol's arithmetic and farm plan |
| `screenshots/` | Three PNGs of that page on the sealed snapshot: the board, a category-filtered view, and a detail view |
| `vendor/makefun-board.ts` | make.fun's own dossier writer, as shipped in the kit |
| `LICENSE` | MIT |

Snapshot results: 758 protocols, 40 on the watchlist, **201 board rows**, 161 early finds off the
watchlist, and 416 live protocols set aside.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty. More on the bounty:
[make.fun/bounty/token-radar-01](https://make.fun/bounty/token-radar-01).
