<p align="center">
  <img src="assets/avatar-full.png" width="160" alt="RABIQ: a skeptical pixel rabbit holding a dossier" />
</p>

<p align="center">
  <a href="https://rabiq.vercel.app"><img src="assets/social-preview.png" width="100%" alt="RABIQ: every deployer has a history. A live case file for $ESSAY stamped 1 earlier launch from this deployer." /></a>
</p>

<p align="center">
  <a href="https://github.com/0xmfox/rabiq/actions/workflows/ci.yml"><img src="https://github.com/0xmfox/rabiq/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/0xmfox/rabiq/releases"><img src="https://img.shields.io/github/v/release/0xmfox/rabiq?style=flat-square&color=b8ef45&labelColor=0b1309&label=release" alt="Release" /></a>
  <img src="https://img.shields.io/badge/node-22.18%2B-b8ef45?style=flat-square&labelColor=0b1309" alt="Node 22.18+" />
  <img src="https://img.shields.io/badge/Robinhood%20Chain-4663-b8ef45?style=flat-square&labelColor=0b1309" alt="Robinhood Chain 4663" />
  <img src="https://img.shields.io/badge/launchpad-Pons%20V2-b8ef45?style=flat-square&labelColor=0b1309" alt="Pons V2" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-b8ef45?style=flat-square&labelColor=0b1309" alt="MIT" /></a>
</p>

<p align="center">
  <strong>Every deployer has a history.</strong><br/>
  Token dossiers and deployer memory for Robinhood Chain.
</p>

<p align="center">
  <a href="https://rabiq.vercel.app"><strong>Live app</strong></a> ·
  <a href="#the-number">The number</a> ·
  <a href="#sixty-seconds">Sixty seconds</a> ·
  <a href="#the-dossier">The dossier</a> ·
  <a href="#deployer-memory">Deployer memory</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="https://x.com/0xMfox">X / @0xMfox</a>
</p>

---

## Why RABIQ

Pons V2 ships a new token on Robinhood Chain every few seconds. You look at a CA, open the repo, read the launch post and decide to wait. Two days later the same deployer launches again, and you have to find everything a second time.

