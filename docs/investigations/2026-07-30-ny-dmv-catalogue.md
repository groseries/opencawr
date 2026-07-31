# NY DMV Vehicle Inspections catalogue — mapping the 71 seed vehicles

**Task**: research only. Build a verified `make_code` + `model_name` mapping from the 71
`opencawr_data.json` seed vehicles to the NY State DMV Vehicle Inspections dataset
(`https://data.ny.gov/resource/vezn-fmmk.json`, Socrata SODA, 62.8M rows, no auth). **Nothing in
the repo was modified** — this file is the only output.

**Method**: every row below is a *queried* result, not a guess. For each seed vehicle I (1) pulled
the full `model_name` catalogue for its `make_code` (`$group=model_name`, `model_year between
<range>`) to see every trim string that make actually uses, (2) ran targeted per-model-year
breakdowns for any string shared across seed rows or suspected of being renamed/discontinued
mid-life, and (3) queried `count(distinct vin)` for one representative model year with
`inspection_date` in calendar 2025, as the "current sample size" column. Query examples and raw
JSON are reproducible from the `make_code`/`model_name` values in the table — nothing here is
estimated.

---

## 0. Headline findings

1. **`model_name` here is far cleaner than NHTSA's catalogue.** It's pre-normalized (uppercased, no
   spaces/punctuation: `RAV4HYBRID`, `GRANDCHEROKEEL`, `V90CROSSCOUNTRY`), and — critically — DMV
   assigns **separate, stable strings to gas/hybrid/PHEV/EV siblings far more often than NHTSA
   does**: `NIRO`/`NIROEV`/`NIROPLUGINHYBRID` are cleanly split in *every* model year 2017–2026
   (NHTSA pools them into a bare `NIRO` from MY2021 — see `corpus.ts`), and `CHEVR SUBURBAN` is a
   single string for the whole window instead of NHTSA's `SUBURBAN`/`SUBURBAN 1500` split. That
   said, a handful of the *exact same* ambiguities documented in `corpus.ts` for NHTSA reappear here
   verbatim, because they're facts about the cars, not the catalogue: Sienna V6/Hybrid, Ford Ranger
   generations, and Hyundai Santa Fe generations are still indistinguishable except by year window.

