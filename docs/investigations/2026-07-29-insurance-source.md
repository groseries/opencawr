# Investigation — re-basing per-model insurance premiums on a public source

**Date:** 2026-07-29 · **Scope:** research only, no code or data changed · **Network:** reachable
(all sources below were fetched live; PDFs text-extracted locally, one undocumented JSON endpoint
exercised). Scratch scripts: `.tmpinsurance/` (worktree) and the session scratchpad.

---

## 0. Bottom line

1. **A per-model dollar figure IS honestly derivable from public sources**, via a two-source bridge:
   HLDI's *relative* loss indices supply the vehicle effect, NAIC's state *average premiums* supply the
   dollars, and BLS CPI trends the NAIC vintage forward. The formula is specified in §4 and was
   built end-to-end against the real 71-vehicle corpus in §5.

2. **The blocker is not units — it is licence.** IIHS/HLDI content is copyrighted with an explicit
   ban on *repetitive* and *commercial* use without written permission, and the report PDFs are
   additionally stamped "DISTRIBUTION RESTRICTED". A public web app that ships HLDI-derived figures
   and stays up is squarely "repetitive use" by IIHS's own published definition. NAIC's report carries
   an equally standard all-rights-reserved notice. **Neither source is public-domain or openly
   licensed.** Verbatim quotes in §3.

3. **Therefore the recommendation is a two-step, not a one-step:**
   - **Step A (do now, no permission needed):** re-base the *level* and add *state* regionalization
     from NAIC — the state-average premium is a single fact per state per coverage, cited not
     republished, and this alone fixes the larger honesty gap (insurance is currently the only major
     cost component with **no** regional variation at all, over a real 2.15× state spread).
   - **Step B (gated):** email IIHS Legal for written permission before shipping HLDI-derived
     per-model relativities. Their published policy has a request process. If permission is refused,
     fall back to the coarser **state × body-class** model and say so in the copy.

4. **Blast radius is small and safe to absorb.** Insurance is 17.6% of $/mi (3rd of 10 components).
   A full HLDI×NAIC re-basing moves the median premium −26% and reorders the field by a **mean of
   1.2 rank places, max 7**; 8 of the current top 10 stay in the top 10; 2/71 statistical-tier changes.
   Every reference output regenerates, but the owner will not feel the ranking move.

5. **The strongest single argument for doing this at all:** the current per-model estimates correlate
   with a public-source re-basing at **Pearson r = 0.43, Spearman ρ = 0.47**. They are not noise, but
   they explain under a quarter of the variance of what the public data says. Several are ordered
   backwards — Hyundai Elantra is seeded near the *bottom* of the premium range and lands near the
   *top*; Chevy Bolt is seeded mid-pack and lands lowest of all.

---

## 1. What the engine actually needs

`packages/core/src/engine.ts:40-46`:

```ts
const insMult = inputs.insuranceMultiplier ?? constants.insurance_multiplier_USAA;   // 0.8
const fullCov = inputs.fullCoverageUsdYr ?? vehicle.specs.full_coverage_ins_usd_yr * insMult;
const liab    = constants.liability_only_usd_yr * insMult;                            // 1176 × 0.8
```

- **Unit required:** dollars per year, per model, pre-multiplier.
- **Current values:** 71 vehicles, `full_coverage_ins_usd_yr` from **1800** (Chevy Volt) to **3100**
  (Tesla Model 3), median **2150**, mean **2201**, 15 distinct values with heavy clumping
  (2150 ×16, 2100 ×13). The clumping is itself evidence of hand-assignment.
- **Effective values today:** full cover **$1,720/yr** at the median after ×0.8; liability floor
  **$941/yr**.
- **Age behaviour:** none. The premium is flat over the whole holding period; the only age-like
  mechanism is the switch to liability-only when book value drops below `full_cov_threshold_usd`
  ($6,000). Any replacement only has to match *that* level of granularity — it does not have to
  solve the age curve, which the model does not have today.

---

## 2. Candidate sources, evaluated

