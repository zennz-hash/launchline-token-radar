# launchline-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zennz-hash/launchline-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zennz-hash/launchline-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launchline is an empirical pre-token protocol valuation and costed farm-plan radar for `token-radar-01`. It accounts for all 758 protocols in the sealed DefiLlama snapshot across explicit non-overlapping lanes (40 watchlist, 138 early pre-token below the $50M floor, 416 live-token, and 164 excluded pre-token), fits a two-stage valuation model directly from the snapshot with exact Leave-One-Out and 10-fold cross-validation ablation tables, and derives chain-routed, gas-costed 5-step farm plans with honest net retail verdicts.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
