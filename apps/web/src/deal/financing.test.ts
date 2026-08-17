import { describe, expect, it } from "vitest";
import { calcFinancing, resolveMilesBasis } from "./financing.js";

const base = {
  price: 25_000,
  downPaymentUsd: 5_000,
  aprPct: 6.5,
  termMonths: 60,
  opportunityRatePct: 6.5,
  milesBasis: 60_000,
};

describe("calcFinancing", () => {
  it("is exactly zero at the breakeven APR, for any price/term/down payment", () => {
    const atBreakeven = calcFinancing(base);
    const withBreakevenApr = calcFinancing({ ...base, aprPct: atBreakeven.breakevenAprPct });
    expect(withBreakevenApr.financingCostUsd).toBeCloseTo(0, 6);

    // breakeven is independent of loan size/term — vary them, same breakeven APR
    const other = calcFinancing({ ...base, price: 40_000, downPaymentUsd: 10_000, termMonths: 36 });
    expect(other.breakevenAprPct).toBeCloseTo(atBreakeven.breakevenAprPct, 9);
  });

  it("is negative (financing beats cash) below the breakeven APR", () => {
    const atBreakeven = calcFinancing(base);
    const below = calcFinancing({ ...base, aprPct: atBreakeven.breakevenAprPct - 2 });
    expect(below.financingCostUsd).toBeLessThan(0);
  });

  it("is positive (cash beats financing) above the breakeven APR", () => {
    const atBreakeven = calcFinancing(base);
    const above = calcFinancing({ ...base, aprPct: atBreakeven.breakevenAprPct + 2 });
    expect(above.financingCostUsd).toBeGreaterThan(0);
  });

  it("treats downPaymentUsd >= price as no loan needed", () => {
    const noLoan = calcFinancing({ ...base, downPaymentUsd: base.price });
    expect(noLoan.monthlyPayment).toBe(0);
    expect(noLoan.financingCostUsd).toBeCloseTo(0, 9);
  });

  it("clamps downPaymentUsd above price the same as equal to price", () => {
    const overpaid = calcFinancing({ ...base, downPaymentUsd: base.price + 5_000 });
    expect(overpaid.monthlyPayment).toBe(0);
    expect(overpaid.financingCostUsd).toBeCloseTo(0, 9);
  });

  it("APR = 0 is a straight-line payment with no compounding", () => {
    const r = calcFinancing({ ...base, aprPct: 0 });
    const loanAmount = base.price - base.downPaymentUsd;
    expect(r.monthlyPayment).toBeCloseTo(loanAmount / base.termMonths, 9);
    expect(r.totalInterestUsd).toBeCloseTo(0, 9);
  });

  it("opportunityRatePct = 0 gives a zero breakeven APR", () => {
    const r = calcFinancing({ ...base, opportunityRatePct: 0 });
    expect(r.breakevenAprPct).toBeCloseTo(0, 9);
    // any positive APR now costs strictly more than cash
    const positiveApr = calcFinancing({ ...base, opportunityRatePct: 0, aprPct: 1 });
    expect(positiveApr.financingCostUsd).toBeGreaterThan(0);
  });

  it("totalInterestUsd is monthlyPayment * termMonths - loanAmount", () => {
    const r = calcFinancing(base);
    const loanAmount = base.price - base.downPaymentUsd;
    expect(r.totalInterestUsd).toBeCloseTo(r.monthlyPayment * base.termMonths - loanAmount, 9);
  });
});

describe("resolveMilesBasis", () => {
  it("prefers the scored deal's lifetime miles when available", () => {
    expect(resolveMilesBasis(60, 72_000, "eol", 13_000)).toBe(72_000);
  });

  it("falls back to a fixed holdMiles when no deal is scored", () => {
    expect(resolveMilesBasis(60, null, 80_000, 13_000)).toBe(80_000);
  });

  it("falls back to annualMiles * termMonths/12 when holdMiles is 'eol' and no deal is scored", () => {
    expect(resolveMilesBasis(60, null, "eol", 12_000)).toBe(60_000);
  });

  it("defaults annualMiles to 13_000 when unset", () => {
    expect(resolveMilesBasis(24, null, "eol", undefined)).toBe(26_000);
  });
});
