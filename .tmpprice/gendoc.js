const fs=require("fs");
const A=require("./anchors.json").candidates;
const accepted=require("./accepted.json");
const H="https://hondanews.com/en-US/honda-automobiles/releases/";
const HY="https://www.hyundainews.com/assets/";
const URL={
 "Toyota":"https://pressroom.toyota.com/toyota-full-line-pricing/ (`2026 and 2027 Toyota Pricing 7.29.2026.pdf`)",
 "Honda Civic":H+"release-6f8b202ddb1c7f26ecd92774bb02cdfa-2026-honda-civic-sedan-pricing-and-epa-ratings-2",
 "Honda Accord":H+"release-c26685400737027f7d053958c309dc82-2026-honda-accord-pricing-epa-ratings",
 "Honda CR-V":H+"release-0d29cf91ab5515b985a1c286910fb0f9-2026-honda-cr-v-pricing-and-epa-ratings",
 "Honda Odyssey":H+"release-6f8b202ddb1c7f26ecd92774bb031f99-2026-honda-odyssey-pricing-and-epa-ratings",
 "Honda Pilot":"https://hondanews.com/en-US/releases/release-9ae8fd80ef03b3feea8a56d257005f9e-2026-honda-pilot-pricing-and-epa-ratings-5-1",
 "Kia K4":"https://www.kiamedia.com/us/en/models/k4/2026/pricing",
 "Kia Niro (hybrid)":"https://www.kiamedia.com/us/en/models/niro-hev/2026/pricing",
 "Kia Sportage":"https://www.kiamedia.com/us/en/models/sportage/2026/pricing",
 "Kia Sorento":"https://www.kiamedia.com/us/en/models/sorento/2026/pricing",
 "Kia Telluride":"https://www.kiamedia.com/us/en/models/telluride/2027/pricing",
 "Hyundai Elantra":HY+"applications/original/70729-26my-elantra-series-pricing-15-april-2026.pdf",
 "Hyundai Sonata":HY+"documents/original/67978-26MYSonataPricing07Aug2025A.pdf",
 "Hyundai Kona":HY+"applications/original/69881-26my-kona-pricing-19-dec-2025a.pdf",
 "Hyundai Tucson":HY+"documents/original/68227-26MYTucsonPricingSheet4Sep2025.pdf",
 "Hyundai Santa Fe":HY+"documents/original/68230-26MYSantaFePricingSheet4Sep2025.pdf",
 "Hyundai Palisade":HY+"documents/original/68409-26MYPalisadePricing01Oct2025.pdf",
 "Subaru Outback":"https://media.subaru.com/pressrelease/2353/subaru-announces-pricing-all-new-2026-outback-suv",
 "Subaru Forester":"https://media.subaru.com/pressrelease/2421/1/subaru-focuses-consumer-affordability-excellent-value-updated-pricing",
 "Subaru Ascent":"https://media.subaru.com/pressrelease/2340/subaru-announces-pricing-2026-ascent-3-row-suv",
 "Nissan Leaf":"https://usa.nissannews.com/en-US/releases/more-features-more-range-still-under-30k-all-new-2026-nissan-leaf-priced-from-29990-msrp + D&H from https://usa.nissannews.com/en-US/releases/2026-nissan-leaf-press-kit",
 "Nissan Rogue":"https://usa.nissannews.com/en-US/releases/release-2704b0eedba2fa91be91a7ae2e22fbd2 + D&H from https://usa.nissannews.com/en-US/releases/2026-nissan-rogue-press-kit",
 "Mazda3 (SkyActiv)":"https://news.mazdausa.com/2025-08-19-2026-Mazda3-Pricing-and-Packaging (base unchanged by the 2026-05-04 mid-year adjustment)",
 "Mazda CX-5":"https://news.mazdausa.com/2026-01-13-Mazda-Announces-Pricing-and-Packaging-for-All-New-2026-Mazda-CX-5",
 "VW Atlas":"https://media.vw.com/releases/1870",
 "VW GTI":"https://media.vw.com/releases/1870",
 "VW Tiguan":"https://media.vw.com/models/tiguan",
 "Chevy Suburban":"https://www.chevrolet.com/suvs/suburban + DFC https://www.chevrolet.com/destination-freight-charges",
 "Chevy Tahoe":"https://www.chevrolet.com/suvs/tahoe + DFC https://www.chevrolet.com/destination-freight-charges",
 "Chevy Equinox":"https://www.chevrolet.com/suvs/equinox + DFC https://www.chevrolet.com/destination-freight-charges",
};
const fmt=n=>"$"+n.toLocaleString("en-US");
let out=[];
for(const [name,my,trim,msrp,dest] of A){
  if(accepted[name]===undefined) continue;
  const u=URL[name] ?? (name.startsWith("Toyota") ? URL["Toyota"] : "??");
  out.push(`| ${name} | ${my} | ${trim} | ${fmt(msrp)} | ${fmt(dest)} | **${fmt(msrp+dest)}** | ${u} |`);
}
fs.writeFileSync("rows.md", out.join("\n"));
console.log(out.length,"rows");
