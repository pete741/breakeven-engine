// ============================================================================
// Next Hire Breakeven Forecast
// ----------------------------------------------------------------------------
// Pure, deterministic. Built ON TOP of the validated rolling break even engine
// (computeBusiness), so the practitioner pay maths is the same spreadsheet
// reverse engineered logic used everywhere else: in any week the practitioner is
// paid the HIGHER of their base wage or their reward (a percentage of what they
// bill). That rolling pay is exactly what creates the early cash dip: a new hire
// costs base wage while their book is still light, then flips to reward once it
// fills.
//
// The forecast walks month by month. Each month the new practitioner's caseload
// fills along a chosen ramp curve toward full books, but is capped by whichever
// is lower: the ramp, or the caseload the clinic's new patient flow can actually
// sustain. Marginal weekly profit (their billings, minus their rolling pay and
// leave accrual, minus the extra weekly running cost they add) is annualised to
// a monthly figure and accumulated. The month the cumulative cash turns positive
// is the break even month.
// ============================================================================

import type { EmploymentType, Settings } from "./engine";
import { computeBusiness } from "./engine";

export type RampShape = "slow" | "typical" | "fast";

export interface HireSpec {
  /** employee (paid through leave weeks) or contractor (paid only for weeks worked). */
  employmentType: EmploymentType;
  /** Base wage dollars per hour. A pure commission contractor can set this to 0. */
  hourlyRate: number;
  /** Paid clinical hours per week. */
  hoursPerWeek: number;
  /** Reward / commission as a fraction of what they bill, e.g. 0.45 for 45%. */
  rewardPct: number;
  /** Average fee the clinic collects per visit (dollars). */
  avgSpend: number;
  /** Caseload (client visits per week) when their book is completely full. */
  fullClientsPerWeek: number;
  /** Ramp curve: how a new book fills over the early months. */
  rampShape: RampShape;
  /** New patients per month the clinic can realistically feed this practitioner. */
  newPatientsPerMonth: number;
  /** Average number of visits a patient makes across a full episode of care. */
  avgVisitsPerPatient: number;
  /** Extra running cost per week this hire adds (room, admin time, software, consumables). */
  extraWeeklyCost: number;
}

export interface HireSettings {
  /** Superannuation rate as a fraction, e.g. 0.12. */
  superRate: number;
  /** Weeks a year the practitioner actually generates revenue (44 to 48 typical). */
  revenueWeeks: number;
  /** Paid annual leave weeks (for the leave liability accrual). */
  annualLeaveWeeks: number;
  /** Whether super is paid on contractors (AU: yes). Defaults to true when unset. */
  superOnContractors?: boolean;
}

export interface HireMonth {
  /** 1 based month index. */
  month: number;
  /** The fraction of a full book the ramp alone would reach this month (0..1). */
  rampFraction: number;
  /** Caseload actually delivered this week of the month (client visits per week). */
  caseloadWeekly: number;
  /** What the practitioner bills this month. */
  billingsMonthly: number;
  /** What the practitioner is paid this month (rolling: higher of base or reward, plus super and leave). */
  payMonthly: number;
  /** Marginal contribution this month: billings minus pay minus extra running cost. */
  contributionMonthly: number;
  /** Running cumulative cash position since the hire started. Negative = still underwater. */
  cumulative: number;
}

export type BindingConstraint = "ramp" | "newPatientFlow";

export interface HireForecast {
  months: HireMonth[];
  /** First month the cumulative cash position turns non negative. Null if it never does within the horizon. */
  breakevenMonth: number | null;
  /** Deepest the cumulative cash goes before recovering (a negative dollar figure). */
  maxCashDip: number;
  /** The month the deepest cash dip occurs. */
  maxCashDipMonth: number;
  /** Steady state weekly caseload once ramp and demand settle. */
  plateauCaseloadWeekly: number;
  /** The full book caseload for reference (so the UI can show the gap when demand caps below it). */
  fullClientsPerWeek: number;
  /** Steady state annual marginal contribution once the book has settled. */
  steadyAnnualContribution: number;
  /** Cumulative cash position at month 12 (or the last month if the horizon is shorter). */
  cumulativeAtMonth12: number;
  /** Which lever is holding the practitioner below a full book: the ramp, or the clinic's new patient flow. */
  bindingConstraint: BindingConstraint;
}

const WEEKS_PER_MONTH = 52 / 12; // 4.3333...

// Transparent ramp curves: the fraction of a full book reached by the end of
// each month. Shown openly in the tool as an editable assumption, never hidden
// behind a formula. They saturate at 1 and the last value is held for every
// later month.
const RAMP_CURVES: Record<RampShape, number[]> = {
  fast: [0.4, 0.65, 0.85, 0.95, 1, 1],
  typical: [0.2, 0.4, 0.6, 0.75, 0.88, 1, 1],
  slow: [0.1, 0.25, 0.4, 0.55, 0.68, 0.8, 0.9, 1, 1],
};

export function rampFractionAt(shape: RampShape, month: number): number {
  const curve = RAMP_CURVES[shape];
  if (month < 1) return 0;
  const idx = Math.min(month, curve.length) - 1;
  return curve[idx];
}

