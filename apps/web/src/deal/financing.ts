/** Standalone financing-vs-cash NPV calculator (Analyze tab's Financing Costs
 *  section). Deliberately independent of the cost engine — see
 *  packages/core/src/engine.ts:20-22 for why opportunity cost never gets a
 *  second, separate capital charge there. This is a different question: given
 *  a loan offer and what your money could otherwise earn, does financing cost
 *  more or less than paying cash? */

export interface FinancingParams {
  price: number;
  downPaymentUsd: number;
  /** Nominal, monthly-compounding — how auto loans are actually quoted. */
  aprPct: number;
  termMonths: number;
  /** Effective annual — matches how `EngineInputs.discountRate` is used
   *  elsewhere in the app. Deliberately a different compounding convention
   *  than `aprPct`; see `breakevenAprPct` below. */
  opportunityRatePct: number;
  milesBasis: number;
}

export interface FinancingResult {
  monthlyPayment: number;
  /** Nominal total interest paid over the loan term, undiscounted. */
  totalInterestUsd: number;
  /** NPV of (down payment + loan payments) minus the cash price, discounted
   *  at the opportunity rate. Negative means financing beats paying cash. */
  financingCostUsd: number;
  financingCostPerMi: number;
  /** The loan APR (same nominal convention as `aprPct`) at which
   *  `financingCostUsd` is exactly zero. Provably independent of
   *  price/term/down payment — see docs/superpowers/specs/2026-08-02-financing-costs-design.md. */
  breakevenAprPct: number;
}

export function calcFinancing(p: FinancingParams): FinancingResult {
  const loanAmount = Math.max(p.price - p.downPaymentUsd, 0);
  const monthlyApr = p.aprPct / 100 / 12;
  const n = p.termMonths;

  const monthlyPayment =
    loanAmount === 0
      ? 0
      : monthlyApr === 0
        ? loanAmount / n
        : (loanAmount * monthlyApr) / (1 - Math.pow(1 + monthlyApr, -n));

  const monthlyOpp = Math.pow(1 + p.opportunityRatePct / 100, 1 / 12) - 1;
  const pvPayments =
    monthlyOpp === 0
      ? monthlyPayment * n
      : (monthlyPayment * (1 - Math.pow(1 + monthlyOpp, -n))) / monthlyOpp;

  const financingCostUsd = p.downPaymentUsd + pvPayments - p.price;
  const totalInterestUsd = monthlyPayment * n - loanAmount;
  const breakevenAprPct = monthlyOpp * 12 * 100;

  return {
    monthlyPayment,
    totalInterestUsd,
    financingCostUsd,
    financingCostPerMi: financingCostUsd / p.milesBasis,
    breakevenAprPct,
  };
}

/** Miles basis for $/mi, in priority order — whatever the user has already
 *  told the app, most specific first (see design doc). */
export function resolveMilesBasis(
  termMonths: number,
  lifetimeMiles: number | null,
  holdMiles: number | "eol" | undefined,
  annualMiles: number | undefined,
): number {
  if (lifetimeMiles != null) return lifetimeMiles;
  if (typeof holdMiles === "number") return holdMiles;
  return (annualMiles ?? 13_000) * (termMonths / 12);
}
