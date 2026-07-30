# MSRP price-curve anchors — provenance

Every row below is one `"0": <total>` key added to that vehicle's `price_vs_odometer_usd`
in `opencawr_data.json`. Nothing else about the curve is edited: the existing first used-price
observation stays authoritative, and the modeled first-year decline is simply the slope of the
chord between the two real observations. It is not a tunable parameter.

**Rule, applied uniformly:** manufacturer-published MSRP of the **base trim** of the **current
model year**, **including** the destination / delivery-processing-handling charge, taken from the
manufacturer's own media or corporate site. Where the OEM no longer publishes MY2026 (the model
skipped 2026, or 2027 has superseded it) the nearest published model year is used and is shown in
the table.

**Licence posture (not legal advice; see `ASSUMPTIONS.md` §E).** MSRP + destination is a
disclosure the manufacturer is compelled by statute to publish on every new car
(15 U.S.C. §1232(f)), and facts are not copyrightable (*Feist v. Rural Telephone*, 499 U.S. 340
(1991)). These figures were hand-entered from OEM press documents — no terms of service were
accepted, no compilation was extracted, and no retail aggregator or valuation product
(Edmunds/KBB/CarGurus/TrueCar/cars.com and similar) was used. What ships is a curve coefficient,
per spec §9.

**Refresh cadence:** annual. `constants.now_year` fixes the implied model year at odometer 0, so
the anchor goes stale at the same rate `now_year` does.

Retrieved **2026-07-29**.

