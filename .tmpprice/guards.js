const d = require("../opencawr_data.json");
const A = require("./anchors.json").candidates;
const NY = d.constants.now_year, AM = d.constants.annual_miles;
const byName = new Map(d.vehicles.map(v => [v.name, v]));

// G3 manual rejections (2026 car is not the seed car) — evidence in report
const G3 = {
  "Toyota Camry": "2026 Camry is hybrid-only (Toyota full-line PDF lists no gas Camry); seed carries a separate 'Toyota Camry Hybrid' row",
  "Toyota RAV4":  "2026 RAV4 is hybrid-only (PDF lists only RAV4 Hybrid / Plug-in Hybrid); seed carries a separate 'Toyota RAV4 Hybrid' row",
};

const rows = [], rejects = [];
for (const [name, my, trim, msrp, dest, src] of A) {
  const v = byName.get(name);
  if (!v) { rejects.push([name, "NAME MISMATCH", ""]); continue; }
  const total = msrp + dest;
  if (v.last_year < NY) { rejects.push([name, "G1 discontinued", `last_year=${v.last_year}`]); continue; }
  const xs = Object.keys(v.price_vs_odometer_usd).map(Number).sort((a,b)=>a-b);
  const firstX = xs[0], firstP = v.price_vs_odometer_usd[String(firstX)];
  if (total <= firstP) { rejects.push([name, "G2 MSRP<=firstP", `${total} <= ${firstP} (ratio ${(firstP/total).toFixed(3)})`]); continue; }
  rows.push({ name, my, trim, msrp, dest, total, firstX, firstP, src,
              ret: firstP/total, yrs: firstX/AM });
}
for (const n of Object.keys(G3)) rejects.push([n, "G3 not the seed car", G3[n]]);

console.log("=== ACCEPTED ANCHORS (%d) ===", rows.length);
console.log(["vehicle","MY","trim","MSRP","dest","total","firstX","firstP","retention@firstX","yrs@firstX"].join("\t"));
for (const r of rows.sort((a,b)=>a.ret-b.ret))
  console.log([r.name,r.my,r.trim,r.msrp,r.dest,r.total,r.firstX,r.firstP,(r.ret*100).toFixed(1)+"%",r.yrs.toFixed(2)].join("\t"));
console.log("\n=== REJECTED (%d) ===", rejects.length);
for (const r of rejects) console.log(r.join("\t| "));
console.log("\n=== RETENTION BAND 0.80-0.90 ===");
const inBand = rows.filter(r=>r.ret>=0.80&&r.ret<=0.90);
console.log(`in band: ${inBand.length}/${rows.length}`);
console.log("out of band (flag for used-price re-pull):");
for (const r of rows.filter(r=>r.ret<0.80||r.ret>0.90))
  console.log(`  ${r.name}\t${(r.ret*100).toFixed(1)}%\t${r.ret>0.90?"TOO HIGH (first pt too rich)":"too low"}\t@${r.firstX} mi`);
require("fs").writeFileSync("accepted.json", JSON.stringify(Object.fromEntries(rows.map(r=>[r.name,r.total])),null,1));
