// ============================================================================
// Clinic Mastery, Rolling Break Even & Forecasting engine
// ----------------------------------------------------------------------------
// Pure, deterministic, framework free. Every formula here is reverse engineered
// from Pete's "MASTER COPY Break Even & Forecasting Spreadsheet" and validated
// against that sheet's own output values (see engine.test.ts).
//
// The core mechanic is the "rolling" reward: in any given week a practitioner
// is paid the HIGHER of their base wage or their reward (a percentage of the
// revenue they generate). That is what makes the break even roll with the
// numbers you put in, rather than sitting at one fixed point.
// ============================================================================

export type Role = "admin" | "therapist" | "director";
export type EmploymentType = "employee" | "contractor";

export interface Person {
  id: string;
  name: string;
  role: Role;
  employmentType: EmploymentType;
  /** Dollars per hour (B). Contractors can leave this at 0. */
  hourlyRate: number;
  /** Hours worked per week (C). */
  hoursPerWeek: number;
  /** Reward / commission as a fraction, e.g. 0.4 for 40% (D). 0 means none. */
  rewardPct: number;
  /** Average spend per client visit (G). */
  avgSpend: number;
  /** Average clients seen per week (F). */
  clientsPerWeek: number;
  /** Directors only: ownership of the business as a fraction, e.g. 0.5. */
  ownershipPct?: number;
  /** Optional planning ceiling: the most clients per week this person is willing
   *  or able to see. The break even maths ignores this (it uses clientsPerWeek);
   *  the forecasting, goal seek and coming off the tools tools respect it so they
   *  do not pile extra clients onto an owner who is at capacity or coming off the
   *  tools. */
  maxClientsPerWeek?: number;
}

export interface Site {
  id: string;
  name: string;
  /** Weekly operating expenses (B33). Yearly operating costs / 52, excluding
   *  all salaries, bonuses and super. */
  weeklyExpenses: number;
  people: Person[];
}

/** How a clinic measures practitioner throughput across the whole scenario. */
export type RevenueMode = 'clients' | 'billable';

export interface Settings {
  /** Superannuation rate as a fraction, e.g. 0.12 for 12% (F3). */
  superRate: number;
  /** Weeks per year a practitioner actually generates revenue (F2). Accounts
   *  for annual leave, public holidays and sick leave. Typically 44 to 48. */
  revenueWeeks: number;
  /** Paid annual leave weeks, used for the leave liability accrual (R3 = weeks/52). */
  annualLeaveWeeks: number;
  /** Whether super is paid on contractors. In Australia you generally must, so
   *  this defaults to true (undefined is treated as true). Overseas clinics can
   *  turn it off. Employees always have super applied at superRate. */
  superOnContractors?: boolean;
  /** The clients a week a single full time therapist sees at this clinic. Varies
   *  hugely with appointment length (25 for long sessions, 100+ for short ones).
   *  The break even maths ignores it; the planning tools (goal seek, coming off
   *  the tools) use it to convert a client requirement into a number of hires.
   *  Treated as 40 when unset. */
  fullTimeClientLoad?: number;
  /** How the clinic measures throughput, scenario-wide. 'clients' (the implied
   *  default when undefined, for backward compatibility) means the per-person
   *  `clientsPerWeek` field holds a whole number of client visits and `avgSpend`
   *  is dollars per visit. 'billable' means `clientsPerWeek` holds billable
   *  hours per week (which may be fractional, e.g. 24.44) and `avgSpend` is
   *  dollars per billable hour. The break-even maths is IDENTICAL in both modes
   *  (revenue = avgSpend * clientsPerWeek); only labels and display precision
   *  change. Always read this through the `revenueMode()` accessor so a legacy
   *  undefined value resolves to 'clients'. */
  revenueMode?: RevenueMode;
}

/** Clinic full time client load, defaulting sensibly when unset. */
export function fullTimeLoad(s: Settings): number {
  const n = s.fullTimeClientLoad;
  return n && n > 0 ? n : 40;
}

/** How the clinic measures throughput. Maps a legacy/undefined value to
 *  'clients' so every existing scenario, save and share-link keeps working.
 *  Consumers MUST read mode through this accessor and never compare
 *  `settings.revenueMode` directly (an `!== 'clients'` check would wrongly
 *  treat undefined as billable). */
export function revenueMode(s: Settings): RevenueMode {
  return s.revenueMode === 'billable' ? 'billable' : 'clients';
}

export interface BusinessInput {
  clinicName: string;
  settings: Settings;
  sites: Site[];
}

// ---------------------------------------------------------------------------
// Per person result
// ---------------------------------------------------------------------------