That happens a lot. Across 458,223 Pons V2 launches, **43.9%** of the launches made by wallets came from a wallet that had already launched a token before ([how we counted](#the-number)).

RABIQ turns every contract address into a **dossier**: the on-chain facts, your thesis, what you checked, the question you stopped at and your decision. Open the CA again and RABIQ shows **what changed since your last check**. Dig a new CA from a deployer you already studied and RABIQ puts your old notes in front of you.

### Keep what you found

Traders drop most trench research into a chat, a screenshot or nowhere. RABIQ pins each investigation to its contract address, links investigations that share a deployer, fee recipient or repository, and turns a finished dossier into a link another researcher can pick up.

## Current build

| Engine | Status | What is in the repo |
| --- | --- | --- |
| Live site | **WORKING** | [rabiq.vercel.app](https://rabiq.vercel.app): a landing page that opens a case file on the newest Pons V2 launch, then the app |
| Launch census | **WORKING** | `scripts/landing-data.ts` reads every `TokenLaunched` event, tells wallets from contracts by bytecode and counts repeat launchers |
| Token dossier | **WORKING** | Paste a CA → one dossier per chain + address, so identical tickers never mix |
| On-chain facts | **WORKING** | Pons V2 factory `getLaunchedToken` → deployer, fee recipient, phase (curve, swept, graduated, rescued), creator tax; curve price and progress from `getReserves` |
| Deployer memory | **WORKING** | Every `TokenLaunched` by the same deployer; RABIQ highlights tokens already in your burrow |
| RABIQ remembers | **WORKING** | Opening a dossier surfaces connected dossiers with their thesis, decision and first open question |
| Since last check | **WORKING** | FDV and liquidity moves, curve → pool graduation, fee recipient change, new commits with a compare link, new launches by the deployer |
| Strings | **WORKING** | Dossiers link through a shared deployer, fee recipient or GitHub repo (**confirmed**) or through your own notes (**hypothesis**) |
| Graph | **WORKING** | All dossiers as draggable nodes and connections |
| Publish / Save to my brain | **WORKING** | A dossier is packed into the link itself. Status, reason and notes stay private unless you opt in |
| Live desk | **WORKING** | Every Pons V2 launch and every bonding-curve trade of the last ten minutes, read every two seconds: market cap, curve progress, buys and sells, volume, wallets, sparkline and the deployer's earlier launches per token |
| Charts | **WORKING** | Market cap candles from every `CurveBuy` / `CurveSell` since launch, continued with Uniswap v4 `Swap` events after graduation; trade-count or time candles |
| Quote assets | **WORKING** | Launches paired with USDG, cbBTC or tokenized stocks are priced in their own asset (decimals read on-chain, USD from DexScreener) |
| Ticker tape | **WORKING** | The most traded tokens of the last ten minutes, on every page |
| How to use + Docs | **WORKING** | [rabiq.vercel.app/#/how](https://rabiq.vercel.app/#/how) and [#/docs](https://rabiq.vercel.app/#/docs): every data source, contract and formula |
| Markdown export | **WORKING** | Any dossier as an Obsidian-friendly note with frontmatter; all dossiers as JSON |
| CLI | **WORKING** | `rabiq dig`, `rabiq recall`, `rabiq demo` over a folder of Markdown notes |
| Demo dossiers | **WORKING** | Four synthetic dossiers, labelled as demo, no network requests |

## What it looks like

<p align="center"><img src="assets/demo.gif" width="100%" alt="RABIQ walkthrough on Robinhood Chain mainnet: the live case file, the number, serial launchers, the live wire, a dossier and the graph" /></p>

The HOP OUT dossier. Its deployer also launched ESSAY, so RABIQ puts the ESSAY research at the top. The stamp on the right is your decision.

![RABIQ dossier with the memory panel and on-chain facts](assets/screens/dossier.webp)

| Dossiers as a graph | A published dossier, ready for “Save to my brain” |
| --- | --- |
| ![Graph of seven dossiers; HOP OUT and ESSAY share a deployer](assets/screens/graph.webp) | ![Published YOINK dossier](assets/screens/shared.webp) |

<sub>Screenshots of the running app on Robinhood Chain mainnet. The tokens are live Pons V2 launches from other builders, used here as research examples. The notes in them are sample research, not recommendations.</sub>

## The number

<p align="center"><img src="assets/screens/number.webp" width="100%" alt="43.9% of Pons V2 launches from wallets came from a wallet that had already launched a token" /></p>

`scripts/landing-data.ts` builds the numbers on the landing page from the chain itself:

1. It reads every `TokenLaunched` event from the Pons V2 factory, from the first launch at block 27,027,321 to the current head: 458,223 launches by 252,891 deployer addresses as of block 62,899,527 (14 Sep 2026).
2. It checks the bytecode of every deployer that launched more than once. A single `eth_call` places a small EXTCODESIZE loop at a scratch address with a state override and measures 1,500 addresses per request.
3. Addresses without code count as wallets. So do EIP-7702 accounts, whose only code is the 23-byte delegation designator: a key still controls them. The rest are contracts, such as Multicall3, and their 8,206 launches stay out of the share.
4. A launch counts as "launched before" when the wallet already had an earlier Pons V2 launch: 197,374 of 450,017 wallet launches, or 43.9%.

Single-launch deployers skip the bytecode check. A contract among them would only add a first launch to the denominator, so the share can only come out lower than the true value.

All 458,223 launches, bucketed by block height:

<p align="center"><img src="assets/screens/activity.svg" width="100%" alt="All 458,223 Pons V2 launches bucketed by block height, from block 27,027,321 to 62,899,527" /></p>

The same script picks the wallets for **Serial launchers**: the two busiest wallets as launch density over the life of Pons V2, and the four wallets with 6 to 60 launches that graduated the most tokens from the bonding curve.

<p align="center"><img src="assets/screens/serial.webp" width="100%" alt="Launch timelines of six serial launchers on Pons V2; lime marks graduated tokens" /></p>

```bash
node scripts/landing-data.ts   # rewrites public/landing.json; raw logs are cached in .cache/
```

## Sixty seconds

1. **Dig.** Paste a Robinhood Chain CA into the top bar, or open a token from the **live wire**. RABIQ reads the Pons V2 launch record, the market and every launch by the same deployer.
2. **Write down what you know.** A one-line thesis, two arguments for, one against. Add the launch post and the GitHub repo as sources; RABIQ records the repo head commit on the next check.
3. **Leave a question.** “Does the CLI actually run?” RABIQ marks the first open question **next**.
4. **Decide.** Watching, Researching, In position or Passed, with a reason.
5. **Come back.** Open the same CA tomorrow. **Since your last check** lists what moved: FDV, liquidity, graduation, fee recipient, new commits, new launches.
6. **Meet the deployer again.** Dig a fresh CA from the same wallet. **RABIQ remembers** shows the earlier dossier, its decision and the question you left open.
7. **Publish.** One link carries the thesis, checks, open questions, sources and connected CAs. Whoever opens it can save it into their own burrow and keep going.

## The dossier

One dossier per chain and contract address. Two tokens with the same ticker are two different dossiers.

<p align="center"><img src="assets/screens/questions.webp" width="80%" alt="Open questions with the next one flagged" /></p>

| Section | What it holds |
| --- | --- |
| **Decision** | `Watching` · `Researching` · `In position` · `Passed`, plus a private reason |
| **Thesis** | What the project is and how you know it |
| **For / Against** | Arguments on each side, one line each |
| **Open questions** | What you still need to verify; RABIQ flags the first unanswered one **next** |
| **Checked** | What you have already verified |
| **Notes** | Markdown with `[[SYMBOL]]` links to other dossiers; addresses become explorer links |
| **Sources** | Launch post, site, GitHub repo; RABIQ snapshots repositories on each check |
| **On-chain facts** | Launchpad, phase, deployer, fee recipient, creator tax, FDV, liquidity, 24h volume, deployer launches, repo head |
| **Connections** | Every string to another dossier, labelled confirmed or hypothesis |
| **Timeline** | When the dossier was opened, status changes, answered questions, detected changes |

## Deployer memory

For a Pons V2 token, RABIQ reads the factory record with `getLaunchedToken(token)` and gets the **deployer** and **creator fee recipient**. It then collects each `TokenLaunched` event the factory emitted for that deployer, from the first Pons V2 launch (block 27,027,321) to the current head, in bounded block ranges. One Multicall3 call resolves the symbols for all of those tokens.

Two things happen with that list:

- **In the facts panel**, RABIQ lists the deployer's launches. It highlights the ones you already have a dossier for and links them to your notes.
- **In RABIQ remembers**, RABIQ surfaces any dossier that shares this deployer or fee recipient, with its decision, reason, thesis and first open question.

<p align="center"><img src="assets/screens/memory.webp" width="100%" alt="RABIQ remembers: the ESSAY dossier shown on HOP OUT through the shared deployer" /></p>

## Since last check

Every check stores a snapshot. RABIQ compares the newest snapshot with the previous one using fixed rules:

<p align="center"><img src="assets/screens/since.webp" width="100%" alt="YOINK: FDV moved since the last check" /></p>

| Change | Rule |
| --- | --- |
| FDV move | reported when FDV changed by 5% or more |
| Liquidity move | reported when liquidity changed by 10% or more |
| Market appeared | a market now exists where the previous check found none |
| Graduation | phase moved from the Pons bonding curve to the Uniswap v4 pool |
| Fee recipient change | the creator fee recipient address is different |
| New commits | a tracked repository head moved; the entry links to the GitHub compare view |
| New launches | the deployer launched tokens that were not in the previous list |

A check that finds nothing new replaces the latest snapshot instead of adding one, so you compare against the last check where something differed. RABIQ keeps up to 30 snapshots per dossier.

## Strings

| String | Kind | When it appears |
| --- | --- | --- |
| Same deployer | confirmed | both tokens were launched by the same address |
| Same fee recipient | confirmed | both tokens send creator fees to the same address |
| Deployer receives fees | confirmed | the deployer of one token is the fee recipient of the other |
| Same GitHub repo | confirmed | both dossiers track the same repository |
| Note mention | hypothesis | your notes on one dossier mention the other's CA, deployer, `$SYMBOL` or `[[SYMBOL]]` |

RABIQ confirms a string from identical addresses and repositories. It files anything drawn from your own writing as a hypothesis. The **Graph** view draws one string per pair: solid when a confirmed link exists, dashed for hypotheses.

<p align="center"><img src="assets/screens/facts.webp" width="55%" alt="On-chain facts and connections panels" /></p>

## Publish and Save to my brain

RABIQ compresses a published dossier and encodes it into the link.


| Included | Excluded unless you opt in |
| --- | --- |
| Thesis, for, against | Status and decision reason |
| Checked items and open questions | Private notes |
| Sources | |
| Latest on-chain snapshot (last 10 deployer launches) | |
| Connected CAs with their string labels | |

Opening a link shows the dossier with the author's handle. **Save to my brain** merges it into your burrow and keeps your work intact. Your thesis stays first and theirs follows with attribution. RABIQ merges sources and arguments without duplicates, tags their checks `checked by @author` and skips questions you already have.

RABIQ treats incoming links as untrusted input. It type-checks each field, caps sizes (50 items, 500 characters per item, 20,000 characters of notes) and HTML-escapes the text before rendering.

## How it works

<p align="center"><img src="assets/how-it-works.png" width="100%" alt="How RABIQ works: contract address, sources, snapshot, dossier, strings, publish, RABIQ remembers" /></p>

Token reads are batched through Multicall3 (name, symbol, launch record and the L2 block number via ArbSys) so a full check stays within a handful of RPC requests. Launch history is read in bounded ranges, sequentially, with backoff when the public RPC rate-limits.

## Quick start

Requires **Node.js 22.18+** (TypeScript runs natively, no build step for the CLI).

```bash
git clone https://github.com/0xmfox/rabiq.git
cd rabiq
npm install
npm run dev        # web app on http://localhost:5173
```

Click **Load demo dossiers** for an offline walkthrough, or paste any Robinhood Chain CA into the top bar.

```bash
npm test           # logic tests
npm run build      # static site in dist/, deployable anywhere
node scripts/landing-data.ts   # refresh the launch census on the landing page
```

## CLI

The same engine over a folder of Markdown files. The notes open in Obsidian or any editor.

```bash
node bin/rabiq.ts dig 0x78F13072B0F6EBC7fD0B5359c9B4E09C6160cff8 --repo https://github.com/insomnia-vip/hop-out
node bin/rabiq.ts dig 0x97eff705f061778a1017550f358bd2cdde593376
node bin/rabiq.ts recall 0x728f38b5800febf4eef37e2a297a0e4d55189810
```

<p align="center"><img src="assets/screens/cli.png" width="100%" alt="RABIQ CLI: the second dig finds the HOP OUT dossier through the shared deployer" /></p>

### Commands

| Command | What it does |
| --- | --- |
| `rabiq dig <CA> [--repo URL]` | Reads the token, prints the facts, compares with the previous check, lists earlier dossiers that share the deployer or fee recipient, and creates or updates `burrow/<SYMBOL>-<ca>.md` |
| `rabiq recall <address>` | Lists dossiers where the address appears as deployer, fee recipient, contract or in notes, with each dossier's first open question |
| `rabiq demo` | Writes the synthetic demo burrow and runs a recall on its shared deployer |

`dig` rewrites only the machine-written facts block of an existing note (between `<!-- rabiq:facts -->` markers) and the address fields in its frontmatter. It leaves your thesis, lists and notes as you wrote them. Comparison snapshots live in `burrow/.snapshots`.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `RABIQ_BURROW` | `./burrow` | Folder for Markdown dossiers and snapshots |

### Note format

```markdown
---
rabiq: 1
chain: robinhood
ca: 0x…
symbol: SNIFF
status: digging
deployer: 0x…
fee_recipient: 0x…
updated: 2026-09-14T09:00:00.000Z
---

# $SNIFF — Sniff Terminal

<!-- rabiq:facts -->
| Fact | Value |
| --- | --- |
| Phase | graduated |
| Deployer launches | $SNIFF, $MOLE |
<!-- /rabiq:facts -->

## Thesis
## For
## Against
## Checked
## Open questions
- [ ] Does the CLI actually run?
## Sources
## Notes
```

## Data sources

| Source | What RABIQ reads | Used for |
| --- | --- | --- |
| `rpc.mainnet.chain.robinhood.com` | Multicall3 `eth_call` to the Pons V2 factory `0x7eD5…EC7e`, ERC-20 `name` / `symbol`, ArbSys block number; `TokenLaunched` logs | deployer, fee recipient, phase, creator tax, deployer launches |
| `api.dexscreener.com` | public token pairs | FDV, liquidity, 24h volume |
| `api.github.com` | public repository metadata and head commit | repository snapshot and new-commit detection |

## Storage

- The web app is a static build. It stores dossiers in the browser's `localStorage`; you can export them as JSON or Markdown and import them back.
- The CLI stores dossiers as Markdown files in a folder you choose.
- Published dossiers travel inside the link. Opening a link does not upload anything.

## Honest limits

- **Pons V2 only.** Deployer and fee recipient come from the Pons V2 factory. Tokens from other launchpads get market and GitHub data without deployer memory.
- **One browser, one burrow.** The web app has no accounts and no sync. Move a burrow between devices with Export and Import.
- **Public RPC rate limits.** Robinhood Chain's public endpoint throttles bursts. RABIQ batches and retries requests; a check right after many others can take a few seconds.
- **GitHub without a token** allows 60 API requests per hour per IP address, which covers normal use.
- **Market data** comes from DexScreener. A token without a DexScreener pair shows no FDV or liquidity.
- **Note mentions stay hypotheses.** A mention records that you wrote about both tokens. RABIQ does not treat it as evidence of a relationship.

## FAQ

**Where are my notes stored?**
In the web app, in your browser's `localStorage`. In the CLI, as Markdown files in `./burrow` or `RABIQ_BURROW`.

**Does publishing a dossier upload it anywhere?**
No. RABIQ compresses the dossier into the link. Anyone with the link can read the parts you chose to include.

**Can I use my notes in Obsidian?**
Yes. Point Obsidian at the CLI burrow folder, or export a dossier from the web app as `.md`. `[[SYMBOL]]` links work in both.

**Why does a token show no deployer?**
The Pons V2 factory has no launch record for it, or the address is not a token contract.

**What is the yellow DEMO banner?**
It marks the demo burrow. We invented its addresses, numbers and repositories so you can explore the interface without network requests.

**Is anything here financial advice?**
No. RABIQ organises your research; you make the trading decisions.

## Roadmap

- [x] Web app: dossiers, deployer memory, since last check, strings, graph, publish
- [x] CLI over Markdown notes
- [x] Hosted web app at [rabiq.vercel.app](https://rabiq.vercel.app)
- [x] Landing page with a live case file and the on-chain launch census
- [ ] Deployer watchlist: flag new launches from deployers already in your burrow
- [ ] Publish a whole research map (several connected dossiers) as one link
- [ ] Optional GitHub token for higher repository rate limits

## Tests

```bash
npm test
```

The suite covers the logic that decides what users see: string detection (confirmed versus hypothesis), snapshot comparison rules, publish links (round trip, private fields excluded, hostile input sanitised) and Markdown escaping. CI runs the tests, the type check and the production build on Node 22.18 and 24.

## Project layout

```text
src/lib/chain.ts     Robinhood Chain client, Multicall3 token reads, Pons V2 factory
src/lib/sources.ts   DexScreener, GitHub, deployer launches, snapshots, diffs
src/lib/links.ts     confirmed vs hypothesis strings between dossiers
src/lib/share.ts     publish links, sanitising, Save to my brain merge
src/lib/burrow.ts    dossier model, localStorage, Markdown export
src/lib/demo.ts      synthetic demo burrow
src/lib/live.ts      live block height shared by every page
src/lib/pons.ts      bonding curve state, curve trades, v4 pool swaps, quote assets
src/lib/desk.ts      live market store: launches and trades in a rolling window
src/deskview.ts      live desk: tiles, table, inspector, trade tape
src/chart.ts         sparklines and candle charts
src/dossierlive.ts   dossier market block and deployer constellation
src/chrome.ts        header, ticker tape, cursor
src/docs.ts          How to use and Docs pages
src/landing.ts       landing page: live case file, the number, serial launchers
src/main.ts          web app
src/graph.ts         burrow graph
scripts/landing-data.ts  launch census behind public/landing.json
bin/rabiq.ts         CLI over Markdown notes
test/                node:test suite
```

## Built on

[viem](https://viem.sh) for Robinhood Chain reads · [Vite](https://vite.dev) for the web build · [Pons V2](https://www.ponsfamily.com) launch records · [DexScreener API](https://docs.dexscreener.com) · [GitHub REST API](https://docs.github.com/rest) · Multicall3 · hosted on [Vercel](https://vercel.com)

## $RABIQ

**$RABIQ** on Robinhood Chain · chain id 4663

Contract: `announced at launch`

## License

MIT. Nothing in this repository is financial advice.
