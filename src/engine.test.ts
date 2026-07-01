import { describe, it, expect } from "vitest";
import { computeBusiness, type BusinessInput } from "./engine";

// ---------------------------------------------------------------------------
// These cases reproduce the exact "Clinic 1" worked example from Pete's
// MASTER COPY spreadsheet. Every expected value below was read straight out of
// the sheet's own computed cells. If the engine drifts from the sheet, these
// fail.
// ---------------------------------------------------------------------------

const clinic1: BusinessInput = {
  clinicName: "Physio Fit",
  settings: { superRate: 0.12, revenueWeeks: 46, annualLeaveWeeks: 4 },
  sites: [
    {
      id: "s1",
      name: "Clinic 1",
      weeklyExpenses: 3000,
      people: [
        {
          id: "johnny",
          name: "Johnny",
          role: "admin",
          employmentType: "employee",
          hourlyRate: 30,
          hoursPerWeek: 38,
          rewardPct: 0,
          avgSpend: 0,
          clientsPerWeek: 0,
        },
        {
          id: "sally",
          name: "Sally",
          role: "admin",
          employmentType: "employee",
          hourlyRate: 40,
          hoursPerWeek: 38,
          rewardPct: 0,
          avgSpend: 0,
          clientsPerWeek: 0,
        },
        {
          id: "megan",
          name: "Megan",
          role: "therapist",
          employmentType: "employee",
          hourlyRate: 38.41,
          hoursPerWeek: 38,
          rewardPct: 0,
          avgSpend: 230,
          clientsPerWeek: 48,
        },
        {
          id: "pete",
          name: "Pete",
          role: "director",
          employmentType: "employee",
          hourlyRate: 63,
          hoursPerWeek: 38,
          rewardPct: 0,
          avgSpend: 119,
          clientsPerWeek: 0,
          ownershipPct: 1.0,
        },
      ],
    },
  ],
};

describe("Clinic 1 worked example (matches the spreadsheet)", () => {
  const r = computeBusiness(clinic1);
  const site = r.sites[0];

  it("per person base + super (E)", () => {
    const byId = Object.fromEntries(site.people.map((p) => [p.id, p]));
    expect(byId.johnny.baseSuperWeekly).toBeCloseTo(1276.8, 4);
    expect(byId.sally.baseSuperWeekly).toBeCloseTo(1702.4, 4);
    expect(byId.megan.baseSuperWeekly).toBeCloseTo(1634.7296, 4);
    expect(byId.pete.baseSuperWeekly).toBeCloseTo(2681.28, 4);
  });

  it("therapist revenue, reward and pay (H / I / J)", () => {
    const m = site.people.find((p) => p.id === "megan")!;
    expect(m.revenueWeekly).toBeCloseTo(11040, 4);
    expect(m.rewardWeekly).toBeCloseTo(0, 6);
    expect(m.payWeekly).toBeCloseTo(1634.7296, 4);
    expect(m.yearlyPay).toBeCloseTo(85005.9392, 3);
  });

  it("director take home with dividends (M)", () => {
    const d = r.directors.find((x) => x.id === "pete")!;
    expect(d.yearlyPay).toBeCloseTo(139426.56, 2);
    expect(d.takeHome).toBeCloseTo(111915.6608, 2);
  });

  // The sheet hard-codes the leave multiplier as a 6 dp rounded constant
  // (0.076923) where the engine uses the exact fraction 4/52. They agree to the
  // cent, so leave dependent figures are asserted to whole cent precision.
  it("leave liability per week (Q)", () => {
    const byId = Object.fromEntries(site.people.map((p) => [p.id, p]));
    expect(byId.johnny.leaveWeekly).toBeCloseTo(87.69222, 2);
    expect(byId.sally.leaveWeekly).toBeCloseTo(116.92296, 2);
    expect(byId.megan.leaveWeekly).toBeCloseTo(112.2752723, 2);
    expect(byId.pete.leaveWeekly).toBeCloseTo(184.153662, 2);
  });

  it("site wages, cost and revenue (W2 / F32 / F33 / F34)", () => {
    expect(site.wagesExcLeaveWeekly).toBeCloseTo(7295.2096, 3);
    expect(site.actualWagesWeekly).toBeCloseTo(7796.253714, 2);
    expect(site.totalCostWeekly).toBeCloseTo(10796.25371, 2);
    expect(site.totalRevenueWeekly).toBeCloseTo(11040, 4);
  });

  it("blended spend and weekly profit (H30 / F35)", () => {
    expect(site.avgSpend).toBeCloseTo(230, 4);
    expect(site.profitWeekly).toBeCloseTo(243.7462857, 2);
  });

  it("yearly profit, margin, quarter (H35 / H36 / H37)", () => {
    expect(site.revenueYearly).toBeCloseTo(507840, 2);
    expect(site.profitYearly).toBeCloseTo(-27510.8992, 2);
    expect(site.profitMargin).toBeCloseTo(-0.05417237555, 6);
    expect(site.profitQuarter).toBeCloseTo(-6877.7248, 2);
  });

  // Break-even INTENTIONALLY diverges from the sheet's F36 (46.94). The sheet's
  // figure was totalCostWeekly/avgSpend, which ignored the leave-week burden and
  // is why this very clinic reads a $27.5k annual LOSS while sitting at 48
  // clients, "above" the old break-even. The engine now reports the annually
  // consistent break-even (~50.60), the caseload at which profitYearly is zero.
  it("break-even is the annually-consistent caseload (supersedes sheet F36)", () => {
    expect(site.breakevenClients).toBeCloseTo(50.60027403, 4);
    // Sanity: it must sit above the current loss-making 48-client caseload.
    expect(site.breakevenClients!).toBeGreaterThan(site.totalClientsWeekly);
  });
});