export interface PersonResult {
  id: string;
  name: string;
  role: Role;
  employmentType: EmploymentType;
  /** Base wage per week, no super (hours * rate). */
  baseWeekly: number;
  /** Base wage + super per week (E). */
  baseSuperWeekly: number;
  /** Revenue generated per week (H) = avgSpend * clients. */
  revenueWeekly: number;
  /** Reward per week if paid on percentage, super included (I). */
  rewardWeekly: number;
  /** Actual pay per week = the higher of base+super vs reward (J). */
  payWeekly: number;
  /** Effective hourly rate once reward is taken into account (K). Null when
   *  the person logs no hours (e.g. a reward-only contractor). */
  adjustedHourly: number | null;
  /** Total pay across the year (L). */
  yearlyPay: number;
  /** Revenue generated across the year (N). */
  yearlyRevenue: number;
  /** Revenue the business keeps from this person after their pay (O). */
  yearlyBusinessRevenue: number;
  /** Pay as a percentage of the revenue they generate (P), null if no revenue. */
  salaryPctOfRevenue: number | null;
  /** Annual leave dollar liability accrued per week (Q). */
  leaveWeekly: number;
  /** Annual leave dollar liability per year (R). */
  leaveYearly: number;
  /** Whether this person is currently being paid on reward rather than base. */
  onReward: boolean;
  /** Whether super is included in this person's pay figures (payWeekly /
   *  yearlyPay). True for all employees; true for contractors unless the clinic
   *  has turned off super on contractors. Lets the UI state plainly whether a
   *  pay figure is inclusive of super. */
  includesSuper: boolean;
  /** Directors only: take home = yearly pay + share of business profit (M). */
  takeHomeWithDividends?: number;
  dividend?: number;
}

export interface SiteResult {
  id: string;
  name: string;
  weeklyExpenses: number;
  people: PersonResult[];
  /** Sum of base+super for everyone (F30). */
  baseSuperTotalWeekly: number;
  /** Total clients per week across the site (F31). */
  totalClientsWeekly: number;
  /** Total revenue per week (F34). */
  totalRevenueWeekly: number;
  /** Blended average spend (H30). */
  avgSpend: number;
  /** Wages excluding leave liability (W2). */
  wagesExcLeaveWeekly: number;
  /** Actual wages including leave liability (F32). */
  actualWagesWeekly: number;
  /** Total weekly cost to run the site (F33). */
  totalCostWeekly: number;
  /** Weekly profit (F35). */
  profitWeekly: number;
  /** Yearly revenue (H34). */
  revenueYearly: number;
  /** Yearly profit, accounting for non revenue weeks (H35). */
  profitYearly: number;
  /** Profit margin (H36). Null when the site has no revenue to measure against. */
  profitMargin: number | null;
  /** Profit per quarter (H37). */
  profitQuarter: number;
  /** Break even client number for a revenue generating week (F36). Null when
   *  there is no blended spend yet (no revenue), since "break even" is undefined. */
  breakevenClients: number | null;
  /** How far above (or below) break even the site currently runs, in clients.
   *  Null when break even is undefined. */
  clientsVsBreakeven: number | null;
}

