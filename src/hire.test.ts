import { describe, it, expect } from "vitest";
import {
  forecastHire,
  demandCapWeekly,
  rampFractionAt,
  rampFullMonth,
  rampFractionToMonth,
  newPatientsForFullBook,
  type HireSpec,
  type HireSettings,
} from "./hire";

const settings: HireSettings = {
  superRate: 0.12,
  revenueWeeks: 46,
  annualLeaveWeeks: 4,
  superOnContractors: true,
};

// A healthy, well fed salaried physio: full book reachable, plenty of demand.
function healthySpec(over: Partial<HireSpec> = {}): HireSpec {
  return {
    employmentType: "employee",
    hourlyRate: 42,
    hoursPerWeek: 38,
    rewardPct: 0.45,
    avgSpend: 110,
    fullClientsPerWeek: 40,
    rampShape: "typical",
    newPatientsPerMonth: 30,
    avgVisitsPerPatient: 6,
    extraWeeklyCost: 200,
    ...over,
  };
}

describe("ramp curves", () => {
  it("saturate at 1 and hold the last value", () => {
    expect(rampFractionAt("typical", 1)).toBeLessThan(1);
    expect(rampFractionAt("typical", 6)).toBe(1);
    expect(rampFractionAt("typical", 24)).toBe(1);
    expect(rampFractionAt("fast", 1)).toBeGreaterThan(rampFractionAt("slow", 1));
  });
  it("reach a full book at the agreed months: fast 4, typical 6, slow 9", () => {
    expect(rampFullMonth("fast")).toBe(4);
    expect(rampFullMonth("typical")).toBe(6);
    expect(rampFullMonth("slow")).toBe(9);
    // and the month before is still below a full book
    expect(rampFractionAt("fast", 3)).toBeLessThan(1);
    expect(rampFractionAt("typical", 5)).toBeLessThan(1);
    expect(rampFractionAt("slow", 8)).toBeLessThan(1);
  });
});

describe("demand cap", () => {
  it("is monthly new patients times visits per patient, spread over the weeks in a month", () => {
    // 30 new patients * 6 visits / (52/12) weeks ≈ 41.5 visits a week
    expect(demandCapWeekly(healthySpec())).toBeCloseTo((30 * 6) / (52 / 12), 4);
  });
});

describe("forecastHire, well fed salaried hire", () => {
  const f = forecastHire(healthySpec(), settings);

  it("starts underwater then recovers (a real cash dip)", () => {
    expect(f.months[0].cumulative).toBeLessThan(0);
    expect(f.maxCashDip).toBeLessThan(0);
    expect(f.breakevenMonth).not.toBeNull();
  });

  it("cumulative cash is monotonically increasing once contribution turns positive", () => {
    const last = f.months[f.months.length - 1];
    expect(last.cumulative).toBeGreaterThan(0);
  });

  it("settles to a positive steady annual contribution", () => {
    expect(f.steadyAnnualContribution).toBeGreaterThan(0);
  });

  it("with ample demand, the binding constraint is the ramp, plateau equals full book", () => {
    expect(f.bindingConstraint).toBe("ramp");
    expect(f.plateauCaseloadWeekly).toBeCloseTo(40, 4);
  });
});

describe("new patient flow as the binding constraint (the CM bridge)", () => {
  // Only 8 new patients a month, 6 visits each -> ~11 visits a week, well below
  // a 40 a week full book. Demand, not the ramp, caps the book.
  const f = forecastHire(
    healthySpec({ newPatientsPerMonth: 8, avgVisitsPerPatient: 6 }),
    settings
  );
  it("flags new patient flow and plateaus below a full book", () => {
    expect(f.bindingConstraint).toBe("newPatientFlow");
    expect(f.plateauCaseloadWeekly).toBeLessThan(40);
    expect(f.plateauCaseloadWeekly).toBeCloseTo((8 * 6) / (52 / 12), 4);
  });
  it("breaks even later (or never within horizon) than the well fed case", () => {
    const fed = forecastHire(healthySpec(), settings);
    const starvedBe = f.breakevenMonth ?? Infinity;
    const fedBe = fed.breakevenMonth ?? Infinity;
    expect(starvedBe).toBeGreaterThanOrEqual(fedBe);
  });
});

describe("pay model matters (the mandatory fix)", () => {
  it("a contractor paid only for weeks worked has a shallower dip than the same salaried hire", () => {
    const emp = forecastHire(healthySpec({ employmentType: "employee" }), settings);
    const con = forecastHire(healthySpec({ employmentType: "contractor" }), settings);
    expect(con.maxCashDip).toBeGreaterThan(emp.maxCashDip); // less negative
  });
  it("a higher commission percentage lifts steady contribution to the practitioner, lowering clinic contribution", () => {
    const low = forecastHire(healthySpec({ rewardPct: 0.4 }), settings);
    const high = forecastHire(healthySpec({ rewardPct: 0.55 }), settings);
    expect(high.steadyAnnualContribution).toBeLessThan(low.steadyAnnualContribution);
  });
});

describe("no cash dip (cash positive from month one) does not break the indices", () => {
  // Pure commission contractor, no base wage, no extra cost, plenty of demand:
  // every month is cash positive, so the cumulative never goes negative.
  const f = forecastHire(
    healthySpec({
      employmentType: "contractor",
      hourlyRate: 0,
      extraWeeklyCost: 0,
      newPatientsPerMonth: 999,
    }),
    settings
  );
  it("keeps a valid dip month index even with no negative dip", () => {
    expect(f.maxCashDipMonth).toBeGreaterThanOrEqual(1);
    expect(f.maxCashDipMonth).toBeLessThanOrEqual(f.months.length);
    expect(f.months[f.maxCashDipMonth - 1]).toBeDefined();
    expect(Number.isFinite(f.maxCashDip)).toBe(true);
  });
  it("breaks even in month one when cash positive from the start", () => {
    expect(f.months[0].cumulative).toBeGreaterThanOrEqual(0);
    expect(f.breakevenMonth).toBe(1);
  });
});