describe("break-even is annually consistent (E1 regression guard)", () => {
  it("running exactly at breakevenClients yields ~zero annual profit", () => {
    const r = computeBusiness(clinic1);
    const be = r.sites[0].breakevenClients!;
    // Pete bills nothing, so the blended spend ($230) is independent of Megan's
    // caseload; putting her on exactly the break-even caseload must drive the
    // site's yearly profit to ~0. The old figure left this at -$27.5k.
    const atBreakeven = computeBusiness({
      ...clinic1,
      sites: [
        {
          ...clinic1.sites[0],
          people: clinic1.sites[0].people.map((p) =>
            p.id === "megan" ? { ...p, clientsPerWeek: be } : p
          ),
        },
      ],
    });
    expect(atBreakeven.sites[0].profitYearly).toBeCloseTo(0, 2);
  });
});

describe("rolling reward mechanic", () => {
  it("pays the reward when it beats base, and flags onReward", () => {
    const r = computeBusiness({
      clinicName: "T",
      settings: { superRate: 0.115, revenueWeeks: 46, annualLeaveWeeks: 4 },
      sites: [
        {
          id: "s",
          name: "S",
          weeklyExpenses: 0,
          people: [
            {
              id: "busy",
              name: "Busy",
              role: "therapist",
              employmentType: "employee",
              hourlyRate: 40,
              hoursPerWeek: 38,
              rewardPct: 0.4,
              avgSpend: 110,
              clientsPerWeek: 50, // 50*110*0.4 = 2200 base reward, beats ~1520 base
            },
          ],
        },
      ],
    });
    const p = r.sites[0].people[0];
    expect(p.onReward).toBe(true);
    expect(p.payWeekly).toBeGreaterThan(p.baseSuperWeekly);
    expect(p.payWeekly).toBeCloseTo(50 * 110 * 0.4 * 1.115, 4);
  });

  it("pays base when reward falls short", () => {
    const r = computeBusiness({
      clinicName: "T",
      settings: { superRate: 0.115, revenueWeeks: 46, annualLeaveWeeks: 4 },
      sites: [
        {
          id: "s",
          name: "S",
          weeklyExpenses: 0,
          people: [
            {
              id: "quiet",
              name: "Quiet",
              role: "therapist",
              employmentType: "employee",
              hourlyRate: 40,
              hoursPerWeek: 38,
              rewardPct: 0.4,
              avgSpend: 100,
              clientsPerWeek: 20, // 20*100*0.4 = 800 reward, below base ~1520
            },
          ],
        },
      ],
    });
    const p = r.sites[0].people[0];
    expect(p.onReward).toBe(false);
    expect(p.payWeekly).toBeCloseTo(38 * 40 * 1.115, 4);
  });
});

describe("contractor handling", () => {
  it("pays contractors only for revenue weeks and accrues no leave", () => {
    const r = computeBusiness({
      clinicName: "T",
      settings: { superRate: 0.115, revenueWeeks: 46, annualLeaveWeeks: 4 },
      sites: [
        {
          id: "s",
          name: "S",
          weeklyExpenses: 0,
          people: [
            {
              id: "con",
              name: "Con",
              role: "therapist",
              employmentType: "contractor",
              hourlyRate: 0,
              hoursPerWeek: 0,
              rewardPct: 0.45,
              avgSpend: 120,
              clientsPerWeek: 40,
            },
          ],
        },
      ],
    });
    const p = r.sites[0].people[0];
    expect(p.leaveWeekly).toBe(0);
    expect(p.payWeekly).toBeCloseTo(40 * 120 * 0.45 * 1.115, 4);
    expect(p.yearlyPay).toBeCloseTo(40 * 120 * 0.45 * 1.115 * 46, 3);
  });
});

