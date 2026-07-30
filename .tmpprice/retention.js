const d=require("../opencawr_data.json");
const AM=13000;
const MSRP=require("./msrp.json");
function at(pts,x){const f=pts[0],l=pts[pts.length-1];
 if(x<=f.x)return f.y;
 if(x>=l.x){const s=(l.y-pts[pts.length-2].y)/(l.x-pts[pts.length-2].x);return l.y+(x-l.x)*s;}
 let i=0;while(pts[i+1].x<x)i++;const a=pts[i],b=pts[i+1];return a.y+((x-a.x)*(b.y-a.y))/(b.x-a.x);}
console.log(["vehicle","MSRP","P@13k(1y)","ret1y","P@39k(3y)","ret3y","P@65k(5y)","ret5y","dep5y"].join("\t"));
for(const v of d.vehicles){
 if(!(v.name in MSRP))continue;
 const pts=Object.entries(v.price_vs_odometer_usd).map(([k,y])=>({x:+k,y})).sort((a,b)=>a.x-b.x);
 const m=MSRP[v.name];
 const w=[{x:0,y:m},...pts];
 const p1=at(w,13000),p3=at(w,39000),p5=at(w,65000);
 console.log([v.name,m,Math.round(p1),(p1/m*100).toFixed(0)+"%",Math.round(p3),(p3/m*100).toFixed(0)+"%",Math.round(p5),(p5/m*100).toFixed(0)+"%",((1-p5/m)*100).toFixed(1)+"%"].join("\t"));
}