| Source | Reaches per-model? | Units | Geography | Vintage / cadence | Access | Licence |
|---|---|---|---|---|---|---|
| **IIHS-HLDI insurance loss results by make and model** | **Yes** — ~700 vehicle *series* per 3-MY window | **Relative index**, 100 = all-passenger-vehicle avg | **None** — state is explicitly standardized *out* | 3-model-year rolling windows, **2004-06 through 2022-24**, annual | Public HTML tool + undocumented JSON POST endpoint (§6); PDF reports | ✗ Copyright, no repetitive/commercial use w/o written permission |
| **NAIC Auto Insurance Database Report** | No — statewide only | **Dollars** (avg premium, avg expenditure, pure premium, loss ratio, claim freq/severity, by coverage) | 50 states + DC + countrywide | CY2019–2023; full report adopted **Dec 2025**, premium supplement **Jul 2025** | Free PDF | ✗ © 2025 NAIC, all rights reserved |
| **BLS CPI-U, motor vehicle insurance** (`CUUR0000SETE`) | No | Index (1982-84=100) | US city avg (+ regional series) | Monthly, ~2-week lag; **Jun 2026 = 858.481** | Free JSON API, no key needed for v2 basic | ✓ **US Government work — public domain** |
| **BTS "Average Cost of Owning and Operating an Automobile"** | No | Dollars/yr and ¢/mi, insurance line item | National | Annual, lagging | Free | ✓ Federal (public domain) — **but the underlying numbers are AAA/Vincentric** |
| **AAA "Your Driving Costs"** | No — 9 vehicle *categories* | Dollars/yr, full coverage | National | Annual (Sep) | Free PDF brochure | ✗ AAA copyright; sourced from Vincentric (commercial) |
| **State DOI rate-comparison tools** (CA DOI premium survey; TX TDI/OPIC HelpInsure) | **Partly** — TDI's data call specifies *make and model years* for its sample-rate profiles; CA's survey uses fixed driver/vehicle profiles | Dollars, per carrier | One state each | Annual-ish | Interactive web tools, no bulk export | Government records, but **not generalizable** — one state, a handful of profile vehicles |
| **SERFF rate filings** (per-carrier model-year/symbol relativity tables) | **Yes, in principle** | Rating relativities | Per state, per carrier | Per filing | Public-records portals, PDF, no bulk API | Public record, but per-carrier, unstructured, and enormous manual effort |
| **FHWA Highway Statistics** | No | — | — | — | — | No insurance premium series |
| Insurify / ValuePenguin / Bankrate / NerdWallet / The Zebra | Yes | Dollars per model | Varies | Varies | Scrape | ✗ Copyrighted compilations, restrictive ToS — **fails Spec §9's stated posture; do not use** |
| data.gov / open datasets | No real per-model US premium dataset found | — | — | — | — | — |

**Read of the table:** exactly two sources are load-bearing, and each supplies precisely what the
other lacks. HLDI has the model dimension and no dollars and no geography; NAIC has dollars and
geography and no model dimension. That complementarity is not a coincidence — HLDI *deliberately*
standardizes state, demographics, deductible and model year out of its indices so that what remains
is the vehicle effect. That is the single fact that makes a bridge possible at all.

### What HLDI actually publishes (named, precisely)

- **Series:** *HLDI Insurance Report*, one per coverage per 3-model-year window. Verified directly:
  - `R-23, April 2023` — *Collision losses, 2020–22 passenger cars, pickups, SUVs, and vans*
  - `C-22, April 2023` — *Comprehensive losses, 2020–22 …*
  - Parallel reports exist for property damage liability, bodily injury, PIP, medical payment, and
    a separate `WT-nn` whole-vehicle-theft series.
- **Table 6 ("… losses by series")** gives, per vehicle series: exposure (insured vehicle years),
  claim count, **relative claim frequency, relative claim severity, relative overall losses**, with
  the all-passenger-vehicle row carrying the dollar anchor.
- **The anchors are published in dollars.** R-23: collision claim frequency 6.1 per 100 insured
  vehicle years, claim severity **$8,739**, overall losses **$532 per insured vehicle year** (100 = $532).
  C-22: comprehensive frequency 80.4 per 1,000 IVY, severity **$2,356**, overall losses **$189**.
- **Reporting threshold:** 1,000 insured vehicle years OR 100 claims. R-23 reports 699 series.
- **Standardization:** "Losses were standardized by calendar year; model year; garaging state;
  number of registered vehicles per square mile (vehicle density); driver age, gender, and marital
  status; deductible; and risk." (R-23 Technical Appendix; method from HLDI A-77 (2008) / A-82 (2009).)
- **Publisher's own warning:** *"earlier model year results are not directly comparable to newer
  model year results, due to changes in computation methods."* This matters — see §4's error list.

### What NAIC actually publishes (named, precisely)

*2022/2023 Auto Insurance Database Report*, **adopted December 2025**, © 2025 NAIC.
`https://content.naic.org/sites/default/files/publication-aut-pb-auto-insurance-database.pdf`

Tables 1–5 give 50 states + DC + Countrywide, calendar years 2019–2023:

| Table | Coverage | Countrywide 2023 | CA 2023 | FL 2023 | State range 2023 |
|---|---|---|---|---|---|
| 1 | Liability average premium | **$736.65** | $660.84 | $1,294.57 | $331.50 (ND) – $1,294.57 (FL) |
| 2 | Collision average premium | **$463.71** | $607.06 | $468.92 | $306.78 (SD) – $663.87 (DC) |
| 3 | Comprehensive average premium | **$238.24** | $150.04 | $230.32 | — |
| 4 | Average expenditure | **$1,281.92** | $1,225.02 | $1,864.63 | — |
| 5 | Combined average premium | **$1,438.60** | $1,417.94 | $1,993.81 | **$926.02 (ME) – $1,993.81 (FL) = 2.15×** |

Combined average premium = liability + collision + comprehensive (verified: 736.65 + 463.71 +
238.24 = 1,438.60). Average expenditure is lower because it accounts for vehicles that don't buy
physical damage coverage. **"Combined average premium" is the right analogue for OpenCAWR's
`full_coverage_ins_usd_yr`; "liability average premium" is the right analogue for
`liability_only_usd_yr`.** Tables 6–32 additionally give pure premium, loss ratio, claim frequency
and claim severity by state and coverage — available if a loss-cost route is ever needed.

