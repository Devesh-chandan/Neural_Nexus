# Neural Nexus: Screenshot Gallery

Screens from the running application, in the order a user meets them. Back to the [main README](../README.md).

> The names, balances and cases are **fictitious demo data**. The figures come from the real payoff, replay, suitability
> and explanation engines, run offline against the bundled price history. This is a decision-support prototype and not
> investment advice.

## Contents

1. [Landing and sign-in](#1-landing-and-sign-in)
2. [Onboarding](#2-onboarding)
3. [RM workspace](#3-rm-workspace)
4. [Historical replay](#4-historical-replay)
5. [Suitability assessment](#5-suitability-assessment)
6. [Other products](#6-other-products)
7. [Run dashboard](#7-run-dashboard)
8. [Client portal](#8-client-portal)

---

## 1. Landing and sign-in

| | |
|---|---|
| ![Landing page](images/01-landing.png) | ![Landing page, product section](images/02-landing-assessment-preview.png) |
| **`/`** Landing page | **`/`** Supported products and underlyings, with a sample assessment |

![Sign-in page](images/03-sign-in.png)

**`/login`** Separate **RM portal** and **Client portal** tabs. Authentication is handled by Supabase Auth.

## 2. Onboarding

![Client onboarding](images/04-client-onboarding.png)

**`/client/register`** A five-step wizard: how to register, identity, financials, suitability, review. A client can type their
details or import KYC and holdings from a brokerage app.

![RM onboarding](images/05-rm-onboarding.png)

**`/rm/register`** RM self-onboarding: institution, branch, access tier and authorised product types.

## 3. RM workspace

![RM workspace before selecting a client](images/06-rm-workbench-idle.png)

**`/rm`** The empty workspace: product builder, chart area, rationale and assessment panels, and the client list.

![RM workspace payoff graph](images/07-rm-payoff-graph.png)

Selecting a client loads their recorded profile and analyses the current terms immediately. The payoff at maturity is drawn
against the fixed-deposit baseline, with the client and RM rationale below.

![Scenario table](images/08-rm-scenario-table.png)

The scenario table shows the outcome for −30 % … +20 % moves in the underlying.

![Monte Carlo](images/10-rm-monte-carlo.png)

Block-bootstrap Monte Carlo percentile paths. It is labelled *statistical model-based, not a forecast*.

## 4. Historical replay

![Historical replay](images/09-rm-historical-replay.png)

The exact terms replayed on **20 real past market periods** of the same length, including the worst, best and most recent.
Each row shows the market move, whether the barrier was hit, the money back and the return. The data snapshot is hashed.

## 5. Suitability assessment

![Suitability assessment](images/11-rm-suitability-assessment.png)

One decision path produces the verdict: core rules, further checks and compliance gates. The panel then shows what the client
sees next to the RM briefing. Any `FAIL` gives **NOT SUITABLE**, any `REVIEW` gives **conditionally suitable**.

## 6. Other products

| | |
|---|---|
| ![Capital-Protected Note](images/12-rm-capital-protected-note.png) | ![Dual Currency Deposit](images/13-rm-dual-currency-deposit.png) |
| **CPN** Principal protection plus participation | **DCD** Interest plus conversion risk at the strike |

## 7. Run dashboard

![Analysis dashboard](images/14-analysis-dashboard.png)

**`/dashboard/:runId`** Overview, payoff, scenarios, replay, Monte Carlo, suitability, explanation and audit tabs for any saved
run, with JSON / HTML export and the issuer-credit disclosure.

## 8. Client portal

![Client portal](images/15-client-portal.png)

**`/client`** The recommended product in plain language, key terms, risk and return, a what-if projection against a fixed
deposit, and a redacted rationale. Clients never see compliance screening results or the RM briefing.

![Client profile](images/16-client-profile.png)

**`/client/profile`** Clients keep their risk appetite, horizon, loss tolerance and portfolio details up to date. Changes are
visible to their relationship manager.

---

*Screenshots were captured at 1440 px wide with Chrome against a local build.*
