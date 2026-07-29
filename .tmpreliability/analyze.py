#!/usr/bin/env python3
"""THROWAWAY analysis. Reads .tmpreliability/data/{pulled,investigations}.json +
opencawr_data.json and answers: what actually explains per-model NHTSA complaint
rate — body, powertrain, make, or complexity? Stdlib only."""
import json, math, random, statistics as st, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CUR = 2026
random.seed(20260729)

seed = json.load(open(os.path.join(ROOT, "opencawr_data.json")))
pulled = {p["name"]: p for p in json.load(open(os.path.join(D, "pulled.json")))}
inv = json.load(open(os.path.join(D, "investigations.json")))

TIER_ORD = {"low": 0, "mid": 1, "high": 2}


def median(xs):
    return st.median(xs) if xs else 0.0


rows = []
for v in seed["vehicles"]:
    p = pulled[v["name"]]
    ys = p["years"]
    tot_c = sum(y["complaints"] for y in ys)
    tot_pt = sum(y["powertrainComplaints"] for y in ys)
    tot_r = sum(y["recalls"] for y in ys)
    tot_ptr = sum(y["powertrainRecalls"] for y in ys)
    rate = median([y["complaints"] / max(1, CUR - y["year"]) for y in ys])
    rows.append(dict(
        name=v["name"], make=v["make"], body=v["body"], etype=v["etype"],
        tier=v["reliability_tier"], seed_ord=TIER_ORD.get(v["reliability_tier"]),
        years=[y["year"] for y in ys], n_years=len(ys),
        complaints=tot_c, pt_complaints=tot_pt, recalls=tot_r, pt_recalls=tot_ptr,
        investigations=inv[v["name"]]["investigations"],
        rate=rate,
        pt_share=(tot_pt / tot_c) if tot_c else None,
        recalls_per_my=tot_r / len(ys),
        inv_per_my=inv[v["name"]]["investigations"] / len(ys),
        c_per_recall=(tot_c / tot_r) if tot_r else None,
        awd=1 if "AWD" in v["body"] else 0,
        battery=1 if v.get("battery") else 0,
        repair_mult=v["repair_cost_multiplier_by_make"],
        eol=v["eol_maintained_miles"],
        span=v["last_year"] - v["first_year"] + 1,
        seats=v["specs"].get("seats"),
        provenance=v["provenance"],
    ))

BY = {r["name"]: r for r in rows}
NONSPORT = [r for r in rows if r["tier"] != "sport"]


# ---------- statistics helpers ----------
def eta_sq(groups):
    """One-way ANOVA eta^2 = SS_between / SS_total."""
    allv = [x for g in groups.values() for x in g]
    if len(allv) < 3:
        return 0.0
    gm = st.mean(allv)
    ssb = sum(len(g) * (st.mean(g) - gm) ** 2 for g in groups.values() if g)
    sst = sum((x - gm) ** 2 for x in allv)
    return ssb / sst if sst > 0 else 0.0


def perm_p(values, labels, n=20000):
    """Permutation p-value for eta^2 of `values` grouped by `labels`."""
    def grp(labs):
        d = {}
        for v, l in zip(values, labs):
            d.setdefault(l, []).append(v)
        return d
    obs = eta_sq(grp(labels))
    labs = list(labels)
    hits = 0
    for _ in range(n):
        random.shuffle(labs)
        if eta_sq(grp(labs)) >= obs:
            hits += 1
    return obs, (hits + 1) / (n + 1)