---

## 3. Licence and ToS — the decisive finding

### IIHS-HLDI

Site-wide policy at `https://www.iihs.org/copyright-information-and-privacy-policy`, verbatim:

> All content (such as images and text) available on the Insurance Institute for Highway
> Safety/Highway Loss Data Institute internet site is copyrighted property of the Institutes, unless
> indicated otherwise. The content on this website is made available for **limited noncommercial,
> educational and personal use only**; a user may download content to share with others for limited
> noncommercial and educational purposes without requesting specific permission. When using content
> for limited noncommercial, educational and personal use, the source of the content should be cited
> as www.iihs.org.
>
> **Repetitive** noncommercial, educational, or personal use and copying or redistribution in any
> manner **for commercial use is not permitted without written permission** from the Institute.

And their own footnoted definition of "repetitive", verbatim:

> For example, using a video or image in a PowerPoint presentation for a specific event and posting a
> copy of that presentation on your organization's website would be considered limited use.
> **Incorporating a video or image in a training course that will be distributed for a period of time
> would be considered repetitive use.**

A web app that embeds HLDI-derived numbers and stays online is "distributed for a period of time" —
repetitive use on IIHS's own example. Spec §9 also contemplates forming an LLC, which puts it in the
commercial bucket too. **Both triggers require written permission.**

The report PDFs go further. R-23 and C-22 both carry, verbatim:

> **COPYRIGHTED DOCUMENT, DISTRIBUTION RESTRICTED**
> ©2023 by the Highway Loss Data Institute. All rights reserved. Distribution of this report is
> restricted. No part of this publication may be reproduced, or stored in a retrieval system, or
> transmitted, in any form or by any means, electronic, mechanical, photocopying, recording, or
> otherwise, without the prior written permission of the copyright owner. Possession of this
> publication does not confer the right to print, reprint, publish, copy, sell, file, or use this
> report in any manner without the written permission of the copyright owner.

`robots.txt` disallows only `/logos/` and `/ratings-wall-display/`, so the JSON endpoint in §6 is not
robots-excluded — but robots.txt is not a licence, and the copyright policy governs.

**The one genuine mitigation, and it is the project's own established posture.** Spec §9 already
says: *"Individual prices are facts, but a substantial extract of a site's compilation and its ToS
are not. Ship fitted coefficients … never stored copies of a site's listing tables."* Under US law
(Feist) the individual loss indices are facts; the *compilation* is what carries thin copyright. So
the §9-consistent form of an HLDI re-basing is **fitted coefficients, not a stored 71-row table**.
§5 quantifies what that costs: a body×etype coefficient fit retains only **25%** of the per-model
variance. That is the whole tension — the legally cleanest form of the HLDI route throws away most
of the reason to take it.

### NAIC

*2022/2023 Auto Insurance Database Report*, verbatim:

> © 2025 National Association of Insurance Commissioners. All rights reserved. Printed in the United
> States of America. No part of this book may be reproduced, stored in a retrieval system, or
> transmitted in any form or by any means, electronic or mechanical, including photocopying,
> recording, or any storage or retrieval system, without written permission from the NAIC.

Boilerplate, and NAIC's stated purpose for the database is to make cost information "readily
available to insurance regulators monitoring the market, **and to the public**." Taking **51 numbers
per coverage** (one per state) is a thin, factual extract with clear attribution — materially lower
exposure than a 700-row per-model table, and comparable to what `region.ts` already does with AAA gas
prices, EIA electricity and DMV fee compilations (`ASSUMPTIONS.md` §G). **This is not a legal
opinion.** But NAIC state averages sit inside the risk envelope the project has already accepted;
HLDI per-model tables do not.

### BLS

`CUUR0000SETE` (CPI-U, motor vehicle insurance, US city average, NSA) is a US Government work in the
public domain, served by a free JSON API. **This is the only unambiguously clean source in the set.**

---

## 4. The units bridge — specified

HLDI's index is not dollars, and HLDI has no geography. NAIC has dollars and geography and no model.
The bridge multiplies them. It is sound *because* of HLDI's standardization: the index is already
purged of state, demographics, deductible and model year, so it is a pure vehicle multiplier looking
for an absolute base — and NAIC supplies exactly that base, per state, per coverage.

### Formula

For vehicle *v* in state *s*:

```
                                  ┌  idx_coll(v)                idx_comp(v)  ┐
premium_full(v, s) = E × [ P_liab(s) + ─────────── × P_coll(s) + ─────────── × P_comp(s) ]
                                  └      100                        100      ┘

premium_liab(s)    = E × P_liab(s)
```