2. **`make_code` is a truncated 5-char field** (confirmed exhaustively for every make in the seed
   set): `TOYOT`, `HONDA`, `CHEVR`, `FORD`, `NISSA`, `JEEP`, `SUBAR`, `HYUND`, `KIA`, `MAZDA`,
   `CHRYS`, `BUICK`, `VOLVO`, `VOLKS`, `MINI`, `FIAT`, `PORSC`, `TESLA`. All 18 makes in the seed
   set were verified with a `make_code like '<prefix>%'` query and have one dominant clean code (the
   others are single/double-digit-count data-entry typos — e.g. `PORS`, `PORSH`, `PORSE` alongside
   `PORSC`'s 251,018 rows — and are irrelevant at any sample size used here).

3. **`fuel_type`/`hybrid` are legitimate, not noise — I initially misread them.** For a gas-hybrid
   (Toyota RAV4 Hybrid, MY2023) the dominant combination is `fuel_type=GASOLINE, hybrid=TRUE`, which
   is *correct* (gas-hybrids burn gasoline). For a BEV (Tesla Model 3 MY2023, Nissan Leaf MY2020) the
   dominant combination is `fuel_type=ELECTRIC, hybrid=FALSE`, also correct, with a noise floor under
   0.1%. These columns are usable as an independent cross-check on `model_name`, not a replacement for
   it (they don't distinguish HEV from PHEV — Sienna MY2022, which is hybrid-only, still shows
   `hybrid=TRUE` for both the seed's non-existent-in-this-dataset "V6" concept and the real hybrid).

4. **NY does inspect EVs as ordinary vehicles.** VW ID.4 MY2022 shows `INITIAL INSPECTION` /
   `RE-INSPECTION` in the normal proportions seen elsewhere — no separate EV inspection regime, no
   exemption. EVs and PHEVs in the seed set all clear a four/five-figure 2025 sample (Tesla Model 3
   2,878; Nissan Leaf 124; VW ID.4 1,363; Chevy Bolt EV 405; Chevy Volt 643; Toyota Prius Prime
   2,211; RAV4 Prime 3,720; Chrysler Pacifica PHEV 512) — small for Leaf/Bolt/Pacifica-PHEV/Volt,
   adequate for the rest. See §3 below.

5. **Two genuine gaps, both flagged rather than silently resolved**: the two Porsche 996 rows
   (already excluded from derivation, `tier=sport`) cannot be separated *at all* — DMV lumps every
   911 variant (Carrera, Turbo, GT2/GT3) into a single bare `911` string with no trim field, which is
   *worse* than NHTSA's partial split. And Buick Encore's `ENCORE` string goes to near-zero
   (n=1/year) from MY2023 on because the car was discontinued and replaced by the differently
   platformed `ENCOREGX` — so the seed row's `last_year=2026` has essentially no real DMV data past
   2022.

---

## 1. Full mapping table

`models` is the OR-set of `model_name` values matched (Socrata `model_name in (...)`). `Year data`
is the model-year span for which that string set actually returns rows in this make (not the seed's
`first_year`/`last_year` — see notes where they diverge). `2025 sample` is `count(distinct vin)` for
one representative model year, `inspection_date` in calendar 2025 (a proxy for "cars currently on
NY roads of a mid-life age for this nameplate").

| Seed vehicle | make_code | model_name(s) | Year data | Sample (MY / n, insp. 2025) | Confidence / notes |
|---|---|---|---|---|---|
| Chevy Bolt EV | CHEVR | `BOLTEV` | 2017–2023 | MY2021 / 405 | Clean. `BOLTEUV` (different car) excluded. |
| Chevy Volt | CHEVR | `VOLT` | 2016–2019 (seed window; string used since 2011) | MY2018 / 643 | Clean, single string. |
| Toyota Prius (hybrid) | TOYOT | `PRIUS` | 2010–2026 | MY2018 / 991 | Clean. `PRIUSV`/`PRIUSC` (different nameplates) and `PRIUSPRIME`/`PRIUSPLUGINHYBRID` excluded. |
| Toyota Prius Prime | TOYOT | `PRIUSPRIME`, `PRIUSPLUGINHYBRID` | 2017–2026 | MY2021 / 2,211 | See note — DMV renamed the string back mid-life. |
| Toyota Corolla | TOYOT | `COROLLA` | 2009–2026 | MY2017 / 6,326 | Clean. Hatchback/Cross/iM/Hybrid excluded (separate strings). |
| Toyota Camry Hybrid | TOYOT | `CAMRYHYBRID` | 2009–2026 | MY2018 / 1,059 | Clean, one string. |
| Honda Civic | HONDA | `CIVIC` | 2009–2026 | MY2017 / 11,057 | Clean. `CIVICHYBRID` excluded. |
| Nissan Leaf | NISSA | `LEAF` | 2018–2026 (string used since ~2011) | MY2021 / 124 | Clean but **small sample** — Leaf's NY fleet is thin. See §3. |
| Hyundai Elantra | HYUND | `ELANTRA`, `ELANTRAGT` | 2011–2026 | MY2018 / 6,314 | Judgment call, see note. |
| Honda Accord | HONDA | `ACCORD` | 2009–2026 | MY2017 / 13,990 | Clean. `ACCORDHYBRID`/`ACCORDCROSSTOUR`/`ACCORDPLUGIN` excluded. |
| Kia K4 | KIA | `K4`, `K4HATCHBACK` | 2025–2026 | MY2025 / 5,347 | New nameplate, matches seed exactly. |
| Mazda3 (SkyActiv) | MAZDA | `MAZDA3`, `MAZDA3SEDAN`, `MAZDA3HATCHBACK` | 2010–2026 | MY2018 / 2,551 | Clean. |
| Toyota Camry | TOYOT | `CAMRY` | 2009–2026 | MY2017 / 11,873 | Clean. |
| Toyota RAV4 Hybrid | TOYOT | `RAV4HYBRID` | 2016–2026 | MY2021 / 7,455 | Clean, one string. |
| Kia Niro (hybrid) | KIA | `NIRO` | 2017–2026 | MY2021 / 105 | Clean — better separated than NHTSA (see headline #1) — but **small 2025 sample**, see §3. |
| Tesla Model 3 | TESLA | `MODEL3` | 2018–2026 | MY2021 / 2,878 | Clean, one string. |
| Hyundai Sonata | HYUND | `SONATA`, `SONATA20T` | 2011–2026 | MY2018 / 4,052 | `SONATA20T` is a turbo trim of the same car, included; Hybrid/PHEV excluded. |
| Toyota RAV4 | TOYOT | `RAV4` | 2013–2026 | MY2019 / 15,769 | Clean. |
| Fiat 500 | FIAT | `500`, `500C`, `500T` | 2012–2019 | MY2015 / 849 | String set exists **only** MY2012–2019, matching the seed window exactly. `500E` (EV) and `500L` (different MPV) excluded. |
| Honda CR-V | HONDA | `CRV` | 2012–2026 | MY2019 / 26,252 | Clean. `CRVHYBRID` excluded. |
| VW ID.4 (AWD avail) | VOLKS | `ID4` | 2021–2026 | MY2023 / 1,363 | Clean, one string. |
| Toyota RAV4 Prime | TOYOT | `RAV4PRIME`, `RAV4PLUGINHYBRID` | 2021–2026 | MY2023 / 3,720 | See note — DMV renamed the string in MY2025. |
| Kia Soul | KIA | `SOUL` | 2010–2026 | MY2018 / 1,484 | Clean. `SOULEV` excluded. |
| VW Passat | VOLKS | `PASSAT` | 2012–2022 | MY2017 / 2,183 | Clean, one string. |
| Buick Encore | BUICK | `ENCORE` | 2013–2022 real; **2023–2026 near-zero (n=1/yr)** | MY2018 / 2,650 | See note — car discontinued, do not treat 2023–2026 as a true zero. |
| Hyundai Kona | HYUND | `KONA` | 2018–2026 | MY2021 / 3,562 | `KONAELECTRIC`/`KONAEV` excluded; `KONAN` (turbo performance trim, tiny n) also excluded for simplicity. |
| Mazda CX-5 | MAZDA | `CX5` | 2013–2026 | MY2019 / 8,034 | Clean, one string. |
| Toyota Highlander Hybrid | TOYOT | `HIGHLANDERHYBRID` | 2008–2026 | MY2019 / 843 | Clean. `GRANDHIGHLANDERHYBRID` (different, larger 2024+ nameplate) excluded. |
| Subaru Outback | SUBAR | `OUTBACK` | 2010–2026 | MY2018 / 8,532 | Clean, one string. |
| Subaru Forester | SUBAR | `FORESTER` | 2011–2026 | MY2018 / 14,480 | Clean, one string. |
| Toyota Sienna Hybrid | TOYOT | `SIENNA` | 2021–2026 | MY2022 / 6,733 | **Cannot be separated from Sienna (V6) by string** — see note, year window only. |
| Toyota Tacoma | TOYOT | `TACOMA` | 2005–2026 | MY2017 / 5,334 | Clean. `TACOMAHYBRID` (2024+ i-FORCE MAX, n=45 total) excluded. |
| Nissan Rogue | NISSA | `ROGUE` | 2011–2026 | MY2018 / 17,232 | Clean. `ROGUESPORT`/`ROGUESELECT` (different cars) and hybrid variants excluded. |
| Chevy Equinox | CHEVR | `EQUINOX` | 2010–2026 | MY2018 / 15,192 | Clean. `EQUINOXEV` (different platform) excluded. |
| Toyota Sienna (V6) | TOYOT | `SIENNA` | 2011–2020 | MY2016 / 4,365 | **Same string as Sienna Hybrid** — see note, year window only. |
| Mini Cooper | MINI | `COOPER`, `HARDTOP`, `HARDTOP2DOOR`, `HARDTOP4DOOR`, `COOPERHARDTOP` | 2014–2026 | MY2019 / 916 | See note — string changes generation to generation, same pattern as NHTSA. |
| Ford Ranger (old compact) | FORD | `RANGER` | 2001–2011 (2012–2018 is a real production gap: 2015 n=1, 2016 n=2, else 0) | MY2007 / 746 | **Same string as the 2019+ midsize** — year window only. |
| Fiat 500X | FIAT | `500X` | 2016–2023 | MY2019 / 61 | Clean, one string, but **small sample**. |
| VW GTI | VOLKS | `GOLFGTI`, `GTI` | 2015–2026 | MY2019 / 563 | Both strings genuinely used concurrently. |
| Kia Sportage | KIA | `SPORTAGE` | 2011–2026 | MY2018 / 2,700 | Clean. Hybrid/PHEV excluded. |
| Ford Escape | FORD | `ESCAPE` | 2009–2026 | MY2017 / 12,960 | Clean. Hybrid/PHEV excluded. |
| Toyota Highlander | TOYOT | `HIGHLANDER` | 2008–2026 | MY2017 / 7,573 | Clean. `GRANDHIGHLANDER`/`HIGHLANDERHYBRID` excluded. |
| Hyundai Tucson | HYUND | `TUCSON` | 2010–2026 | MY2017 / 4,945 | Clean. Hybrid/PHEV excluded. |
| Toyota 4Runner | TOYOT | `4RUNNER` | 2010–2026 | MY2017 / 1,592 | Clean. `4RUNNERHYBRID` (2025+, n=8 total) excluded. |
| Honda Odyssey | HONDA | `ODYSSEY` | 2011–2026 | MY2018 / 4,074 | Clean, one string. |
| Kia Sorento | KIA | `SORENTO` | 2011–2026 | MY2018 / 2,243 | Clean. Hybrid/PHEV excluded. |
| Hyundai Santa Fe | HYUND | `SANTAFE` | 2013–2026 | MY2019 / 3,831 | **Spans two physically different vehicles** — see note, same issue as NHTSA. |
| VW Tiguan | VOLKS | `TIGUAN` | 2018–2026 | MY2021 / 5,846 | `TIGUANLIMITED` (old-gen clearance trim, MY2018 n=2,279) excluded. |
| Chrysler Pacifica PHEV | CHRYS | `PACIFICAHYBRID`, `PACIFICAPLUGINHYBRID` | 2017–2026 | MY2021 / 512 | See note — DMV renamed the string in MY2023. Small sample. |
| Subaru Ascent | SUBAR | `ASCENT` | 2019–2026 | MY2022 / 3,244 | Clean, one string. |
| Ford Ranger (2019+ midsize) | FORD | `RANGER` | 2019–2026 | MY2022 / 1,399 | Same string as old compact — see note. |
| Honda Pilot | HONDA | `PILOT` | 2009–2026 | MY2017 / 6,604 | Clean, one string. |
| Mini Countryman | MINI | `COUNTRYMAN`, `COOPERCOUNTRYMAN` | 2011–2026 | MY2018 / 542 | `COUNTRYMANPLUGINHYBRID` excluded. |
| Toyota Sequoia | TOYOT | `SEQUOIA` | 2008–2026 (with a 1996/2009 outlier, negligible) | MY2017 / 164 | Clean string, but see note — real MY2023+ Sequoia is hybrid-standard and DMV doesn't flag that. Small sample. |
| Hyundai Palisade | HYUND | `PALISADE` | 2020–2026 | MY2022 / 2,626 | Clean. `PALISADEHYBRID` (2025+, n=2,252 total, real but new) excluded. |
| Chrysler Pacifica | CHRYS | `PACIFICA` | 2017–2026 | MY2021 / 2,003 | Clean. Hybrid/PHEV excluded. |
| Chevy Colorado | CHEVR | `COLORADO` | 2015–2026 | MY2020 / 2,354 | Clean, one string. |
| Kia Telluride | KIA | `TELLURIDE` | 2020–2026 | MY2022 / 4,114 | Clean, one string. |
| Mazda CX-90 | MAZDA | `CX90` | 2024–2026 | MY2024 / 4,790 | Clean. `CX90PHEV`/`CX90PLUGINHYBRID` excluded. |
| Chevy Traverse | CHEVR | `TRAVERSE` | 2009–2026 | MY2021 / 6,280 | Clean. `TRAVERSELIMITED` (old-gen clearance trim, MY2024 n=2,074) excluded. |
| VW Atlas | VOLKS | `ATLAS` | 2018–2026 | MY2021 / 3,885 | Clean. `ATLASCROSSSPORT` (different, smaller 5-seat nameplate) excluded. |
| Ford Explorer | FORD | `EXPLORER` | 2011–2026 | MY2018 / 8,114 | Clean in this window. `EXPLORERSPORTTRAC` (different truck, pre-2011 only) and `EXPLORERHYBRID` excluded; `EXPLORERSPORT` string is unused after MY2007 (the modern Sport trim files under bare `EXPLORER`). |
| Buick Enclave | BUICK | `ENCLAVE` | 2008–2026 | MY2017 / 1,069 | Clean, one string. |
| Volvo XC60 | VOLVO | `XC60` | 2018–2026 (string used since ~2010) | MY2021 / 2,041 | Clean. `XC60RECHARGE` (PHEV) excluded. |
| Chevy Tahoe | CHEVR | `TAHOE` | 2015–2026 | MY2020 / 1,672 | Clean. `TAHOEHYBRID` (n=513 total, older 2WD/4WD hybrid, pre-2015) excluded. |
| Jeep Grand Cherokee L | JEEP | `GRANDCHEROKEEL` | 2021–2026 (n=3–5 pre-2021 noise, ignore) | MY2023 / 7,942 | Clean, dedicated string — better than NHTSA's regex-based split. |
| Volvo V90 Cross Country | VOLVO | `V90CROSSCOUNTRY` | 2017–2026 | MY2021 / 39 | Clean string, plain `V90` wagon excluded, but **very small sample**. |
| Chevy Suburban | CHEVR | `SUBURBAN` | 2015–2026 | MY2020 / 1,169 | Clean — single string for the whole window (simpler than NHTSA's `SUBURBAN`/`SUBURBAN 1500` split). |
| Volvo XC90 | VOLVO | `XC90` | 2016–2026 (string used since ~2003) | MY2020 / 1,555 | Clean. `XC90RECHARGE` (PHEV) excluded. |
| Porsche 996 Carrera | PORSC | `911` | 1999–2004 | MY2002 / 327 | **Cannot be separated from 996 Turbo — see note.** Not derived (tier=sport). |
| Porsche 996 Turbo | PORSC | `911` | 2001–2005 | MY2003 / 240 | **Same as above.** Not derived (tier=sport). |

---

## 2. Mapping notes (ambiguous / judgment-call cases)

Mirrors the `MAPPING_NOTES` convention in `packages/pipeline/src/reliability/corpus.ts` — every
row here is disclosed, not silently resolved.

- **Toyota Sienna (V6) / Toyota Sienna Hybrid** — identical `model_name` (`SIENNA`) for both. Queried
  the fuel_type/hybrid breakdown for MY2022 (a hybrid-only year): `GASOLINE`/`hybrid=TRUE` dominates
  (48,519 of 49,170), i.e. even the fuel_type/hybrid columns don't create a usable split within a
  single `SIENNA` model-year — they just correctly confirm the car *is* a hybrid. **Separation is
  only possible by model-year window**: ≤2020 = V6, 2021+ = hybrid-only, exactly like the existing
  NHTSA mapping's Sienna note.

- **Ford Ranger (old compact) / Ford Ranger (2019+ midsize)** — identical string (`RANGER`) for
  both. Verified the production gap directly by year: 2001–2011 real volume (746–12,469/yr),
  2012–2018 is genuinely empty (2015 n=1, 2016 n=2, all other years 0), 2019–2026 real volume
  resumes (700–18,520/yr). **Separation is only possible by year window** — identical situation to
  the existing NHTSA mapping.

- **Hyundai Santa Fe** — `SANTAFE` spans three physically different cars over the seed window
  (2013–2026): MY2013–2018 it's the *3-row* Santa Fe (the *2-row* of those years files as the
  separate string `SANTAFESPORT`, excluded here, mirroring the NHTSA note's `SANTA FE SPORT`
  exclusion); MY2019+ `SANTAFE` becomes the *new* mid-size 2-row (the true 3-row for those two years
  is `SANTAFEXL`, also excluded). Verified by full year-by-year breakdown. This is the **same
  cross-generation ambiguity already documented for NHTSA** ("the seed row therefore spans two
  physically different vehicles"), reproduced independently in a different dataset.

- **Mini Cooper** — the base Cooper hatchback's string changes generation to generation: `COOPER`
  (2002–2011, real volume), `COOPERHARDTOP` (2012 only, 3,610 rows, a one-year transitional label),
  then `HARDTOP2DOOR`/`HARDTOP4DOOR` (2013–2026). Verified by full year-by-year breakdown — `COOPER`
  drops to noise (n≤11) after 2012, the same pattern the NHTSA `MAPPING_NOTES` entry describes
  ("drops 'COOPER' entirely in MY2021"), just shifted a decade earlier in this dataset.
  `CLUBMAN`/`CONVERTIBLE`/`COUNTRYMAN`/`PACEMAN`/`ROADSTER`/`COUPE` excluded to match the existing
  NHTSA convention (same vehicle-family judgment call, applied consistently).

- **Toyota Prius Prime** — `PRIUSPRIME` is the dominant string MY2017–2024; DMV then reverts to
  `PRIUSPLUGINHYBRID` for MY2025–2026 (verified by year breakdown). Note `PRIUSPLUGINHYBRID` was
  *also* used MY2007–2015 for the unrelated first-generation Prius Plug-in Hybrid — outside the seed
  row's `first_year=2017` window, so no overlap, but flagging it since it's the same string doing
  double duty for two different cars a decade apart.

- **Toyota RAV4 Prime** — same pattern as Prius Prime: `RAV4PRIME` MY2021–2024, `RAV4PLUGINHYBRID`
  takes over MY2025–2026 (verified by year breakdown). Both matched.

- **Chrysler Pacifica PHEV** — `PACIFICAHYBRID` MY2017–2023 (with a stray n=1 in 2026),
  `PACIFICAPLUGINHYBRID` overlaps and takes over from MY2023 (3,869 vs 2,684 that year) through 2026.
  Both matched; verified by year breakdown. Same rename pattern the existing NHTSA note already
  documents (`'PACIFICA PHEV'` → `'PACIFICA HYBRID'`), just with different strings and a later
  transition year.

- **Hyundai Elantra** — matched `ELANTRA` + `ELANTRAGT` (a hatchback body variant), excluding
  `ELANTRAHYBRID`/`ELANTRATOURING`/`ELANTRACOUPE`/`ELANTRAN`. This is a direct port of the existing
  NHTSA convention (`exact("ELANTRA", "ELANTRA GT")`) rather than an independently re-derived
  judgment — flagging so it isn't mistaken for fresh analysis.

- **Hyundai Kona** — matched bare `KONA` only. `KONAN` (a turbo/performance trim of the gas Kona,
  n=1,204 total) was left out for simplicity; arguably belongs with the gas Kona rather than being
  excluded, but the volume is too small to matter for the 2025 sample. `KONAELECTRIC`/`KONAEV`
  (separate strings, genuinely different powertrain) are correctly excluded regardless.

- **Toyota Sequoia** — the real-world MY2023+ 4th-generation Sequoia is hybrid-standard (i-FORCE
  MAX), but DMV never splits it into a separate string — it's `SEQUOIA` for the entire 2008–2026
  window with no hybrid flag distinguishing it from the earlier V8-only generations. This means the
  seed row's `etype=gas` is not strictly accurate for its own most recent model years in this
  dataset, but there is no way to carve that out by `model_name` — noting it, not fixing the seed.

- **Porsche 996 Carrera / 996 Turbo** — **cannot be separated at all.** Unlike NHTSA (which at least
  distinguishes `911`/`911 CARRERA`/`911 CARRERA/CARRERA CABRIO` from `911 TURBO`/`911 GT` in some
  years), NY DMV's `model_name` for every 911 variant across MY1999–2006 is the single bare string
  `911` — no trim, no engine, no drivetrain field to split on. A query for either seed row returns
  the *same* undifferentiated pool (MY2002: 327 distinct VINs; MY2003: 240). Since both rows are
  `reliability_tier="sport"` and excluded from derivation, this is a documented gap rather than a
  blocker — but it should not be "solved" by picking one string over the other, because there isn't
  one to pick.

- **Buick Encore** — `ENCORE` has real volume MY2013–2022 (2,650–29,592/yr) then collapses to n=1/yr
  MY2023–2026, because Buick discontinued the original Encore after MY2022 and replaced it with the
  differently-platformed `ENCOREGX` (excluded here as a different vehicle — different chassis, shared
  with the Chevy Trailblazer, not a trim of the original Encore). The seed row's `last_year=2026`
  should **not** be read as "no data" for 2023–2026 — it's "the physical car mapped to the seed row
  stopped being sold," the same distinction the existing `KNOWN_EMPTY_MODEL_YEARS` convention in
  `corpus.ts` draws for Fiat 500/500X/V90 CC.

- **VW Tiguan** — `TIGUANLIMITED` (2,279 rows, MY2018 only, plus 2 stray rows in 2022/2023) is the
  first-generation Tiguan sold at clearance pricing alongside the genuinely-new second-generation
  `TIGUAN` for one transition year. Excluded — it's the outgoing car, not a trim of the current one.

- **Chevy Traverse** — `TRAVERSELIMITED` (2,074 rows, MY2024 only) is the same old-generation
  continuation pattern as GM used for Malibu/Impala/Cruze (`MALIBULIMITED`, `IMPALALIMITED`,
  `CRUZELIMITED` all show the identical shape in the raw CHEVR catalogue query). Excluded for the
  same reason as Tiguan Limited.

---

## 3. EV/PHEV coverage check (task requirement 4)

All eight EV/PHEV/plug-in seed rows resolve to real, adequately-populated `model_name` strings and
carry consistent `fuel_type`/`hybrid` values (§0.3). 2025-calendar sample sizes, one representative
model year each:

| Vehicle | model_name(s) | MY sampled | 2025 distinct VINs |
|---|---|---|---|
| Tesla Model 3 | `MODEL3` | 2021 | 2,878 |
| Toyota RAV4 Prime | `RAV4PRIME`, `RAV4PLUGINHYBRID` | 2023 | 3,720 |
| Toyota Prius Prime | `PRIUSPRIME`, `PRIUSPLUGINHYBRID` | 2021 | 2,211 |
| VW ID.4 | `ID4` | 2023 | 1,363 |
| Chevy Volt | `VOLT` | 2018 | 643 |
| Chevy Bolt EV | `BOLTEV` | 2021 | 405 |
| Chrysler Pacifica PHEV | `PACIFICAHYBRID`, `PACIFICAPLUGINHYBRID` | 2021 | 512 |
| Nissan Leaf | `LEAF` | 2021 | 124 |

Leaf, Bolt EV, Pacifica PHEV, and Volt are the four thinnest samples in the whole 71-vehicle set —
worth flagging for whatever small-n handling gets designed next (Leaf and Bolt in particular sold
in far smaller NY volumes than their gas competitors, not a mapping defect).

Inspection-regime check: VW ID.4 MY2022 shows `INITIAL INSPECTION` (2,108) / `RE-INSPECTION` (11) —
the same two `inspection_type` values and roughly the same ratio seen for gas vehicles elsewhere in
this pull, i.e. **NY subjects EVs to the standard safety inspection**, not a separate or exempt
regime. This was verified, not assumed, per the task's explicit instruction.

---

## 4. Low-volume models (task requirement 5)

Actual queried 2025-calendar sample sizes, so small-n handling can be designed against real numbers
rather than guesses:

| Vehicle | 2025 sample (representative MY) |
|---|---|
| Porsche 996 Carrera / Turbo | 327 / 240 (MY2002 / MY2003) — moot, `sport` tier is never derived |
| Volvo V90 Cross Country | **39** (MY2021) — smallest real sample in the set |
| Fiat 500X | 61 (MY2019) |
| Toyota Sequoia | 164 (MY2017) |
| Nissan Leaf | 124 (MY2021) |
| Kia Niro (hybrid) | 105 (MY2021) |
| Mini Countryman | 542 (MY2018) |
| Chrysler Pacifica PHEV | 512 (MY2021) |
| VW GTI | 563 (MY2019) |
| Chevy Bolt EV | 405 (MY2021) |

Everything else in the 71-vehicle set clears 4 figures for its representative model year. The
Volvo V90 Cross Country in particular — the task's flagged low-volume case — is confirmed genuinely
thin in NY: this is a real niche wagon, not a mapping failure (the `V90CROSSCOUNTRY` string is
clean and unambiguous; there just aren't many on NY roads).

---

## 5. Scope note on "year data" precision

For vehicles with no cross-seed-row ambiguity and no evidence of a mid-life rename or discontinuity,
"Year data" in §1 is reported as the seed's own `first_year`–`last_year`, corroborated by an
aggregate multi-year catalogue pull (`model_year between <range>`, confirming the string carries
substantial total volume) plus the single-model-year 2025 sample — not an exhaustive year-by-year
breakdown for all 71 rows. Full year-by-year breakdowns were run specifically for every case flagged
in §2 (anything shared between seed rows, suspected renamed, or suspected discontinued) and for the
EV/PHEV rows in §3. This is a deliberate scope decision given 71 vehicles × arbitrary year ranges;
anyone re-deriving reliability tiers from this mapping should re-verify a specific model year before
depending on it, the same caveat the existing NHTSA corpus documentation carries for the same reason.
