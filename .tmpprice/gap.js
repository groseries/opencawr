const d=require("../opencawr_data.json");
const AM=d.constants.annual_miles, NY=d.constants.now_year;
const AXIS=[10,20,30,40,50,60,70,80,90,100,110,120].map(x=>x*1000);
let rows=[];
for(const v of d.vehicles){
  const xs=Object.keys(v.price_vs_odometer_usd).map(Number).sort((a,b)=>a-b);
  const first=xs[0];
  const firstP=v.price_vs_odometer_usd[String(first)];
  const lo=Math.max(0,(NY-v.last_year)*AM);
  const hi=(NY-v.first_year)*AM;
  // columns on the fixed heatmap axis that are (a) feasible and (b) strictly below first curve pt
  const affected=AXIS.filter(x=>x>=lo&&x<=hi&&x<first);
  // does the vehicle need a sub-10k anchor at all? only if feasible range reaches below 10000
  rows.push({name:v.name,last:v.last_year,first_year:v.first_year,lo,hi,firstX:first,firstP,affected:affected.length,affCols:affected.map(a=>a/1000).join("/"),prov:v.provenance});
}
rows.sort((a,b)=>b.firstX-a.firstX);
console.log("total",rows.length);
console.log("last_year>=2026 (odo 0 feasible):",rows.filter(r=>r.lo===0).length);
console.log("lo < 10000:",rows.filter(r=>r.lo<10000).length);
console.log("lo < firstX (any clamped feasible region):",rows.filter(r=>r.lo<r.firstX).length);
const dist={};
for(const r of rows) dist[r.firstX]=(dist[r.firstX]||0)+1;
console.log("first curve point distribution:",dist);
const ad={};
for(const r of rows) ad[r.affected]=(ad[r.affected]||0)+1;
console.log("affected heatmap columns distribution:",ad);
console.log();
console.log(rows.map(r=>[r.name,r.first_year+"-"+r.last,"lo="+r.lo,"firstX="+r.firstX,"$"+r.firstP,"cols="+(r.affCols||"-"),r.prov].join(" | ")).join("\n"));