| Symbol | Meaning | Source | Value used below |
|---|---|---|---|
| `P_liab(s)` | Liability average premium, state *s* | NAIC 2022/2023 ADB Report, Table 1, CY2023 | CA 660.84 · CW 736.65 |
| `P_coll(s)` | Collision average premium | NAIC Table 2, CY2023 | CA 607.06 · CW 463.71 |
| `P_comp(s)` | Comprehensive average premium | NAIC Table 3, CY2023 | CA 150.04 · CW 238.24 |
| `idx_coll(v)` | Relative collision **overall losses** (100 = all-vehicle avg) | HLDI, one fixed MY window | see §5 |
| `idx_comp(v)` | Relative comprehensive overall losses | HLDI, same window | see §5 |
| `E` | Escalator, CY2023 → today | BLS `CUUR0000SETE` | **1.199** (Jun 2026 / CY2023 avg 716.004 → 858.481) |

**Sanity check the bridge against itself.** At `idx = 100` for both coverages the formula must return
the state's own combined average premium — and it does: 660.84 + 607.06 + 150.04 = **$1,417.94** =
NAIC's published CA combined average premium exactly. The bridge is an identity at the average and
a relativity away from it. That is the property that makes it defensible rather than a fudge.

Second sanity check, against the *current* numbers: CA combined × E = 1,417.94 × 1.199 = **$1,700**.
Today's median seed premium after the ×0.8 multiplier is **$1,720**. The existing estimates are, in
aggregate level, almost exactly a CPI-trended California full-coverage average. Whoever produced them
was not making it up — they had the level roughly right. What they did not have right is the
*ordering across models* (§5).

### What anchors what — and what is deliberately NOT bridged

- **Liability is anchored, not scaled by vehicle.** HLDI does publish PD-liability and BI indices,
  but liability loss is dominated by driver and venue, and the engine already carries one scalar
  `liability_only_usd_yr`. Scaling it by vehicle would add error, not remove it. Only the
  **physical-damage** half varies by model — which is also exactly what "full coverage" means over
  "liability only", so the decomposition lands cleanly on the engine's existing shape.
- **Injury coverages (PIP / MedPay / BI) are folded into `P_liab(s)`.** The HLDI site publishes
  those as relative *claim rates*, not overall losses, so they are not on the same footing as
  collision/comprehensive anyway. Do not use HLDI's composite "AllCoverages" index — it mixes injury
  coverages the liability constant already covers, and would double-count.

### Residual error — the honest list

1. **Loss index ≠ premium index (largest, and unquantified).** Insurers rate physical damage off
   filed symbol/model-year tables that are credibility-weighted, capped, and lagged. Premium
   dispersion across models is *narrower* than loss dispersion. Applying a loss relativity directly
   to a premium average will **overstate** model-to-model spread by an unknown factor. A shrinkage
   coefficient (`idx' = 100 + k(idx − 100)`, k ≈ 0.7–0.8) would be defensible but is a judgment call
   requiring its own ledger row. **Recommend shipping k = 1.0 and disclosing the direction of the
   bias rather than inventing a k.**
2. **Vehicle age is not modeled — by either source, or by the engine.** HLDI standardizes model year
   out; NAIC averages over all ages. The result is "the premium for this model at fleet-average
   vehicle age," which is the same claim the current flat number already makes. Not a regression, but
   not a fix either. There is direct evidence of how big this effect is: HLDI's collision overall
   loss for MY2020-22 is **$532**, while NAIC's fleet-wide collision *premium* is **$463.71** —
   the newest three model years carry ~15% more collision loss than the whole fleet pays in premium.
   Real physical-damage premium falls materially as a car ages, and neither the old model nor the
   re-based model captures that.
3. **Deductible mismatch.** HLDI standardizes deductible; NAIC averages over the market mix (modal
   $500). The engine's `collision_deductible_usd` is **750**. Small, one-directional (overstates cost).
4. **Cross-window incomparability.** HLDI's own warning. All 71 vehicles must be read from **one**
   model-year window, not each from the window nearest its `pinned_buy_year_est`. This costs
   coverage (§5) and is non-negotiable if the publisher's caveat is to be respected.
5. **Sub-state variation is not addressed.** Spec §4 already notes "premium is set by *garaging ZIP*,
   not registration state." Within-state urban/rural spread often exceeds between-state spread. NAIC
   has no sub-state granularity, so a state anchor is a partial fix that must be labeled as such.
6. **Vintage.** NAIC's latest data year is **CY2023**; the escalator carries ~2.5 years of drift on
   BLS's national index, which is a national trend applied uniformly and will not track states that
   moved differently. The escalator is also month-sensitive: `CUUR0000SETE` peaked at 897.406
   (Feb 2026) and is 858.481 (Jun 2026) — Jun-2026-point gives E = 1.199, a trailing-12-month average
   gives ≈ 1.24. **Use a calendar trailing-12 average and pin the snapshot date**, per the precedent
   `ASSUMPTIONS.md` §G already sets for the electricity refresh.
7. **Series-identity mismatch.** HLDI series are body-style/drive granular ("Toyota RAV4 4dr 4WD")
   and do *not* separate several variants OpenCAWR treats as distinct models — see §5.

---

## 5. Empirical validation against the real corpus

Everything below was measured, not assumed.

### 5.1 Coverage — can the 71 vehicles actually be matched?

Harvested 2,587 HLDI series rows across four windows via the endpoint in §6, then matched on
make + model tokens with a deliberately naive matcher (no per-model overrides):