| vehicle | model year | trim | MSRP | destination | anchor at 0 mi | source |
|---|---|---|---|---|---|---|
| Toyota Corolla | 2026 | Corolla LE | $22,925 | $1,295 | **$24,220** | https://pressroom.toyota.com/toyota-full-line-pricing/ (`2026 and 2027 Toyota Pricing 7.29.2026.pdf`) |
| Toyota Prius (hybrid) | 2027 | Prius LE | $28,755 | $1,295 | **$30,050** | https://pressroom.toyota.com/toyota-full-line-pricing/ (`2026 and 2027 Toyota Pricing 7.29.2026.pdf`) |
| Toyota Prius Prime | 2027 | Prius Plug-in Hybrid SE | $33,980 | $1,295 | **$35,275** | https://pressroom.toyota.com/toyota-full-line-pricing/ (`2026 and 2027 Toyota Pricing 7.29.2026.pdf`) |
| Toyota Highlander | 2026 | Highlander XLE AWD | $46,270 | $1,595 | **$47,865** | https://pressroom.toyota.com/toyota-full-line-pricing/ (`2026 and 2027 Toyota Pricing 7.29.2026.pdf`) |
| Toyota Highlander Hybrid | 2026 | Highlander Hybrid XLE AWD | $48,020 | $1,595 | **$49,615** | https://pressroom.toyota.com/toyota-full-line-pricing/ (`2026 and 2027 Toyota Pricing 7.29.2026.pdf`) |
| Toyota Sequoia | 2026 | Sequoia 4x2 SR5 iForce MAX | $65,725 | $2,195 | **$67,920** | https://pressroom.toyota.com/toyota-full-line-pricing/ (`2026 and 2027 Toyota Pricing 7.29.2026.pdf`) |
| Toyota RAV4 Prime | 2026 | RAV4 Plug-in Hybrid SE | $41,500 | $1,595 | **$43,095** | https://pressroom.toyota.com/toyota-full-line-pricing/ (`2026 and 2027 Toyota Pricing 7.29.2026.pdf`) |
| Honda Civic | 2026 | Civic Sedan LX | $24,595 | $1,195 | **$25,790** | https://hondanews.com/en-US/honda-automobiles/releases/release-6f8b202ddb1c7f26ecd92774bb02cdfa-2026-honda-civic-sedan-pricing-and-epa-ratings-2 |
| Honda Accord | 2026 | Accord LX | $28,395 | $1,195 | **$29,590** | https://hondanews.com/en-US/honda-automobiles/releases/release-c26685400737027f7d053958c309dc82-2026-honda-accord-pricing-epa-ratings |
| Honda CR-V | 2026 | CR-V LX 2WD | $30,920 | $1,395 | **$32,315** | https://hondanews.com/en-US/honda-automobiles/releases/release-0d29cf91ab5515b985a1c286910fb0f9-2026-honda-cr-v-pricing-and-epa-ratings |
| Honda Odyssey | 2026 | Odyssey EX-L | $42,795 | $1,495 | **$44,290** | https://hondanews.com/en-US/honda-automobiles/releases/release-6f8b202ddb1c7f26ecd92774bb031f99-2026-honda-odyssey-pricing-and-epa-ratings |
| Honda Pilot | 2026 | Pilot Sport 2WD | $42,395 | $1,495 | **$43,890** | https://hondanews.com/en-US/releases/release-9ae8fd80ef03b3feea8a56d257005f9e-2026-honda-pilot-pricing-and-epa-ratings-5-1 |
| Kia K4 | 2026 | K4 LX | $22,290 | $1,245 | **$23,535** | https://www.kiamedia.com/us/en/models/k4/2026/pricing |
| Kia Niro (hybrid) | 2026 | Niro LX (HEV) | $27,390 | $1,495 | **$28,885** | https://www.kiamedia.com/us/en/models/niro-hev/2026/pricing |
| Kia Sportage | 2026 | Sportage LX FWD | $28,790 | $1,495 | **$30,285** | https://www.kiamedia.com/us/en/models/sportage/2026/pricing |
| Kia Sorento | 2026 | Sorento LX FWD | $32,390 | $1,495 | **$33,885** | https://www.kiamedia.com/us/en/models/sorento/2026/pricing |
| Kia Telluride | 2027 | Telluride LX FWD | $39,190 | $1,545 | **$40,735** | https://www.kiamedia.com/us/en/models/telluride/2027/pricing |
| Hyundai Elantra | 2026 | Elantra SE | $22,625 | $1,245 | **$23,870** | https://www.hyundainews.com/assets/applications/original/70729-26my-elantra-series-pricing-15-april-2026.pdf |
| Hyundai Sonata | 2026 | Sonata SE | $27,300 | $1,245 | **$28,545** | https://www.hyundainews.com/assets/documents/original/67978-26MYSonataPricing07Aug2025A.pdf |
| Hyundai Kona | 2026 | Kona SE FWD | $25,500 | $1,600 | **$27,100** | https://www.hyundainews.com/assets/applications/original/69881-26my-kona-pricing-19-dec-2025a.pdf |
| Hyundai Tucson | 2026 | Tucson SE FWD | $29,200 | $1,600 | **$30,800** | https://www.hyundainews.com/assets/documents/original/68227-26MYTucsonPricingSheet4Sep2025.pdf |
| Hyundai Santa Fe | 2026 | Santa Fe SE FWD | $34,800 | $1,600 | **$36,400** | https://www.hyundainews.com/assets/documents/original/68230-26MYSantaFePricingSheet4Sep2025.pdf |
| Hyundai Palisade | 2026 | Palisade SE FWD | $39,435 | $1,600 | **$41,035** | https://www.hyundainews.com/assets/documents/original/68409-26MYPalisadePricing01Oct2025.pdf |
| Subaru Outback | 2026 | Outback Premium | $34,995 | $1,450 | **$36,445** | https://media.subaru.com/pressrelease/2353/subaru-announces-pricing-all-new-2026-outback-suv |
| Subaru Forester | 2026 | Forester (base) | $29,995 | $1,450 | **$31,445** | https://media.subaru.com/pressrelease/2421/1/subaru-focuses-consumer-affordability-excellent-value-updated-pricing |
| Subaru Ascent | 2026 | Ascent Premium | $40,795 | $1,450 | **$42,245** | https://media.subaru.com/pressrelease/2340/subaru-announces-pricing-2026-ascent-3-row-suv |
| Nissan Leaf | 2026 | LEAF S+ | $29,990 | $1,545 | **$31,535** | https://usa.nissannews.com/en-US/releases/more-features-more-range-still-under-30k-all-new-2026-nissan-leaf-priced-from-29990-msrp + D&H from https://usa.nissannews.com/en-US/releases/2026-nissan-leaf-press-kit |
| Nissan Rogue | 2026 | Rogue S FWD (2026.5) | $29,490 | $1,545 | **$31,035** | https://usa.nissannews.com/en-US/releases/release-2704b0eedba2fa91be91a7ae2e22fbd2 + D&H from https://usa.nissannews.com/en-US/releases/2026-nissan-rogue-press-kit |
| Mazda3 (SkyActiv) | 2026 | Mazda3 2.5 S Sedan FWD | $24,650 | $1,235 | **$25,885** | https://news.mazdausa.com/2025-08-19-2026-Mazda3-Pricing-and-Packaging (base unchanged by the 2026-05-04 mid-year adjustment) |
| Mazda CX-5 | 2026 | CX-5 2.5 S | $29,990 | $1,495 | **$31,485** | https://news.mazdausa.com/2026-01-13-Mazda-Announces-Pricing-and-Packaging-for-All-New-2026-Mazda-CX-5 |
| VW Atlas | 2026 | Atlas SE FWD | $39,310 | $1,475 | **$40,785** | https://media.vw.com/releases/1870 |
| VW GTI | 2026 | Golf GTI S | $34,590 | $1,275 | **$35,865** | https://media.vw.com/releases/1870 |
| VW Tiguan | 2026 | Tiguan S FWD | $30,805 | $1,475 | **$32,280** | https://media.vw.com/models/tiguan |
| Chevy Suburban | 2026 | Suburban LS | $63,700 | $2,795 | **$66,495** | https://www.chevrolet.com/suvs/suburban + DFC https://www.chevrolet.com/destination-freight-charges |
| Chevy Tahoe | 2026 | Tahoe LS | $60,700 | $2,795 | **$63,495** | https://www.chevrolet.com/suvs/tahoe + DFC https://www.chevrolet.com/destination-freight-charges |
| Chevy Equinox | 2027 | Equinox LT | $29,000 | $1,995 | **$30,995** | https://www.chevrolet.com/suvs/equinox + DFC https://www.chevrolet.com/destination-freight-charges |
## Not anchored, and why