/** Expose the ramp curve so the UI can render it as a visible assumption. */
export function rampCurve(shape: RampShape): number[] {
  return [...RAMP_CURVES[shape]];
}

function safe(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * The sustainable weekly caseload the clinic's new patient flow can support.
 * Each new patient generates avgVisitsPerPatient visits across their episode of
 * care, so the steady flow of visits a week is the monthly new patient inflow
 * times visits per patient, spread across the weeks in a month. A practitioner
 * cannot hold a book bigger than the demand feeding it.
 */
export function demandCapWeekly(spec: HireSpec): number {
  const np = Math.max(0, safe(spec.newPatientsPerMonth));
  const visits = Math.max(0, safe(spec.avgVisitsPerPatient));
  return (np * visits) / WEEKS_PER_MONTH;
}

/**
 * Build the month by month forecast for one new practitioner.
 * `horizonMonths` defaults to 24 so the break even and steady state are visible
 * for even a slow ramp on a demand constrained book.
 */
export function forecastHire(
  spec: HireSpec,
  settings: HireSettings,
  horizonMonths = 24
): HireForecast {
  const engineSettings: Settings = {
    superRate: safe(settings.superRate),
    revenueWeeks: settings.revenueWeeks,
    annualLeaveWeeks: settings.annualLeaveWeeks,
    superOnContractors: settings.superOnContractors !== false,
    revenueMode: "clients",
  };

  const full = Math.max(0, safe(spec.fullClientsPerWeek));
  const cap = demandCapWeekly(spec);
  // The plateau is whichever ceiling is lower once the ramp has finished.
  const plateau = Math.min(full, cap);
  const bindingConstraint: BindingConstraint =
    cap < full - 1e-9 ? "newPatientFlow" : "ramp";

  // Run the validated engine for a single site holding only this hire at a given
  // weekly caseload. The site's weekly profit IS the hire's marginal weekly
  // contribution (their billings, minus their rolling pay and leave accrual,
  // minus the extra weekly running cost). profitYearly is the revenue-week aware
  // annual figure (it bills only the revenue weeks and still pays base through
  // the leave weeks), which is the honest steady state number.
  function runAt(caseloadWeekly: number) {
    const site = computeBusiness({
      clinicName: "hire",
      settings: engineSettings,
      sites: [
        {
          id: "s",
          name: "hire",
          weeklyExpenses: Math.max(0, safe(spec.extraWeeklyCost)),
          people: [
            {
              id: "p",
              name: "New hire",
              role: "therapist",
              employmentType: spec.employmentType,
              hourlyRate: Math.max(0, safe(spec.hourlyRate)),
              hoursPerWeek: Math.max(0, safe(spec.hoursPerWeek)),
              rewardPct: Math.max(0, safe(spec.rewardPct)),
              avgSpend: Math.max(0, safe(spec.avgSpend)),
              clientsPerWeek: caseloadWeekly,
            },
          ],
        },
      ],
    }).sites[0];
    return site;
  }

  const months: HireMonth[] = [];
  let cumulative = 0;
  // Seed the dip at +Infinity so the true minimum cumulative cash is always
  // captured with a valid month index, even when the hire is cash positive from
  // month one and the cumulative never actually goes negative.
  let maxCashDip = Infinity;
  let maxCashDipMonth = 1;
  let breakevenMonth: number | null = null;

  for (let m = 1; m <= horizonMonths; m++) {
    const rampFraction = rampFractionAt(spec.rampShape, m);
    const caseloadWeekly = Math.min(rampFraction * full, cap);

    const site = runAt(caseloadWeekly);
    const person = site.people[0];
    const billingsMonthly = person.revenueWeekly * WEEKS_PER_MONTH;
    const payWeekly = person.payWeekly + person.leaveWeekly;
    const payMonthly = payWeekly * WEEKS_PER_MONTH;
    const contributionMonthly = site.profitWeekly * WEEKS_PER_MONTH;

    cumulative += contributionMonthly;
    if (cumulative < maxCashDip) {
      maxCashDip = cumulative;
      maxCashDipMonth = m;
    }
    if (breakevenMonth === null && cumulative >= 0) {
      breakevenMonth = m;
    }

    months.push({
      month: m,
      rampFraction,
      caseloadWeekly,
      billingsMonthly,
      payMonthly,
      contributionMonthly,
      cumulative,
    });
  }

  const cumulativeAtMonth12 =
    months[Math.min(12, months.length) - 1]?.cumulative ?? 0;

  // Steady state annual contribution, taken from the engine's revenue-week aware
  // profitYearly at the settled (plateau) caseload, not profitWeekly times 52,
  // so it matches the Rolling Break Even tool and an owner's accountant.
  const steadyAnnualContribution = runAt(plateau).profitYearly;

  return {
    months,
    breakevenMonth,
    maxCashDip: Number.isFinite(maxCashDip) ? maxCashDip : 0,
    maxCashDipMonth,
    plateauCaseloadWeekly: plateau,
    fullClientsPerWeek: full,
    steadyAnnualContribution,
    cumulativeAtMonth12,
    bindingConstraint,
  };
}