| Window | Matched / 71 | Misses |
|---|---|---|
| 2022–2024 | 62 | Bolt EV, Volt, K4, Mazda3, Fiat 500, Passat, 500X, 996 Carrera, 996 Turbo |
| **2019–2021** | **64** | Volt, K4, Mazda3, Fiat 500, CX-90, 996 Carrera, 996 Turbo |
| 2016–2018 | 59 | + ID.4, Ranger, Ascent, Palisade, Telluride, CX-90, Grand Cherokee L |
| 2013–2015 | 49 | many |
| nearest-window-per-car (illustrative only; violates HLDI's caveat) | 67 | K4, Mazda3, 996 Carrera, 996 Turbo |

**2019–2021 is the best single window at 64/71 (90%)** with no hand-tuning. Of the 7 misses, three
are naming (`Mazda3` → HLDI's "Mazda 3"; the two Porsche 996s are HLDI "Porsche 911" in the 2004–06
window) and four are genuinely absent (Kia K4 too new; Chevy Volt and Fiat 500 discontinued before
the window). Expect **66–67/71 with a small override table**, and 4–5 vehicles needing a documented
class-average fallback — the same proxy pattern `packages/pipeline`'s `proxy.ts` already uses.

**The harder matching problem is variant identity, not name spelling.** HLDI does not split several
things OpenCAWR treats as separate models:

| OpenCAWR model | HLDI series it resolves to | Consequence |
|---|---|---|
| Toyota Prius Prime | "Toyota Prius hybrid" | PHEV inherits the HEV's index |
| Toyota RAV4 Prime | "Toyota RAV4 4dr / 4dr 4WD" | same |
| Chrysler Pacifica PHEV | "Chrysler Pacifica" | same |
| Kia Niro (hybrid) | averaged with "Kia Niro electric 4dr" | HEV/BEV blended |
| Ford Ranger (old compact) | 2019+ Ranger crew cab | **wrong generation** |
| Toyota Sienna (V6) | "Toyota Sienna hybrid van" | wrong powertrain in that window |

Several of these are precisely the cars the current data marks as distinctive (the Volt at 1800 and
the Model 3 at 3100 are the two extremes of the seed range). A re-basing must decide, per model,
whether to accept the blended index or fall back to a class average — and log each decision.

### 5.2 Do the current estimates agree with the public data?

Over the 65 vehicles with both indices, comparing the seed `full_coverage_ins_usd_yr` against the
§4 bridge at the CA anchor:

- **Pearson r = 0.43**, **Spearman ρ = 0.47**.
- Level: seed median **$2,150** → re-based median **$1,586** (**−26%**).
- Spread: seed 1.72× (1800→3100) → re-based 1.63× ($1,329→$2,170). **Nearly identical width, largely
  different ordering.**

Biggest disagreements:

| Model | Seed | Re-based (CA) | Δ |
|---|---:|---:|---:|
| Tesla Model 3 | 3,100 | 2,096 | −1,004 |
| Toyota Sequoia | 2,450 | 1,605 | −845 |
| Chevy Tahoe | 2,350 | 1,508 | −842 |
| Chevy Bolt EV | 2,075 | **1,329 (lowest in field)** | −746 |
| Hyundai Sonata | 2,150 | 2,170 | +20 |
| **Hyundai Elantra** | **2,050 (near-lowest)** | **2,157 (2nd highest)** | **+107** |

The Elantra inversion is the clearest single case: HLDI puts its relative collision losses at **159**
and comprehensive at **117** for 2022–24 — among the worst in the corpus, consistent with the
well-documented Hyundai/Kia theft wave that HLDI itself has bulletins on (`42-07`, 2025). The seed
data has it as one of the *cheapest* cars to insure. That is not a rounding disagreement; it is
backwards.

### 5.3 Blast radius (measured, `.tmpinsurance/blast2.ts`)

Component shares of $/mi across all 71 vehicles at defaults, from the engine's own breakdown:

```
depreciation 29.1% · energy 27.9% · insurance 17.6% · maintenance 14.1% · tires 4.6%
· repairs 3.5% · useTax 2.1% · registration 0.6% · battery 0.3% · totalLoss 0.1%
```

Insurance is confirmed **3rd of 10**, median share 17.4%, range 8.8% (Porsche 996 Turbo) to 27.7%
(Tesla Model 3). Applying the §4 bridge (CA anchor, 65 matched vehicles re-based, 6 unmatched scaled
by the median ratio):

| Scenario | mean \|Δ p50\| | max Δ | mean rank move | max rank move | new in top 10 | tier changes |
|---|---|---|---|---|---|---|
| Re-based, multiplier kept at 0.8 | $0.0230/mi (5.5%) | −$0.0395 (Model 3) | **1.21 places** | 7 | 2/10 | **2/71** |
| Re-based, multiplier reset to 1.0 | $0.0085/mi (2.0%) | +$0.0239 (Elantra) | 1.35 places | 8 | 2/10 | 5/71 |

Reference scenarios for calibration: flattening every car to a single national average moves ranks by
0.90 places on average; doubling the current spread moves them 1.01. **The re-basing sits in the same
small band.** Top 12 before → after (multiplier 0.8):

```
before: Bolt EV | Prius | Volt | Corolla | Camry Hybrid | Prius Prime | Civic | K4 | Elantra | Camry | Accord | RAV4 Hybrid
after:  Bolt EV | Prius | Corolla | Prius Prime | Volt | Camry Hybrid | Civic | K4 | Accord | RAV4 Hybrid | Niro | Camry
```

Largest single move is **Hyundai Elantra #9 → #16**. The headline ordering (Bolt / Prius / Corolla at
the top) is unchanged. **Answer to the owner's real question: no, this will not materially reorder
the field.** It regenerates every reference output — a deliberate, reviewed numbers-change event per
`reference.test.ts`'s own docstring — but the app will look almost the same.