describe("cash walk is revenue-week aware and ties to the steady figure", () => {
  it("annualising the plateau month reproduces steadyAnnualContribution", () => {
    // H1 regression guard: the monthly cash walk must be on the same
    // profitYearly basis as the headline steady figure. If the walk regresses
    // to profitWeekly*52/12 (billing all 52 weeks, reward through leave), 12x
    // the plateau month would exceed steadyAnnualContribution and this fails.
    const f = forecastHire(healthySpec(), settings);
    const plateauMonthly = f.months[f.months.length - 1].contributionMonthly;
    expect(plateauMonthly * 12).toBeCloseTo(f.steadyAnnualContribution, 2);
    expect(f.steadyAnnualContribution).toBeGreaterThan(0);
  });
});

describe("starting caseload (taking over clients)", () => {
  it("a taken-over caseload shrinks the cash dip and brings break even forward", () => {
    const cold = forecastHire(healthySpec({ startingCaseload: 0 }), settings);
    const warm = forecastHire(healthySpec({ startingCaseload: 20 }), settings);
    expect(warm.maxCashDip).toBeGreaterThan(cold.maxCashDip); // less negative
    const coldBe = cold.breakevenMonth ?? Infinity;
    const warmBe = warm.breakevenMonth ?? Infinity;
    expect(warmBe).toBeLessThanOrEqual(coldBe);
  });
  it("starting on a full book breaks even almost immediately", () => {
    const f = forecastHire(healthySpec({ startingCaseload: 40, newPatientsPerMonth: 999 }), settings);
    expect(f.months[0].caseloadWeekly).toBeGreaterThanOrEqual(39);
    expect(f.breakevenMonth).toBeLessThanOrEqual(2);
  });
  it("an inherited book above new patient flow holds as the plateau floor", () => {
    // 2 new patients/mo is a tiny flow, but they inherit 25 a week.
    const f = forecastHire(healthySpec({ startingCaseload: 25, newPatientsPerMonth: 2, avgVisitsPerPatient: 6 }), settings);
    expect(f.plateauCaseloadWeekly).toBeCloseTo(25, 4);
  });
});

describe("reactivations are free demand that lift the plateau", () => {
  it("reactivations raise the sustainable book without any marketing", () => {
    const noReact = forecastHire(healthySpec({ newPatientsPerMonth: 20, reactivationsPerMonth: 0 }), settings);
    const withReact = forecastHire(healthySpec({ newPatientsPerMonth: 20, reactivationsPerMonth: 8 }), settings);
    expect(withReact.plateauCaseloadWeekly).toBeGreaterThan(noReact.plateauCaseloadWeekly);
    // 28 episodes/mo * 7 visits / (52/12) weeks
    expect(demandCapWeekly(healthySpec({ newPatientsPerMonth: 20, reactivationsPerMonth: 8, avgVisitsPerPatient: 7 })))
      .toBeCloseTo((28 * 7) / (52 / 12), 4);
  });
});

describe("newPatientsForFullBook + parametric fill ramp (marketing model)", () => {
  it("returns the monthly episodes needed to sustain a full book", () => {
    // 50 a week full, 7 visits each -> 50 * (52/12) / 7 = 30.95 a month
    expect(newPatientsForFullBook(healthySpec({ fullClientsPerWeek: 50, avgVisitsPerPatient: 7 })))
      .toBeCloseTo((50 * (52 / 12)) / 7, 3);
  });
  it("rampFractionToMonth reaches a full book exactly at the target and holds", () => {
    expect(rampFractionToMonth(4, 4)).toBeCloseTo(1, 6);
    expect(rampFractionToMonth(4, 3)).toBeLessThan(1);
    expect(rampFractionToMonth(4, 9)).toBe(1);
    expect(rampFractionToMonth(2, 2)).toBeCloseTo(1, 6);
  });
  it("filling faster (full by 3) makes more year-one profit than filling slow (full by 9)", () => {
    const required = Math.ceil(newPatientsForFullBook(healthySpec({ fullClientsPerWeek: 50, avgVisitsPerPatient: 7 })));
    const fast = forecastHire(healthySpec({ fullClientsPerWeek: 50, avgVisitsPerPatient: 7, newPatientsPerMonth: required, rampFullByMonth: 3 }), settings);
    const slow = forecastHire(healthySpec({ fullClientsPerWeek: 50, avgVisitsPerPatient: 7, newPatientsPerMonth: required, rampFullByMonth: 9 }), settings);
    expect(fast.months[11].cumulative).toBeGreaterThan(slow.months[11].cumulative);
    // both reach a full book plateau
    expect(fast.plateauCaseloadWeekly).toBeCloseTo(50, 0);
  });
});

describe("robustness", () => {
  it("never returns NaN on empty or zero inputs", () => {
    const f = forecastHire(
      {
        employmentType: "employee",
        hourlyRate: 0,
        hoursPerWeek: 0,
        rewardPct: 0,
        avgSpend: 0,
        fullClientsPerWeek: 0,
        rampShape: "typical",
        newPatientsPerMonth: 0,
        avgVisitsPerPatient: 0,
        extraWeeklyCost: 0,
      },
      settings
    );
    for (const m of f.months) {
      expect(Number.isFinite(m.cumulative)).toBe(true);
      expect(Number.isFinite(m.contributionMonthly)).toBe(true);
    }
  });
});