**G1 — discontinued (`last_year < now_year`): odometer 0 is infeasible, no anchor is needed.**
Chevy Bolt EV, Chevy Volt, Fiat 500, Fiat 500X, VW Passat, Toyota Sienna (V6),
Ford Ranger (old compact), Porsche 996 Carrera, Porsche 996 Turbo. (9 rows.)

**G2 — MSRP ≤ the existing first price point.** A rising price curve would let `buyPointSweep`
profit on resale, so the vehicle is left unanchored (clamped, exactly as shipped) and goes on the
used-price re-pull list. The guard is a free data-quality detector on the seed curves.

| vehicle | anchor would have been | first curve point | ratio (firstP ÷ MSRP) |
|---|---|---|---|
| Toyota Tacoma | $33,990 (2026 Tacoma 4x2 SR XtraCab LB) | $41,000 @ 10,000 mi | 1.206 |
| Mazda CX-90 | $40,830 (2026 CX-90 3.3 Turbo Select) | $45,000 @ 10,000 mi | 1.102 |
| Chevy Colorado | $34,495 (2026 Colorado WT) | $38,000 @ 10,000 mi | 1.102 |
| Toyota Sienna Hybrid | $42,015 (2026 Sienna LE FWD 8-Pass Hybrid) | $44,000 @ 15,000 mi | 1.047 |
| Toyota 4Runner | $42,965 (2026 4Runner 4x2 SR5) | $44,000 @ 20,000 mi | 1.024 |
| Toyota RAV4 Hybrid | $33,495 (2026 RAV4 Hybrid LE FWD) | $34,000 @ 15,000 mi | 1.015 |
| Toyota Camry Hybrid | $30,895 (2026 Camry LE) | $31,000 @ 15,000 mi | 1.003 |

**G3 — the 2026 car is not the car the seed row describes.**

| vehicle | reason |
|---|---|
| Toyota Camry (gas) | The 2026 Camry is hybrid-only — Toyota's full-line pricing PDF lists no gas Camry. The seed carries a separate `Toyota Camry Hybrid` row, so this row has no 2026 equivalent and its `last_year: 2026` is wrong. |
| Toyota RAV4 (gas) | The 2026 RAV4 is hybrid-only — the PDF lists only RAV4 Hybrid and RAV4 Plug-in Hybrid. Same as above: `last_year: 2026` is wrong. |
| Kia Soul | kiamedia publishes no 2026 or 2027 Soul pricing page; the last published model year is 2025. `last_year: 2026` is suspect. |
| Buick Encore | `buick.com/suvs/encore` resolves to Buick's own **"Legacy Vehicles"** page (Encore, Cascada, LaCrosse, Regal). Buick classifies the Encore as discontinued. `last_year: 2026` is wrong. |
| VW ID.4 (AWD avail) | VW's 2026-lineup release says ID.4 "will get a mid-model-year change in 2026 … details and pricing to come closer to launch." No MY2026 MSRP has been published. |

**Could not be sourced from an OEM site — skipped rather than guessed.**

| vehicle | what blocked it |
|---|---|
| Tesla Model 3 | tesla.com returns HTTP 403 to every non-browser request; no OEM press-release alternative carries US MSRP. |
| Ford Escape, Ford Ranger (2019+ midsize), Ford Explorer | ford.com refuses non-browser connections; media.ford.com carries no MSRP tables. |
| Chevy Traverse | chevrolet.com's Traverse page publishes no starting MSRP in retrievable form (and has moved to MY2027). |
| Buick Enclave | buick.com has moved to MY2027 with ambiguous trim/price pairing, and Buick publishes no destination-freight-charge page. |
| Chrysler Pacifica, Chrysler Pacifica PHEV | Stellantis has moved to a MY2027 Pacifica; no MY2026 base-trim MSRP + destination pair is published together. |
| Jeep Grand Cherokee L | Stellantis states 2026 Grand Cherokee L trim pricing "will be announced at a later date". |
| Mini Cooper, Mini Countryman | No US MINI media-site pricing release located. |
| Volvo XC60, Volvo XC90, Volvo V90 Cross Country | media.volvocars.com publishes MSRP but not the destination charge; V90 Cross Country's US production status also needs a check. |
| Toyota Camry, Toyota RAV4, Kia Soul, Buick Encore, VW ID.4 | see G3 above. |