---

## 6. Access mechanism (reproducible)

The public HTML tool at `iihs.org/research-areas/auto-insurance/insurance-losses-by-make-and-model`
is a Vue app backed by an **undocumented JSON endpoint**:

```
POST https://www.iihs.org/api/hldilosses/getviewmodel
Content-Type: application/json
{"query":{"ModelYears":"2019-2021","VehicleClassId":8,"VehicleSizeId":3,"Coverage":"collision"}}
```

- No auth, no key, ~1.3 s/request. `VehicleClassId` ∈ {1,2,3,4,5,6,8,9,11,12,13,14},
  `VehicleSizeId` ∈ {0..5}. No wildcard — the grid must be enumerated (72 requests/window).
- **Each response row carries all six coverages plus a composite**, regardless of the `Coverage`
  parameter: `Collision`, `PropertyDamage`, `Comprehensive`, `Pip`, `MedPay`, `BodilyInjury`,
  `AllCoverages` — each as `{Percentage, NumericValue, DisplayText, DisplayClass}`, where
  `NumericValue` is the **full-precision index** (e.g. 123.9558), better than the rounded PDF tables.
- `ModelYears` spans **"2004-2006" … "2022-2024"** — the whole used-car range OpenCAWR needs.
- Archive PDFs linked from the same page cover 1992–2006 composites only.

This is the cleanest technical route by a wide margin. It is *also* the route the copyright policy in
§3 most directly restricts: enumerating the grid on a schedule is repetitive use. **Do not automate
it into a pipeline before permission is in hand.**

BLS is a proper public API: `POST https://api.bls.gov/publicAPI/v2/timeseries/data/` with
`{"seriesid":["CUUR0000SETE"],"startyear":"2023","endyear":"2026"}`, no key required at the basic tier.

NAIC is a single 9.4 MB PDF, parsed cleanly with `pdftotext -layout`; Tables 1–5 are on pp. 15–25 and
extract to 52 rows each with a two-line regex. Re-pull annually (~July for the supplement, ~December
for the full report).

---

## 7. Interaction with the existing constants

### `insurance_multiplier_USAA` = 0.8 — **not a double-count; becomes correct for the first time**

Today the multiplier is applied to a number of unknown provenance. If the estimates were already
USAA-flavoured, ×0.8 double-discounts; if they were market averages, it is right. **Nobody can tell,
and that ambiguity is a second, quieter instance of the same provenance gate.** Once the base is a
published market average, ×0.8 means exactly what `controls.tsx:130` already claims it means
("Insurance vs. average", hint "0.8 = a 20% cheaper insurer"). The label becomes true.

Recommendation: keep the mechanism, **rename the constant to `insurance_multiplier` and change the
default to 1.0**, offering 0.8 as a named USAA preset. A public tool's default output should be
"market average", not "one active-duty user's carrier". This is an owner decision (it is the second
scenario row in §5.3 and costs 3 extra tier changes), and it is separable from the re-basing itself.

### `liability_only_usd_yr` = 1176 — **directly replaceable, and should become regional**

NAIC Table 1 *is* this quantity, published per state. CPI-trended: countrywide **$883**, CA **$792**,
FL **$1,552** (current constant ×0.8 = $941, i.e. between countrywide and Florida). The state spread
here is **3.9×** ($331 ND → $1,295 FL) — the widest of any insurance component, and today the engine
has one number for the whole country.

Blocker: `liability_only_usd_yr` is read straight off `constants` in `engine.ts:44` with **no
`EngineInputs` override**. Making it regional requires one new optional input, e.g.
`liabilityOnlyUsdYr?: number`. Small, but it is an engine signature change.

### `full_cov_threshold_usd` = 6000 — **needs recalibration, but recalibrate it separately**

The threshold decides when dropping to liability-only is rational, which is inherently a function of
the *physical-damage premium* — and the re-basing changes that premium. Today the physical-damage
delta is $2,150 − $1,176 = **$974/yr** pre-multiplier; under the CA-anchored bridge at index 100 it
is (607.06 + 150.04) × 1.199 = **$908/yr**. Close enough that the threshold does not *break*.

But it is worth noting the threshold looks too low on its own terms even now: at $6,000 book value,
expected physical-damage recovery is roughly 6.1%/yr × ($6,000 − $750 deductible) + ~8%/yr ×
min(severity, book) ≈ **$480/yr** against a **$779–974/yr** premium. A rational owner drops full
coverage well above $6,000. **Recommendation: hold `full_cov_threshold_usd` fixed through the
re-basing so the effect is isolated, then re-derive it as a function of the physical-damage premium
as a separate, separately-reviewed change.** Flagging, not fixing, per CLAUDE.md §3.

