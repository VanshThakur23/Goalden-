# Crypto in Goalden: plan

Status: steps 1 and 2 built (2026-11-03); step 3 not started.

## What other apps do

- **Indian all-in-one trackers (INDmoney, Kuvera, Tickertape):** read mutual funds and shares through the
  CAS or the RBI Account Aggregator. Crypto exchanges are part of neither, so crypto there is typed in by
  hand or not tracked at all.
- **Crypto trackers and tax tools (KoinX, CoinTracker, CoinTracking):** connect an exchange with a
  read-only API key, or take an uploaded transaction-history CSV. CoinDCX's is under Profile, Reports,
  Transaction History, Download CSV. From that they work out holdings, cost, profit and a tax report.
- **The exchanges themselves (CoinDCX, WazirX):** give a yearly tax report and a trade-history download.

## Indian rules the app must get right

- A gain is taxed at a flat 30% plus 4% cess (plus surcharge at high incomes). Only the purchase cost is
  deductible. Until 31 Mar 2026 this was section 115BBH of the 1961 Act; since 1 Apr 2026 it is in the
  Income-tax Act 2025.
- A loss cannot be set off against any other income, including a gain on another coin, and cannot be
  carried forward.
- 1% TDS is deducted on sales above a yearly limit: ₹50,000 for most salaried people, ₹10,000 for
  others. It is a prepayment against the tax, not an extra tax.
- None of the equity rules apply: there is no ₹1.25 lakh tax-free limit and no long-term rate.
- Budget 2026 left all of the above unchanged.

## Plan, in order

1. **Crypto as its own category in My holdings** (small).
   - It sits beside the mix, like gold, and the tab says what share of everything it is.
   - The tab says plainly that falls of 70-80% have happened, for example Bitcoin from its Nov 2021 peak
     to Nov 2022.
   - A sale shows its own tax, per coin, at 31.2% of any gain, with no set-off. It is kept out of the
     tax-free booking and the yearly review's harvesting.
   - The advisor knows these rules.
2. **Bitcoin and Ether in Test Real Investments** (small, if Yahoo's BTC-INR and ETH-INR come through
   /api/history cleanly). This shows on real prices what a 5% slice does to a mix's risk and worst fall.
3. **Read an exchange's transaction-history CSV on the device** (medium). It is read the same way as the
   CAS: nothing is uploaded. It gives holdings and cost per coin for CoinDCX, WazirX and Binance, with a
   column-matching fallback for other exchanges. Then it shows "you against the index": the same money on
   the same days in a Nifty 50 index fund.

## Deliberately not doing

- **Exchange API keys:** even read-only keys are a secret we would have to hold.
- **Wallets and on-chain data.**
- **Buy or sell advice.**
- **A growth rate for crypto in any projection:** it has no long-run expected return to plan on, so the
  plan never counts on it.