export interface BusinessResult {
  clinicName: string;
  sites: SiteResult[];
  totalRevenueWeekly: number;
  totalClientsWeekly: number;
  avgSpend: number;
  profitWeekly: number;
  revenueYearly: number;
  profitYearly: number;
  profitMargin: number | null;
  profitQuarter: number;
  breakevenClients: number | null;
  /** Directors aggregated across the business, with dividends. */
  directors: {
    id: string;
    name: string;
    yearlyPay: number;
    ownershipPct: number;
    dividend: number;
    takeHome: number;
  }[];
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function safeNum(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Revenue weeks can only meaningfully be 0..52. Clamp defensively so a
 *  fat-fingered input (e.g. 53) can never make the engine and the source sheet
 *  disagree on the sign of the leave term. */
function effectiveRevenueWeeks(s: Settings): number {
  return clamp(safeNum(s.revenueWeeks), 0, 52);
}

function computePerson(p: Person, s: Settings): PersonResult {
  const revenueWeeks = effectiveRevenueWeeks(s);
  const nonRevenueWeeks = Math.max(0, 52 - revenueWeeks);
  // Guard against a legacy or partial scenario (e.g. an old share-link) that is
  // missing these fields: an undefined annualLeaveWeeks or superRate would
  // otherwise turn every downstream dollar figure into NaN.
  const leaveMultiplier = clamp(safeNum(s.annualLeaveWeeks), 0, 52) / 52;

  // Super is paid on employees always, and on contractors unless the clinic has
  // turned it off (overseas). In Australia super on contractors is the law, so
  // the default (undefined) is to include it.
  const superApplies =
    p.employmentType === "contractor" ? s.superOnContractors !== false : true;
  const superFactor = superApplies ? 1 + safeNum(s.superRate) : 1;

  const baseWeekly = safeNum(p.hoursPerWeek * p.hourlyRate);
  const baseSuperWeekly = baseWeekly * superFactor;
  const revenueWeekly = safeNum(p.avgSpend * p.clientsPerWeek);

  // Reward applies to revenue generators (therapists). Admins never earn a
  // reward; directors take a salary plus dividends rather than commission.
  const rewardEligible = p.role === "therapist";
  const rewardWeekly = rewardEligible
    ? Math.max(0, revenueWeekly * p.rewardPct * superFactor)
    : 0;

  // J: the rolling pay. Higher of base+super or reward.
  const payWeekly =
    rewardEligible && rewardWeekly > baseSuperWeekly
      ? rewardWeekly
      : baseSuperWeekly;
  const onReward = rewardEligible && rewardWeekly > baseSuperWeekly;

  const adjustedHourly = p.hoursPerWeek > 0 ? payWeekly / p.hoursPerWeek : null;

  // L: yearly pay.
  //  - Employees are paid base+super through their non revenue (leave) weeks,
  //    matching the sheet's L = J*F2 + (52-F2)*E.
  //  - Contractors are a deliberate product extension beyond the sheet: they
  //    only earn for the weeks they actually work (revenueWeeks) and accrue no
  //    paid leave, which is the legally typical AU arrangement. This is pinned
  //    by a test so the divergence from the sheet is a conscious choice.
  const yearlyPay =
    p.employmentType === "contractor"
      ? payWeekly * revenueWeeks
      : payWeekly * revenueWeeks + nonRevenueWeeks * baseSuperWeekly;

  const yearlyRevenue = revenueWeekly * revenueWeeks;
  const yearlyBusinessRevenue = yearlyRevenue - yearlyPay;
  const salaryPctOfRevenue =
    yearlyRevenue > 0 ? yearlyPay / yearlyRevenue : null;

  const leaveWeekly =
    p.employmentType === "contractor" ? 0 : leaveMultiplier * baseWeekly;
  const leaveYearly = leaveWeekly * 52;

  return {
    id: p.id,
    name: p.name,
    role: p.role,
    employmentType: p.employmentType,
    baseWeekly,
    baseSuperWeekly,
    revenueWeekly,
    rewardWeekly,
    payWeekly,
    adjustedHourly,
    yearlyPay,
    yearlyRevenue,
    yearlyBusinessRevenue,
    salaryPctOfRevenue,
    leaveWeekly,
    leaveYearly,
    onReward,
    includesSuper: superApplies,
  };
}

function computeSite(site: Site, s: Settings): SiteResult {
  const revenueWeeks = effectiveRevenueWeeks(s);
  const nonRevenueWeeks = Math.max(0, 52 - revenueWeeks);

  const people = site.people.map((p) => computePerson(p, s));

  const baseSuperTotalWeekly = people.reduce(
    (a, p) => a + p.baseSuperWeekly,
    0
  );
  const totalClientsWeekly = site.people.reduce(
    (a, p) => a + safeNum(p.clientsPerWeek),
    0
  );
  const totalRevenueWeekly = people.reduce((a, p) => a + p.revenueWeekly, 0);
  const avgSpend =
    totalClientsWeekly > 0 ? totalRevenueWeekly / totalClientsWeekly : 0;

  // W2: wages excluding leave = the actual pay of everyone (admins paid base+super,
  // therapists/directors paid their rolling J figure, which for admins equals base).
  const wagesExcLeaveWeekly = people.reduce((a, p) => a + p.payWeekly, 0);
  const leaveWeeklyTotal = people.reduce((a, p) => a + p.leaveWeekly, 0);
  const actualWagesWeekly = wagesExcLeaveWeekly + leaveWeeklyTotal;

  const totalCostWeekly = actualWagesWeekly + site.weeklyExpenses;
  const profitWeekly = totalRevenueWeekly - totalCostWeekly;

  const revenueYearly = totalRevenueWeekly * revenueWeeks;

  // W3: weekly profit excluding leave liability.
  const weeklyProfitExcLeave =
    totalRevenueWeekly - site.weeklyExpenses - wagesExcLeaveWeekly;

  // H35: yearly profit. Revenue and reward weeks run for revenueWeeks; through
  // the non revenue weeks the site still pays base+super and full expenses with
  // no revenue coming in.
  const profitYearly =
    weeklyProfitExcLeave * revenueWeeks -
    nonRevenueWeeks * site.weeklyExpenses -
    nonRevenueWeeks * baseSuperTotalWeekly;

  // When there is no revenue there is nothing to measure margin against and no
  // blended spend to break even on. Return null (honest "n/a") rather than 0,
  // which would read as "breaks even at zero clients / 0% margin" on a site
  // that is in fact losing money every week.
  const profitMargin = revenueYearly > 0 ? profitYearly / revenueYearly : null;
  const profitQuarter = profitYearly / 4;
  const breakevenClients = avgSpend > 0 ? totalCostWeekly / avgSpend : null;
  const clientsVsBreakeven =
    breakevenClients !== null ? totalClientsWeekly - breakevenClients : null;

  return {
    id: site.id,
    name: site.name,
    weeklyExpenses: site.weeklyExpenses,
    people,
    baseSuperTotalWeekly,
    totalClientsWeekly,
    totalRevenueWeekly,
    avgSpend,
    wagesExcLeaveWeekly,
    actualWagesWeekly,
    totalCostWeekly,
    profitWeekly,
    revenueYearly,
    profitYearly,
    profitMargin,
    profitQuarter,
    breakevenClients,
    clientsVsBreakeven,
  };
}

export function computeBusiness(input: BusinessInput): BusinessResult {
  const { settings } = input;
  const sites = input.sites.map((site) => computeSite(site, settings));

  const totalRevenueWeekly = sites.reduce(
    (a, s) => a + s.totalRevenueWeekly,
    0
  );
  const totalClientsWeekly = sites.reduce(
    (a, s) => a + s.totalClientsWeekly,
    0
  );
  const avgSpend =
    totalClientsWeekly > 0 ? totalRevenueWeekly / totalClientsWeekly : 0;
  const profitWeekly = sites.reduce((a, s) => a + s.profitWeekly, 0);
  const revenueYearly = sites.reduce((a, s) => a + s.revenueYearly, 0);
  const profitYearly = sites.reduce((a, s) => a + s.profitYearly, 0);
  const profitMargin = revenueYearly > 0 ? profitYearly / revenueYearly : null;
  const profitQuarter = profitYearly / 4;
  // Matches the spreadsheet: the business break even is the sum of each site's
  // break even client number (each site has its own blended spend). This is NOT
  // derivable from the business blended avgSpend above; it is the sum of
  // independent per site break evens. Sites with no revenue (null) are skipped.
  const definedBreakevens = sites
    .map((s) => s.breakevenClients)
    .filter((x): x is number => x !== null);
  const breakevenClients =
    definedBreakevens.length > 0
      ? definedBreakevens.reduce((a, b) => a + b, 0)
      : null;

  // Directors take home a salary plus a share of the profit of the site they
  // own, exactly as the sheet's M = L + (this site's H35) * ownership%. Using
  // business-total profit here would double-count when two single-site owners
  // each hold 100% of their own clinic.
  const directors: BusinessResult["directors"] = [];
  for (const site of input.sites) {
    const sr = sites.find((x) => x.id === site.id)!;
    // A site can never pay out more than 100% of its profit in dividends. If the
    // owners' shares sum to over 100% (a data-entry slip, e.g. two partners both
    // left at 60%), scale them down proportionally so the dividends can never
    // exceed the profit and overstate take-home. Under 100% is left as entered:
    // the remainder is simply profit the owners chose not to draw. The Your-clinic
    // header still warns when the shares do not add to 100% so the owner can fix it.
    const siteOwnershipSum = site.people.reduce(
      (a, pp) => a + (pp.role === "director" ? pp.ownershipPct ?? 0 : 0),
      0
    );
    const ownershipDivisor = Math.max(1, siteOwnershipSum);
    for (const p of site.people) {
      if (p.role !== "director") continue;
      const pr = sr.people.find((x) => x.id === p.id)!;
      const ownershipPct = p.ownershipPct ?? 0;
      const dividend = sr.profitYearly * (ownershipPct / ownershipDivisor);
      directors.push({
        id: p.id,
        name: p.name,
        yearlyPay: pr.yearlyPay,
        ownershipPct,
        dividend,
        takeHome: pr.yearlyPay + dividend,
      });
    }
  }

  // Annotate director person results with their dividend / take home.
  for (const sr of sites) {
    for (const pr of sr.people) {
      if (pr.role !== "director") continue;
      const d = directors.find((x) => x.id === pr.id);
      if (d) {
        pr.dividend = d.dividend;
        pr.takeHomeWithDividends = d.takeHome;
      }
    }
  }

  return {
    clinicName: input.clinicName,
    sites,
    totalRevenueWeekly,
    totalClientsWeekly,
    avgSpend,
    profitWeekly,
    revenueYearly,
    profitYearly,
    profitMargin,
    profitQuarter,
    breakevenClients,
    directors,
  };
}