### `collision_deductible_usd` = 750

Mismatched against both sources (HLDI standardizes deductible; NAIC reflects a ~$500-modal mix).
One-directional, small. A ledger row, not a change.

---

## 8. Regionalization — does this fit `apps/web/src/region.ts`?

**Insurance is not regionalized today.** `RegionRow` carries exactly four fields —
`gasUsdPerGal`, `elecUsdPerKwh`, `useTaxRate`, `registrationUsdYr` — for 50 states + DC. A Maine user
and a Florida user currently see the same $2,150 premium, against a real NAIC spread of **$926 → $1,994
(2.15×)**. For comparison, `region.ts`'s gas spread is roughly $3.49–$5.65 (1.6×) and its registration
spread $24–$380. **Insurance would be the widest-varying field in the table** — arguably a bigger
honesty problem than the per-model provenance the gate is actually about.

A state-anchored approach fits the existing mechanism almost exactly:

- Add three NAIC columns to `RegionRow`: `liabilityUsdYr`, `collisionPremiumUsdYr`,
  `comprehensivePremiumUsdYr` (all CPI-trended, snapshot-dated, with a `sources` string exactly like
  the existing `SOURCES` constant).
- Same ZIP → state resolution, same "prefill then stay editable in the Assumptions rail" property,
  same `ASSUMPTIONS.md` §G write-up pattern.

**One design trap.** `EngineInputs.fullCoverageUsdYr` currently means *"a real quote — use as-is,
bypassing the multiplier"* (`engine.ts:42-43`, and the comment says so). A region prefill is **not** a
real quote; it is an average that should still be scaled by "your insurer vs. average". So `region.ts`
must **not** write into `fullCoverageUsdYr`. The correct shape is:

- vehicle record stores **unitless relativities** (`ins_rel_collision`, `ins_rel_comprehensive`),
- constants/region store the **dollars**,
- the engine composes them, then applies the multiplier,
- `fullCoverageUsdYr` keeps its current "real quote overrides everything" meaning, untouched.

This also happens to be the §9-friendly shape: the repo stores relativities and a documented formula,
not a copy of anyone's dollar table. Note it is a **schema change** to `Vehicle.specs` and therefore
touches `types.ts`, `engine.ts`, the pipeline's `assemble`/`proxy` paths, and every reference output.

---

## 9. Recommendation

**Split the gate. Ship the part that is clean; gate the part that is not.**

### Step A — NAIC + BLS re-basing and regionalization. Do this now.

Replace the *level* and add the *geography*, without touching per-model relativity yet:

- `liability_only_usd_yr` ← NAIC Table 1 per state, CPI-trended (engine gains one optional input).
- `full_coverage_ins_usd_yr` ← for now, NAIC combined average premium per state (Table 5),
  CPI-trended — i.e. **every model at index 100**, explicitly and visibly flat.
- Three new `region.ts` columns; `insurance_multiplier` default → 1.0 (owner call).
- Copy: "state-average full-coverage premium (NAIC 2023, CPI-trended); this estimate does not yet
  vary by model."

This is defensible on the project's own established terms (51 factual state numbers, cited, exactly
like the existing AAA/EIA/DMV columns), it fixes the widest un-modeled variance in the app, and it
**removes the unprovenanced numbers** — which is what the gate actually asks for. Cost: the tool
temporarily says less about model-to-model insurance differences than it does today. That is the
honest trade, and §5.2 shows the current model-level signal is only r = 0.43 correlated with reality
anyway — so little of real value is lost.

### Step B — HLDI per-model relativities. Gated on written permission.

Email `legal@iihs.org` per their published request process (they ask for: a description of the content
sought, the project and how the content supports it, audience make-up and size, distribution channel
and duration, and whether access will be charged for). If granted, implement §4 with a **single fixed
model-year window (2019–2021, 64/71)**, an override table for the naming misses, a documented
class-average fallback for the 4–5 genuinely absent vehicles, and a per-model provenance flag
mirroring the existing `provenance: "curated" | "proxied"` pattern. §5.3 says the ranking impact is
mild, so this is safe to land once cleared.

### If permission is refused — the honest fallback

Do **not** scrape it anyway, and do **not** substitute a commercial aggregator (Insurify /
ValuePenguin / Bankrate / NerdWallet / The Zebra), which fails Spec §9's stated posture more clearly
than HLDI does. Instead model insurance at **state × body-class** and label it as coarser than the
current per-model numbers pretend to be. Two ways to build the class factors:

- from HLDI class/size *figures* rather than the series table (fewer numbers, still HLDI-derived —
  still needs permission, but a far smaller ask); or
- from AAA "Your Driving Costs" category insurance figures (9 categories, national, also copyrighted,
  and Vincentric-derived) — weaker.

