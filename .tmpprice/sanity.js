const d=require("../opencawr_data.json");
const AM=13000;
// 2026 base-trim MSRP INCLUDING destination, from manufacturer/press sources (see report)
const MSRP={
 "Toyota Corolla":24260,        // 23,125 + 1,135 DPH  (pressroom.toyota.com)
 "Toyota Camry":30735,          // 29,600 + 1,135      (2026 Camry is hybrid-only)
 "Toyota Camry Hybrid":30735,   // same car in 2026
 "Toyota RAV4":33295,           // 31,900 + 1,395      (2026 RAV4 is hybrid-only)
 "Toyota RAV4 Hybrid":33295,
 "Honda Civic":25790,           // 24,595 + 1,195 (hondanews)
 "Honda Accord":28395,          // incl dest (hondanews)
 "Honda CR-V":30920,            // incl dest (hondanews)
 "Toyota Prius (hybrid)":29745, // incl dest
 "Subaru Outback":36445,        // 34,995 + 1,450 (media.subaru.com)
 "Tesla Model 3":36990,         // incl 1,390 dest (tesla.com)
 "Chevy Suburban":66495,        // base MSRP (TrueCar/Chevrolet)
 "Toyota Highlander":47365,     // cheapest 2026 trim incl dest
};
function curveAtClamped(pts,x){
  const f=pts[0],l=pts[pts.length-1];
  if(x<=f.x)return f.y;
  if(x>=l.x){const s=(l.y-pts[pts.length-2].y)/(l.x-pts[pts.length-2].x);return l.y+(x-l.x)*s;}
  let i=0;while(pts[i+1].x<x)i++;
  const a=pts[i],b=pts[i+1];return a.y+((x-a.x)*(b.y-a.y))/(b.x-a.x);
}
const rows=[];
for(const v of d.vehicles){
  if(!(v.name in MSRP))continue;
  const pts=Object.entries(v.price_vs_odometer_usd).map(([k,y])=>({x:+k,y})).sort((a,b)=>a.x-b.x);
  const m=MSRP[v.name];
  const withAnchor=[{x:0,y:m},...pts];
  const p13_old=curveAtClamped(pts,AM);          // current shipped (clamped) => = pts[0].y when 13k<=firstX
  const p13_new=curveAtClamped(withAnchor,AM);
  const dep_new=(m-p13_new)/m;
  const ret_first=pts[0].y/m;                    // retention at first observed odo
  const yrs_first=pts[0].x/AM;
  const annualized=1-Math.pow(ret_first,1/yrs_first);
  rows.push({name:v.name,firstX:pts[0].x,firstP:pts[0].y,msrp:m,
    p13_old:Math.round(p13_old),p13_new:Math.round(p13_new),
    dep1_new:(dep_new*100).toFixed(1)+"%",
    retFirst:(ret_first*100).toFixed(1)+"%",
    yrsFirst:yrs_first.toFixed(2),
    annDep:(annualized*100).toFixed(1)+"%",
    pinned:v.pinned_buy_odo});
}
console.log(["vehicle","firstX","firstP","MSRP@0","p@13k old","p@13k new","yr1 dep NEW","retention@firstX","yrs to firstX","annualized dep"].join("\t"));
for(const r of rows)console.log([r.name,r.firstX,r.firstP,r.msrp,r.p13_old,r.p13_new,r.dep1_new,r.retFirst,r.yrsFirst,r.annDep].join("\t"));