def rank(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            r[order[k]] = avg
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = rank(a), rank(b)
    n = len(a)
    ma, mb = st.mean(ra), st.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else 0.0


def spearman_p(a, b, n=20000):
    obs = spearman(a, b)
    bb = list(b)
    hits = 0
    for _ in range(n):
        random.shuffle(bb)
        if abs(spearman(a, bb)) >= abs(obs):
            hits += 1
    return obs, (hits + 1) / (n + 1)


def show_groups(title, key, metric, rowset):
    print(f"\n{title}  [metric = {metric}]")
    d = {}
    for r in rowset:
        if r[metric] is None:
            continue
        d.setdefault(r[key], []).append(r[metric])
    print(f"  {'group':<16}{'n':>4}{'median':>12}{'mean':>12}{'min':>10}{'max':>10}")
    for k in sorted(d, key=lambda k: -st.median(d[k])):
        g = d[k]
        print(f"  {k:<16}{len(g):>4}{st.median(g):>12.3f}{st.mean(g):>12.3f}{min(g):>10.3f}{max(g):>10.3f}")
    vals = [math.log1p(r[metric]) for r in rowset if r[metric] is not None]
    labs = [r[key] for r in rowset if r[metric] is not None]
    e, p = perm_p(vals, labs)
    print(f"  eta^2(log1p) = {e:.3f}   permutation p = {p:.4f}   (n={len(vals)}, k={len(d)})")
    return e, p


# ---------------------------------------------------------------- overview
print("=" * 100)
print("CORPUS OVERVIEW (71 seed vehicles, NHTSA complaints+recalls, <=6 model years each, MY end <= 2022)")
print("=" * 100)
print(f"{'vehicle':<30}{'body':<15}{'etype':<8}{'seed':<7}{'yrs':<12}{'cplt':>7}{'pt%':>7}{'rate':>9}{'rcl':>6}{'inv':>5}")
for r in sorted(rows, key=lambda r: -r["rate"]):
    ys = f"{r['years'][0]}-{r['years'][-1]}"
    pts = f"{100*r['pt_share']:.0f}" if r["pt_share"] is not None else "-"
    print(f"{r['name']:<30}{r['body']:<15}{r['etype']:<8}{r['tier']:<7}{ys:<12}{r['complaints']:>7}{pts:>7}{r['rate']:>9.1f}{r['recalls']:>6}{r['investigations']:>5}")

zero = [r["name"] for r in rows if r["complaints"] == 0]
print(f"\nvehicles with ZERO complaints across the whole window: {zero}")


# ------------------------------------------------- Q0: is `rate` a volume proxy?
print("\n" + "=" * 100)
print("Q0.  DOES THE EXISTING `rate` METRIC MEASURE RELIABILITY AT ALL?")
print("=" * 100)
ns = NONSPORT
r_rate, p_rate = spearman_p([r["rate"] for r in ns], [r["seed_ord"] for r in ns])
print(f"  Spearman(rate, seed tier ordinal)          rho = {r_rate:+.3f}  p = {p_rate:.4f}   n={len(ns)}")
print("    (a USEFUL reliability metric would give rho strongly POSITIVE: worse tier -> higher rate)")
r_c, p_c = spearman_p([r["complaints"] for r in ns], [r["seed_ord"] for r in ns])
print(f"  Spearman(total complaints, seed tier)      rho = {r_c:+.3f}  p = {p_c:.4f}")
r_rc, p_rc = spearman_p([r["recalls_per_my"] for r in ns], [r["seed_ord"] for r in ns])
print(f"  Spearman(recalls/model-yr, seed tier)      rho = {r_rc:+.3f}  p = {p_rc:.4f}")
r_iv, p_iv = spearman_p([r["inv_per_my"] for r in ns], [r["seed_ord"] for r in ns])
print(f"  Spearman(investigations/model-yr, seed)    rho = {r_iv:+.3f}  p = {p_iv:.4f}")
r_ps, p_ps = spearman_p([r["pt_share"] for r in ns], [r["seed_ord"] for r in ns])
print(f"  Spearman(powertrain complaint SHARE, seed) rho = {r_ps:+.3f}  p = {p_ps:.4f}")
r_cr, p_cr = spearman_p([r["c_per_recall"] or 0 for r in ns], [r["seed_ord"] for r in ns])
print(f"  Spearman(complaints per recall, seed)      rho = {r_cr:+.3f}  p = {p_cr:.4f}")
r_rm, p_rm = spearman_p([r["repair_mult"] for r in ns], [r["seed_ord"] for r in ns])
print(f"  Spearman(repair_cost_multiplier, seed)     rho = {r_rm:+.3f}  p = {p_rm:.4f}   <- seed-internal, not NHTSA")
r_eol, p_eol = spearman_p([r["eol"] for r in ns], [r["seed_ord"] for r in ns])
print(f"  Spearman(eol_maintained_miles, seed)       rho = {r_eol:+.3f}  p = {p_eol:.4f}   <- seed-internal, not NHTSA")

print("\n  Volume confound check: complaints vs recalls (both scale with units sold, neither with quality)")
rr, pp = spearman_p([r["complaints"] for r in ns], [r["recalls"] for r in ns])
print(f"    Spearman(total complaints, total recalls) rho = {rr:+.3f}  p = {pp:.4f}")
rr2, pp2 = spearman_p([r["complaints"] for r in ns], [r["investigations"] for r in ns])
print(f"    Spearman(total complaints, investigations) rho = {rr2:+.3f}  p = {pp2:.4f}")

# --------------------------------------- Q1: owner's hypothesis, body vs etype
print("\n" + "=" * 100)
print("Q1.  OWNER'S HYPOTHESIS — powertrain drives reliability, body style is unrelated")
print("=" * 100)
res = {}
for metric in ("rate", "pt_share", "recalls_per_my", "inv_per_my"):
    print(f"\n--- metric: {metric} " + "-" * (80 - len(metric)))
    for key in ("etype", "body", "make", "awd", "battery"):
        e, p = show_groups(f"grouped by {key}", key, metric, NONSPORT)
        res[(metric, key)] = (e, p)

print("\n\nSUMMARY  eta^2 (share of variance in log1p(metric) explained), permutation p in brackets")
print(f"  {'factor':<12}" + "".join(f"{m:>22}" for m in ("rate", "pt_share", "recalls_per_my", "inv_per_my")))
for key in ("etype", "body", "make", "awd", "battery"):
    line = f"  {key:<12}"
    for m in ("rate", "pt_share", "recalls_per_my", "inv_per_my"):
        e, p = res[(m, key)]
        line += f"{e:>15.3f} [{p:.3f}]"
    print(line)


# ------------------------------------------------------ Q2: natural experiment
print("\n" + "=" * 100)
print("Q2.  NATURAL EXPERIMENT — same make, same model, same body, DIFFERENT powertrain")
print("=" * 100)
PAIRS = [("Toyota RAV4", "Toyota RAV4 Hybrid"), ("Toyota RAV4", "Toyota RAV4 Prime"),
         ("Toyota Highlander", "Toyota Highlander Hybrid"), ("Toyota Camry", "Toyota Camry Hybrid"),
         ("Toyota Sienna (V6)", "Toyota Sienna Hybrid"), ("Chrysler Pacifica", "Chrysler Pacifica PHEV")]
print(f"  {'gas variant':<26}{'rate':>8}{'pt%':>7}   {'electrified variant':<26}{'rate':>8}{'pt%':>7}{'rate x':>9}")
for a, b in PAIRS:
    ra, rb = BY[a], BY[b]
    ratio = ra["rate"] / rb["rate"] if rb["rate"] else float("inf")
    print(f"  {a:<26}{ra['rate']:>8.1f}{100*ra['pt_share']:>7.0f}   {b:<26}{rb['rate']:>8.1f}{100*rb['pt_share']:>7.0f}{ratio:>9.1f}x")
print("  The gas variant is 2-35x 'worse' on `rate` than the SAME CAR with a different")
print("  powertrain. That is a sales-mix artifact (hybrid/PHEV trims are a minority of units),")
print("  not a reliability difference of that magnitude. pt_share moves far less.")

# --------------------------------------------- Q3: candidate share definitions
detail = json.load(open(os.path.join(D, "detail.json")))
PT = ("ENGINE", "POWER TRAIN", "TRANSMISSION")
WEAR = PT + ("ELECTRICAL SYSTEM", "FUEL/PROPULSION SYSTEM", "FUEL SYSTEM, GASOLINE",
             "SERVICE BRAKES", "SERVICE BRAKES, HYDRAULIC", "STEERING", "SUSPENSION",
             "WHEELS", "ENGINE AND ENGINE COOLING", "HYBRID PROPULSION SYSTEM")
ADAS = ("FORWARD COLLISION AVOIDANCE", "LANE DEPARTURE", "BACK OVER PREVENTION",
        "AIR BAGS", "SEAT BELTS", "ELECTRONIC STABILITY CONTROL (ESC)")


def share(name, cats_wanted):
    d = detail[name]
    if not d["total"]:
        return None
    hit = sum(n for k, n in d["cats"].items() if any(k.startswith(p) for p in cats_wanted))
    return hit / d["total"]


for r in rows:
    d = detail[r["name"]]
    r["pt_share2"] = share(r["name"], PT)
    r["wear_share"] = share(r["name"], WEAR)
    r["adas_share"] = share(r["name"], ADAS)
    r["engine_share"] = share(r["name"], ("ENGINE",))
    r["elec_share"] = share(r["name"], ("ELECTRICAL SYSTEM",))
    r["crash_share"] = d["crash"] / d["total"] if d["total"] else None
    r["fire_share"] = d["fire"] / d["total"] if d["total"] else None
    r["injury_share"] = d["injury"] / d["total"] if d["total"] else None
    r["wear_per_my"] = (r["wear_share"] or 0) * r["complaints"] / r["n_years"]

print("\n" + "=" * 100)
print("Q3.  WHICH NHTSA-DERIVED SIGNAL ACTUALLY TRACKS THE (CR-derived) SEED TIER?")
print("=" * 100)
print(f"  {'signal':<26}{'volume-invariant?':<20}{'rho vs seed tier':>18}{'p':>10}")
CANDS = [("rate (current method)", "no", "rate"), ("total complaints", "no", "complaints"),
         ("recalls / model-yr", "no", "recalls_per_my"), ("investigations / model-yr", "no", "inv_per_my"),
         ("wear complaints / model-yr", "no", "wear_per_my"),
         ("powertrain share", "YES", "pt_share2"), ("wear+powertrain share", "YES", "wear_share"),
         ("engine-only share", "YES", "engine_share"), ("electrical share", "YES", "elec_share"),
         ("ADAS/airbag share", "YES", "adas_share"), ("crash-flagged share", "YES", "crash_share"),
         ("fire-flagged share", "YES", "fire_share"), ("injury/death share", "YES", "injury_share")]
for label, vi, key in CANDS:
    vals = [r[key] if r[key] is not None else 0 for r in ns]
    rho, p = spearman_p(vals, [r["seed_ord"] for r in ns])
    print(f"  {label:<26}{vi:<20}{rho:>+18.3f}{p:>10.4f}")


# ------------------------------------------------------ Q4: tier construction
print("\n" + "=" * 100)
print("Q4.  TIER ASSIGNMENT — does group normalization help, and which cut rule?")
print("=" * 100)
n_low = sum(1 for r in ns if r["tier"] == "low")
n_mid = sum(1 for r in ns if r["tier"] == "mid")
n_high = sum(1 for r in ns if r["tier"] == "high")
print(f"  seed marginal (non-sport, n={len(ns)}): low={n_low}  mid={n_mid}  high={n_high}")


def pct(xs, p):
    s = sorted(xs)
    if not s:
        return 0.0
    i = (len(s) - 1) * p
    lo, hi = math.floor(i), math.ceil(i)
    return s[lo] + (s[hi] - s[lo]) * (i - lo)


def group_normalize(rowset, metric, key):
    med = {}
    for r in rowset:
        med.setdefault(r[key], []).append(r[metric] or 0)
    med = {k: st.median(v) for k, v in med.items()}
    return [((r[metric] or 0) / med[r[key]]) if med[r[key]] > 0 else 1.0 for r in rowset]


def assign(vals, lo_frac, hi_frac):
    q1, q3 = pct(vals, lo_frac), pct(vals, hi_frac)
    return ["low" if v <= q1 else ("high" if v > q3 else "mid") for v in vals]


def agreement(pred, rowset):
    ok = sum(1 for p, r in zip(pred, rowset) if p == r["tier"])
    two = sum(1 for p, r in zip(pred, rowset)
              if {p, r["tier"]} == {"low", "high"})
    return ok, two


# marginal-matched cut points (so a method is not penalised for the wrong tier mix)
LO_F = n_low / len(ns)
HI_F = (n_low + n_mid) / len(ns)
print(f"  cut fractions used: low<= p{100*LO_F:.0f},  high> p{100*HI_F:.0f}  (matches the seed's own tier mix)")

METHODS = [
    ("A. rate, body-normalised, quartile cuts (CURRENT METHOD)", group_normalize(ns, "rate", "body"), 0.25, 0.75),
    ("A'. rate, body-normalised, marginal-matched cuts", group_normalize(ns, "rate", "body"), LO_F, HI_F),
    ("B. rate, etype-normalised, marginal-matched cuts", group_normalize(ns, "rate", "etype"), LO_F, HI_F),
    ("C. rate, NO normalisation, marginal-matched cuts", [r["rate"] for r in ns], LO_F, HI_F),
    ("D. powertrain share, NO normalisation", [r["pt_share2"] for r in ns], LO_F, HI_F),
    ("E. powertrain share, body-normalised", group_normalize(ns, "pt_share2", "body"), LO_F, HI_F),
    ("F. powertrain share, etype-normalised", group_normalize(ns, "pt_share2", "etype"), LO_F, HI_F),
    ("G. powertrain share, make-normalised", group_normalize(ns, "pt_share2", "make"), LO_F, HI_F),
    ("H. wear+powertrain share, NO normalisation", [r["wear_share"] for r in ns], LO_F, HI_F),
]
# composite: mean of the two volume-invariant signals' ranks
pr = rank([r["pt_share2"] for r in ns])
ir = rank([r["inv_per_my"] for r in ns])
METHODS.append(("I. rank(pt share) + rank(investigations/MY)", [(a + b) / 2 for a, b in zip(pr, ir)], LO_F, HI_F))
rr_ = rank([r["recalls_per_my"] for r in ns])
METHODS.append(("J. rank(pt share) + rank(recalls/MY)", [(a + b) / 2 for a, b in zip(pr, rr_)], LO_F, HI_F))

print(f"\n  {'method':<58}{'agree':>8}{'rate':>8}{'2-tier misses':>16}")
best = None
for label, vals, lo, hi in METHODS:
    pred = assign(vals, lo, hi)
    ok, two = agreement(pred, ns)
    print(f"  {label:<58}{ok:>4}/{len(ns):<3}{100*ok/len(ns):>7.0f}%{two:>16}")

print("\n  Baselines for calibration:")
print(f"    all-'mid'                                             {n_mid}/{len(ns)}  {100*n_mid/len(ns):.0f}%")
rnd = []
for _ in range(20000):
    lab = [r["tier"] for r in ns]
    random.shuffle(lab)
    rnd.append(sum(1 for a, r in zip(lab, ns) if a == r["tier"]))
print(f"    random permutation of the seed labels (mean)          {st.mean(rnd):.1f}/{len(ns)}  {100*st.mean(rnd)/len(ns):.0f}%")
print(f"    random permutation 95th percentile                    {pct(rnd,0.95):.0f}/{len(ns)}")


# ------------------------------------------- Q5: shrinkage + absolute thresholds
print("\n" + "=" * 100)
print("Q5.  SMALL-DENOMINATOR NOISE (shrinkage) AND ABSOLUTE THRESHOLDS")
print("=" * 100)
small = sorted(ns, key=lambda r: r["complaints"])[:8]
print("  8 thinnest complaint denominators (share metrics are noisiest here):")
for r in small:
    print(f"    {r['name']:<30}{r['complaints']:>6} complaints  pt_share={100*r['pt_share2']:>5.1f}%  seed={r['tier']}")

grand_pt = sum(r["pt_complaints"] for r in ns) / sum(r["complaints"] for r in ns)
print(f"\n  corpus-wide powertrain share (shrinkage target) = {100*grand_pt:.1f}%")


def shrunk(r, k):
    return (r["pt_complaints"] + k * grand_pt) / (r["complaints"] + k)


for k in (0, 25, 50, 100, 200, 400):
    vals = [shrunk(r, k) for r in ns]
    rho, _ = spearman(vals, [r["seed_ord"] for r in ns]), None
    pred = assign(vals, LO_F, HI_F)
    ok, two = agreement(pred, ns)
    print(f"    k={k:<4} rho={rho:+.3f}   agree {ok}/{len(ns)} ({100*ok/len(ns):.0f}%)   2-tier misses {two}")

print("\n  Absolute thresholds on shrunk powertrain share (k=100), calibrated once on the corpus:")
for lo_t, hi_t in ((0.22, 0.40), (0.25, 0.42), (0.20, 0.45), (0.24, 0.44)):
    vals = [shrunk(r, 100) for r in ns]
    pred = ["low" if v <= lo_t else ("high" if v > hi_t else "mid") for v in vals]
    ok, two = agreement(pred, ns)
    mix = {t: pred.count(t) for t in ("low", "mid", "high")}
    print(f"    low<={lo_t:.2f} high>{hi_t:.2f}   agree {ok}/{len(ns)} ({100*ok/len(ns):.0f}%)  2-tier {two}  mix={mix}")

# ordinal error for the finalists
print("\n  Ordinal error (mean |derived - seed| in tier steps; lower is better):")
FIN = [("A. CURRENT (rate, body-norm, quartile)", group_normalize(ns, "rate", "body"), 0.25, 0.75),
       ("D. powertrain share (raw)", [r["pt_share2"] for r in ns], LO_F, HI_F),
       ("D+. powertrain share, shrunk k=100", [shrunk(r, 100) for r in ns], LO_F, HI_F),
       ("H. wear+powertrain share", [r["wear_share"] for r in ns], LO_F, HI_F)]
for label, vals, lo, hi in FIN:
    pred = assign(vals, lo, hi)
    mae = st.mean(abs(TIER_ORD[p] - r["seed_ord"]) for p, r in zip(pred, ns))
    ok, two = agreement(pred, ns)
    print(f"    {label:<42} MAE={mae:.3f}   agree {ok}/{len(ns)}   2-tier {two}")


# ---------------------------------------------------------- Q6: FINAL TABLE
print("\n" + "=" * 100)
print("Q6.  RECOMMENDED METHOD — full-corpus agreement table")
print("=" * 100)
REC = "pt_share2"
vals = [r[REC] for r in ns]
q_lo, q_hi = pct(vals, LO_F), pct(vals, HI_F)
print(f"  metric  = powertrain complaint SHARE (complaints whose NHTSA top-level component starts")
print(f"            with ENGINE / POWER TRAIN / TRANSMISSION, divided by ALL that model's complaints)")
print(f"  cuts    = global percentiles over all 69 non-sport vehicles, NO per-class partition:")
print(f"            low <= {q_lo:.4f} (p{100*LO_F:.0f})   high > {q_hi:.4f} (p{100*HI_F:.0f})")
print(f"  sport   = never derived (2 Porsches, owner judgment)\n")
pred = assign(vals, LO_F, HI_F)
for r, p in zip(ns, pred):
    r["derived"] = p
for r in rows:
    if r["tier"] == "sport":
        r["derived"] = "sport (not derived)"

print(f"  {'vehicle':<30}{'make':<12}{'body':<14}{'etype':<8}{'pt share':>10}{'derived':>10}{'seed':>8}  {'move'}")
for r in sorted(rows, key=lambda r: -(r["pt_share2"] or 0)):
    if r["tier"] == "sport":
        continue
    d = TIER_ORD[r["derived"]] - r["seed_ord"]
    mv = "=" if d == 0 else ("WORSE +%d" % d if d > 0 else "BETTER %d" % d)
    print(f"  {r['name']:<30}{r['make']:<12}{r['body']:<14}{r['etype']:<8}{100*r['pt_share2']:>9.1f}%{r['derived']:>10}{r['tier']:>8}  {mv}")
for r in rows:
    if r["tier"] == "sport":
        print(f"  {r['name']:<30}{r['make']:<12}{r['body']:<14}{r['etype']:<8}{100*r['pt_share2']:>9.1f}%{'—':>10}{'sport':>8}  (never derived)")

ok, two = agreement(pred, ns)
print(f"\n  OVERALL AGREEMENT: {ok}/{len(ns)} = {100*ok/len(ns):.0f}%   (2 sport vehicles excluded by design)")
print(f"  mean ordinal error {st.mean(abs(TIER_ORD[p]-r['seed_ord']) for p,r in zip(pred,ns)):.3f} tier steps; "
      f"{two} vehicle(s) move a full 2 tiers")

print("\n  Confusion (rows = seed, cols = derived):")
print(f"    {'':<8}{'low':>8}{'mid':>8}{'high':>8}")
for s in ("low", "mid", "high"):
    line = f"    {s:<8}"
    for d_ in ("low", "mid", "high"):
        line += f"{sum(1 for r in ns if r['tier']==s and r['derived']==d_):>8}"
    print(line)

print("\n  Disagreement by make:")
for mk in sorted({r["make"] for r in ns}):
    g = [r for r in ns if r["make"] == mk]
    bad = [r for r in g if r["derived"] != r["tier"]]
    if bad:
        print(f"    {mk:<12} {len(g)-len(bad)}/{len(g)} agree   miss: " +
              ", ".join(f"{r['name']} ({r['tier']}->{r['derived']})" for r in bad))

print("\n  Disagreement by powertrain:")
for et in ("gas", "hybrid", "ev", "phev"):
    g = [r for r in ns if r["etype"] == et]
    a = sum(1 for r in g if r["derived"] == r["tier"])
    print(f"    {et:<8} {a}/{len(g)} agree ({100*a/len(g):.0f}%)")

print("\n  Direction of disagreement:")
worse = [r for r in ns if TIER_ORD[r["derived"]] > r["seed_ord"]]
better = [r for r in ns if TIER_ORD[r["derived"]] < r["seed_ord"]]
print(f"    derived WORSE than seed: {len(worse)}   derived BETTER than seed: {len(better)}")

print("\n  *** VEHICLES THE OWNER SHOULD EYEBALL (2-tier moves, or thin evidence) ***")
for r in ns:
    d = TIER_ORD[r["derived"]] - r["seed_ord"]
    if abs(d) == 2:
        print(f"    2-TIER   {r['name']:<28} seed={r['tier']:<5} derived={r['derived']:<5} "
              f"pt_share={100*r['pt_share2']:.1f}% on {r['complaints']} complaints")
for r in sorted(ns, key=lambda r: r["complaints"])[:6]:
    print(f"    THIN     {r['name']:<28} seed={r['tier']:<5} derived={r['derived']:<5} "
          f"only {r['complaints']} complaints across {r['n_years']} model years")


# ------------------------------- Q7: is powertrain share structurally unfair to EVs?
print("\n" + "=" * 100)
print("Q7.  IS POWERTRAIN SHARE STRUCTURALLY UNFAIR TO EVs / HYBRIDS?")
print("=" * 100)
PT_EXT = PT + ("FUEL/PROPULSION SYSTEM", "HYBRID PROPULSION SYSTEM", "ELECTRICAL SYSTEM")
PT_PROP = PT + ("FUEL/PROPULSION SYSTEM", "HYBRID PROPULSION SYSTEM")
for r in rows:
    r["pt_prop"] = share(r["name"], PT_PROP)
    r["pt_ext"] = share(r["name"], PT_EXT)
for key, lbl in (("pt_share2", "ENGINE/POWER TRAIN/TRANSMISSION"),
                 ("pt_prop", "+ FUEL/PROPULSION + HYBRID PROPULSION"),
                 ("pt_ext", "+ ELECTRICAL SYSTEM as well")):
    d = {}
    for r in ns:
        d.setdefault(r["etype"], []).append(r[key])
    meds = "  ".join(f"{e}={100*st.median(d[e]):.0f}%" for e in ("gas", "hybrid", "phev", "ev"))
    rho, p = spearman_p([r[key] for r in ns], [r["seed_ord"] for r in ns])
    prd = assign([r[key] for r in ns], LO_F, HI_F)
    okk, tww = agreement(prd, ns)
    print(f"  {lbl:<42} medians: {meds}")
    print(f"  {'':<42} rho={rho:+.3f} p={p:.4f}  agree {okk}/{len(ns)} ({100*okk/len(ns):.0f}%)  2-tier {tww}")

print("\n  Gas-only subset (55 vehicles), powertrain share, cuts recomputed within gas:")
gas = [r for r in ns if r["etype"] == "gas"]
gl = sum(1 for r in gas if r["tier"] == "low") / len(gas)
gh = (sum(1 for r in gas if r["tier"] in ("low", "mid"))) / len(gas)
gp = assign([r["pt_share2"] for r in gas], gl, gh)
gok, gtwo = agreement(gp, gas)
print(f"    agree {gok}/{len(gas)} ({100*gok/len(gas):.0f}%)   2-tier {gtwo}")
rndg = []
for _ in range(20000):
    lab = [r["tier"] for r in gas]; random.shuffle(lab)
    rndg.append(sum(1 for a, r in zip(lab, gas) if a == r["tier"]))
print(f"    chance baseline for the same 55: mean {st.mean(rndg):.1f}, 95th pct {pct(rndg,0.95):.0f}")

print("\n  Bootstrap 90% CI on the recommended method's agreement rate (resample vehicles):")
boots = []
for _ in range(5000):
    samp = [random.choice(list(zip(pred, ns))) for _ in ns]
    boots.append(sum(1 for p, r in samp if p == r["tier"]) / len(ns))
print(f"    {100*pct(boots,0.05):.0f}% .. {100*pct(boots,0.95):.0f}%  (point estimate {100*ok/len(ns):.0f}%)")