§5.3 measured the cost of going coarse: a body×etype coefficient fit retains only **25% of the
per-model variance** ($88 sd vs $177 sd; $153 sd of within-group spread lost). **The negative result
is fully acceptable here** — at 17.6% of $/mi and a measured 1.2-place mean rank effect, a coarser
insurance model that is *sourced* is worth more to a public launch than a per-model model that is
*invented*.

### What NOT to do

- Do not build a paste-your-quote UI (already rejected by the owner, and it does not generalize).
- Do not use HLDI's composite `AllCoverages` index — it double-counts the injury coverages the
  liability constant already carries.
- Do not mix HLDI model-year windows — the publisher says they are not comparable.
- Do not invent a shrinkage factor `k` to correct loss-index-vs-premium-index dispersion. Ship k = 1
  and disclose the bias direction.
- Do not touch `full_cov_threshold_usd` in the same change.

---

## 10. Ledger rows this would create (`ASSUMPTIONS.md` §A/§D/§G)

| Row | Class |
|---|---|
| Liability premium = NAIC 2022/2023 ADB Report Table 1, CY2023, per state, × BLS `CUUR0000SETE` escalator; snapshot-dated | SOURCED |
| Full-coverage base = NAIC Table 5 combined average premium (Step A) / Table 1+2+3 decomposition (Step B) | SOURCED |
| CPI escalator uses a trailing-12-month average, not a single month (index is volatile: 897.4 Feb 2026 → 858.5 Jun 2026) | JUDGMENT |
| Per-model relativity = HLDI relative overall losses, collision and comprehensive, **one fixed MY window**, used under written permission dated ____ | SOURCED + LEGAL GATE |
| Loss relativity applied to a premium average with no shrinkage (k = 1) — **overstates model-to-model spread by an unknown amount** | JUDGMENT, disclosed |
| Insurance premium does not vary with vehicle age; neither source models it. HLDI MY2020-22 collision loss $532 vs NAIC fleet collision premium $463.71 shows the effect is real and ~15%+ | DOCUMENTED LIMITATION |
| Premium anchored to **state**, not garaging ZIP; within-state spread often exceeds between-state (Spec §4 already flags this) | DOCUMENTED LIMITATION |
| Variant blending: Prius Prime / RAV4 Prime / Pacifica PHEV / Niro inherit non-PHEV or blended HLDI indices; old-gen Ranger has no own series | JUDGMENT, per-model |
| 4–5 vehicles (Kia K4, Porsche 996 ×2, and window-dependent others) have no HLDI series — class-average fallback, flagged like `provenance: "proxied"` | JUDGMENT |
| `insurance_multiplier` default 1.0, USAA 0.8 as a preset (if adopted) | OWNER DECISION |
| `full_cov_threshold_usd` = $6,000 left unchanged but now visibly inconsistent with the physical-damage premium (~$480/yr expected recovery vs ~$780–970/yr premium) | OPEN |
| `collision_deductible_usd` = 750 vs NAIC's ~$500-modal market mix and HLDI's standardized deductible | DOCUMENTED |

---

## 11. Sources

- HLDI, *Insurance Report R-23: Collision losses, 2020–22 passenger cars, pickups, SUVs, and vans*,
  April 2023 — `https://www.iihs.org/media/c4bc9079-3c48-4f7f-ad15-662f94157a8b/10ocxw/HLDI%20Research/Insurance%20reports/hldi_collision_r23.pdf`
- HLDI, *Insurance Report C-22: Comprehensive losses, 2020–22 …*, April 2023 —
  `https://www.iihs.org/media/733cd489-e70d-49b7-b34f-89616403e9ea/99a91g/HLDI%20Research/Insurance%20reports/hldi_comprehensive_c22.pdf`
- IIHS-HLDI, *Insurance losses by make and model* (interactive) —
  `https://www.iihs.org/research-areas/auto-insurance/insurance-losses-by-make-and-model`
- IIHS-HLDI, *Copyright information and privacy policy* —
  `https://www.iihs.org/copyright-information-and-privacy-policy` (retrieved 2026-07-29)
- NAIC, *2022/2023 Auto Insurance Database Report*, adopted December 2025 —
  `https://content.naic.org/sites/default/files/publication-aut-pb-auto-insurance-database.pdf`
- NAIC, *2023 Auto Insurance Database Average Premium Supplement*, released July 8 2025 —
  `https://content.naic.org/sites/default/files/aut-db_1.pdf`
- BLS, CPI-U series `CUUR0000SETE` (motor vehicle insurance, US city average, NSA) —
  `https://api.bls.gov/publicAPI/v2/timeseries/data/`
- BTS, *Average Cost of Owning and Operating an Automobile* —
  `https://www.bts.gov/content/average-cost-owning-and-operating-automobilea-assuming-15000-vehicle-miles-year`
- AAA, *Your Driving Costs* 2025 brochure —
  `https://newsroom.aaa.com/wp-content/uploads/2025/09/AAA-Brochure-Your-Driving-Cost-9.2025.pdf`
- TDI/OPIC, *HelpInsure* — `https://www.helpinsure.com/auto.html`
- CA DOI, *Compare Insurance Premiums* — `https://insurance.ca.gov/01-consumers/105-type/9-compare-prem`
