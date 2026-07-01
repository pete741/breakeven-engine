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
  /** Optional override: target the month a full book is reached (e.g. 2 to 9). When
   *  set and positive it replaces rampShape with a steady build to a full book by
   *  that month. Used by the marketing forecast to model filling faster. */
  rampFullByMonth?: number;
  /** New patients per month the clinic can realistically feed this practitioner. */
  newPatientsPerMonth: number;
  /** Reactivated clients per month: existing database patients returning for a new
   *  episode of care. They feed the book just like a new patient but cost nothing
   *  to acquire (no marketing). Defaults to 0. */
  reactivationsPerMonth?: number;
  /** Average number of visits a patient makes across a full episode of care. */
  avgVisitsPerPatient: number;
  /** Extra running cost per week this hire adds (room, admin time, software, consumables). */
  extraWeeklyCost: number;
  /** Caseload (visits per week) the practitioner starts with in week one, e.g. an
   *  inherited or taken-over caseload. Defaults to 0 (a cold start). It lifts the
   *  early months, so it shrinks the cash dip and brings the break even forward. */
  startingCaseload?: number;
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
// behind a formula. Calibrated across professions so a full book lands at:
// fast month 4, typical month 6, slow month 9. They saturate at 1 and the last
// value is held for every later month.
const RAMP_CURVES: Record<RampShape, number[]> = {
  fast: [0.5, 0.78, 0.93, 1],
  typical: [0.18, 0.36, 0.54, 0.7, 0.86, 1],
  slow: [0.08, 0.18, 0.3, 0.42, 0.54, 0.66, 0.78, 0.9, 1],
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

/** The month a full book is first reached for a given ramp shape (4, 6 or 9). */
export function rampFullMonth(shape: RampShape): number {
  const curve = RAMP_CURVES[shape];
  const i = curve.findIndex((v) => v >= 1);
  return (i === -1 ? curve.length : i) + 1;
}

/** A steady build to a full book by an arbitrary target month (used for the
 *  marketing "have them full by month T" control, T from about 2 to 9). A gentle
 *  ease in that reaches a full book exactly at the target month and holds. */
export function rampFractionToMonth(targetMonth: number, month: number): number {
  if (month < 1) return 0;
  const T = Math.max(1, targetMonth);
  return Math.min(1, Math.pow(month / T, 1.3));
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
  const react = Math.max(0, safe(spec.reactivationsPerMonth ?? 0));
  const visits = Math.max(0, safe(spec.avgVisitsPerPatient));
  return ((np + react) * visits) / WEEKS_PER_MONTH;
}

/** Total new episodes a month (new patients plus reactivations) needed to sustain
 *  a full book. The marketing maths subtracts current new patients and
 *  reactivations from this to find the shortfall marketing has to cover. */
export function newPatientsForFullBook(spec: HireSpec): number {
  const visits = Math.max(1e-9, safe(spec.avgVisitsPerPatient));
  return (Math.max(0, safe(spec.fullClientsPerWeek)) * WEEKS_PER_MONTH) / visits;
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
  // A taken-over caseload they start week one on. Cannot exceed a full book.
  const baseline = Math.max(0, Math.min(full, safe(spec.startingCaseload ?? 0)));
  const cap = demandCapWeekly(spec);
  // An inherited book is real ongoing demand, so the effective ceiling is the
  // greater of new patient flow and the baseline, never above a full book.
  const ceiling = Math.min(full, Math.max(baseline, cap));
  const plateau = ceiling;
  const bindingConstraint: BindingConstraint =
    ceiling < full - 1e-9 ? "newPatientFlow" : "ramp";

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
    const rampFraction =
      spec.rampFullByMonth && spec.rampFullByMonth > 0
        ? rampFractionToMonth(spec.rampFullByMonth, m)
        : rampFractionAt(spec.rampShape, m);
    // The book ramps from the baseline up toward a full book, held under the
    // effective ceiling (new patient flow or the inherited book).
    const organic = baseline + (full - baseline) * rampFraction;
    const caseloadWeekly = Math.min(ceiling, organic);

    const site = runAt(caseloadWeekly);
    const person = site.people[0];
    // Revenue-week aware, on the SAME annual basis as steadyAnnualContribution
    // (profitYearly), not a naive profitWeekly * 52. The old walk billed all 52
    // weeks and paid reward through the leave weeks, overstating a salaried
    // hire's yearly cash contribution by ~20%+ and so reporting an optimistic
    // break-even month and a too-shallow cash dip. Dividing each month's
    // caseload-specific yearly figures by 12 keeps the plateau year's monthly
    // contribution consistent with the headline steady figure.
    const billingsMonthly = person.yearlyRevenue / 12;
    const payMonthly = person.yearlyPay / 12;
    const contributionMonthly = site.profitYearly / 12;

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