describe("director dividends draw on their own site's profit (not business total)", () => {
  // Two single-site owners, each 100% of their own clinic. Business-total
  // profit would double-count; each director must see only their site.
  const r = computeBusiness({
    clinicName: "Two Owners",
    settings: { superRate: 0.115, revenueWeeks: 46, annualLeaveWeeks: 4 },
    sites: [
      {
        id: "a",
        name: "Profitable",
        weeklyExpenses: 500,
        people: [
          { id: "da", name: "Dir A", role: "director", employmentType: "employee", hourlyRate: 40, hoursPerWeek: 20, rewardPct: 0, avgSpend: 0, clientsPerWeek: 0, ownershipPct: 1 },
          { id: "ta", name: "T A", role: "therapist", employmentType: "employee", hourlyRate: 35, hoursPerWeek: 38, rewardPct: 0.4, avgSpend: 120, clientsPerWeek: 60 },
        ],
      },
      {
        id: "b",
        name: "Loss making",
        weeklyExpenses: 4000,
        people: [
          { id: "db", name: "Dir B", role: "director", employmentType: "employee", hourlyRate: 40, hoursPerWeek: 20, rewardPct: 0, avgSpend: 0, clientsPerWeek: 0, ownershipPct: 1 },
          { id: "tb", name: "T B", role: "therapist", employmentType: "employee", hourlyRate: 35, hoursPerWeek: 38, rewardPct: 0.4, avgSpend: 90, clientsPerWeek: 20 },
        ],
      },
    ],
  });

  it("each director's dividend equals their own site's yearly profit x ownership", () => {
    const siteA = r.sites.find((s) => s.id === "a")!;
    const siteB = r.sites.find((s) => s.id === "b")!;
    const dirA = r.directors.find((d) => d.id === "da")!;
    const dirB = r.directors.find((d) => d.id === "db")!;
    expect(dirA.dividend).toBeCloseTo(siteA.profitYearly * 1, 6);
    expect(dirB.dividend).toBeCloseTo(siteB.profitYearly * 1, 6);
    // Total dividends must never exceed total business profit (no double count).
    expect(dirA.dividend + dirB.dividend).toBeCloseTo(r.profitYearly, 6);
  });
});

describe("no-revenue guards return n/a (null), not falsely reassuring zeros", () => {
  const r = computeBusiness({
    clinicName: "Pre-trade",
    settings: { superRate: 0.115, revenueWeeks: 46, annualLeaveWeeks: 4 },
    sites: [
      {
        id: "s",
        name: "Fitting out",
        weeklyExpenses: 3000,
        people: [
          { id: "a", name: "Admin", role: "admin", employmentType: "employee", hourlyRate: 32, hoursPerWeek: 38, rewardPct: 0, avgSpend: 0, clientsPerWeek: 0 },
        ],
      },
    ],
  });
  it("breakeven and margin are null when there is no revenue", () => {
    expect(r.sites[0].breakevenClients).toBeNull();
    expect(r.sites[0].profitMargin).toBeNull();
    expect(r.breakevenClients).toBeNull();
    // It is unambiguously losing money, not at 0% margin.
    expect(r.sites[0].profitYearly).toBeLessThan(0);
  });
});

describe("contractor with logged hours (deliberate model)", () => {
  it("pays max(base, reward) for worked weeks only, no leave, null hourly when no hours", () => {
    const r = computeBusiness({
      clinicName: "T",
      settings: { superRate: 0.115, revenueWeeks: 46, annualLeaveWeeks: 4 },
      sites: [
        {
          id: "s",
          name: "S",
          weeklyExpenses: 0,
          people: [
            { id: "c", name: "Con", role: "therapist", employmentType: "contractor", hourlyRate: 0, hoursPerWeek: 0, rewardPct: 0.45, avgSpend: 120, clientsPerWeek: 40 },
          ],
        },
      ],
    });
    const p = r.sites[0].people[0];
    expect(p.leaveWeekly).toBe(0);
    expect(p.adjustedHourly).toBeNull();
    expect(p.yearlyPay).toBeCloseTo(p.payWeekly * 46, 6);
  });
});

describe("multi site roll up", () => {
  it("sums revenue and profit across sites", () => {
    const r = computeBusiness({
      clinicName: "Group",
      settings: { superRate: 0.115, revenueWeeks: 46, annualLeaveWeeks: 4 },
      sites: [
        {
          id: "a",
          name: "A",
          weeklyExpenses: 1000,
          people: [
            {
              id: "t1",
              name: "T1",
              role: "therapist",
              employmentType: "employee",
              hourlyRate: 35,
              hoursPerWeek: 38,
              rewardPct: 0.4,
              avgSpend: 100,
              clientsPerWeek: 45,
            },
          ],
        },
        {
          id: "b",
          name: "B",
          weeklyExpenses: 800,
          people: [
            {
              id: "t2",
              name: "T2",
              role: "therapist",
              employmentType: "employee",
              hourlyRate: 35,
              hoursPerWeek: 38,
              rewardPct: 0.4,
              avgSpend: 97,
              clientsPerWeek: 40,
            },
          ],
        },
      ],
    });
    expect(r.totalRevenueWeekly).toBeCloseTo(
      r.sites[0].totalRevenueWeekly + r.sites[1].totalRevenueWeekly,
      6
    );
    expect(r.profitYearly).toBeCloseTo(
      r.sites[0].profitYearly + r.sites[1].profitYearly,
      6
    );
  });
});
