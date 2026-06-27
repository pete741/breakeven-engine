import type { BusinessResult, BusinessInput, RevenueMode } from "./engine";
import { computeBusiness, fullTimeLoad, revenueMode } from "./engine";

// Benchmarks for healthy allied health clinics. These are sensible cross
// discipline ranges Pete coaches to; they are framed as Clinic Mastery
// guidance, not a guarantee, and are deliberately broad because a long
// appointment clinic and a high volume clinic look very different. Swap the
// numbers here if the fleet data says otherwise.

export type BenchVerdict = "strong" | "healthy" | "watch" | "below";

export interface Benchmark {
  key: string;
  label: string;
  /** The clinic's own figure, formatted. */
  value: number | null;
  /** A healthy target band. */
  low: number;
  high: number;
  /** Higher is better (margin) vs lower is better (wages share). */
  goodIsHigh: boolean;
  format: "percent" | "currency" | "number";
  verdict: BenchVerdict;
  /** Pete voice read on where they sit. */
  note: string;
  /** Where the bar sits 0..1 across a plotted range for the gauge. */
  plotMin: number;
  plotMax: number;
}

function verdictFor(
  value: number,
  low: number,
  high: number,
  goodIsHigh: boolean
): BenchVerdict {
  if (goodIsHigh) {
    if (value >= high) return "strong";
    if (value >= low) return "healthy";
    if (value >= low * 0.7) return "watch";
    return "below";
  }
  // lower is better
  if (value <= low) return "strong";
  if (value <= high) return "healthy";
  if (value <= high * 1.15) return "watch";
  return "below";
}

export function buildBenchmarks(input: BusinessInput): Benchmark[] {
  const r: BusinessResult = computeBusiness(input);
  const load = fullTimeLoad(input.settings);
  const mode: RevenueMode = revenueMode(input.settings);

  // Team wages as a share of revenue. We count the team the owner pays
  // (therapists + admin), NOT the owner's own clinical drawings, so an
  // owner-operator who still treats is not penalised for paying themselves.
  // yearlyPay already includes each person's leave-week cost.
  const wagesAnnual = r.sites.reduce(
    (a, s) =>
      a +
      s.people
        .filter((p) => p.role !== "director")
        .reduce((b, p) => b + p.yearlyPay, 0),
    0
  );
  const wagesShare = r.revenueYearly > 0 ? wagesAnnual / r.revenueYearly : null;

  // Clients per full time equivalent therapist, against the clinic's own full load.
  const therapistClients = input.sites.reduce(
    (a, s) =>
      a +
      s.people
        .filter((p) => p.role === "therapist")
        .reduce((b, p) => b + (p.clientsPerWeek || 0), 0),
    0
  );
  const therapistCount = input.sites.reduce(
    (a, s) => a + s.people.filter((p) => p.role === "therapist").length,
    0
  );
  const clientsPerTherapist = therapistCount > 0 ? therapistClients / therapistCount : null;

  const out: Benchmark[] = [];

  // Profit margin: realistic allied health runs ~10 to 20% net (broader teams
  // and multidisciplinary clinics sit thinner). Strong is 20%+.
  {
    const v = r.profitMargin === null ? null : r.profitMargin;
    const low = 0.1, high = 0.2;
    const verdict = v === null ? "watch" : verdictFor(v, low, high, true);
    out.push({
      key: "margin",
      label: "Profit margin",
      value: v,
      low,
      high,
      goodIsHigh: true,
      format: "percent",
      verdict,
      plotMin: -0.1,
      plotMax: 0.4,
      note:
        v === null
          ? "Add some revenue and your margin shows up here."
          : verdict === "strong"
            ? "That is a genuinely strong margin. Protect it as you grow."
            : verdict === "healthy"
              ? "A healthy margin for an allied health clinic. You are running this well."
              : verdict === "watch"
                ? "A little under where we like to see a clinic sit. Usually it is pricing or one too many quiet diaries."
                : "This is the one to work on first. A clinic this far under is leaving its own pay on the table.",
    });
  }

  // Average spend per visit: cross allied health good is ~$65 to $120. This
  // band is per VISIT, so it only makes sense in clients mode. In billable-hours
  // mode the same field is dollars per billable hour, which has no equivalent
  // fixed band, so we omit this card rather than show a false verdict (the
  // per-hour figure still appears on the Dashboard and Your clinic).
  if (mode !== "billable") {
    const v = r.avgSpend > 0 ? r.avgSpend : null;
    const low = 65, high = 120;
    const verdict = v === null ? "watch" : verdictFor(v, low, high, true);
    out.push({
      key: "avgspend",
      label: "Average spend a visit",
      value: v,
      low,
      high,
      goodIsHigh: true,
      format: "currency",
      verdict,
      plotMin: 40,
      plotMax: 160,
      note:
        v === null
          ? "Set what a client spends per visit to see this."
          : verdict === "strong"
            ? "Your clients are spending well. That usually means good clinical packaging and follow up."
            : verdict === "healthy"
              ? "A solid average spend for allied health."
              : verdict === "watch"
                ? "On the lighter side. A small lift here flows straight to profit."
                : "Low. Worth looking at your fees and how care plans are presented.",
    });
  }

  // Clients per full time therapist, judged against the clinic's own full load.
  {
    const v = clientsPerTherapist;
    const low = load * 0.8, high = load;
    const verdict = v === null ? "watch" : verdictFor(v, low, high, true);
    out.push({
      key: "load",
      label: mode === "billable" ? "Billable hrs a week per therapist" : "Clients a week per therapist",
      value: v,
      low,
      high,
      goodIsHigh: true,
      format: "number",
      verdict,
      plotMin: 0,
      plotMax: load * 1.3,
      note:
        v === null
          ? "Add therapists and their books to see how full the team runs."
          : verdict === "strong"
            ? `Your team is running close to a full book against the ${Math.round(load)} a week you call full. Time to be lining up the next hire.`
            : verdict === "healthy"
              ? "A good, sustainable load for the team."
              : verdict === "watch"
                ? "There is real headroom in the diaries. Filling it is the cheapest growth you have."
                : "The diaries are light. Marketing and rebooking are the levers before you ever hire.",
    });
  }

  // Team wages as a share of revenue: with therapists on a 40%+ reward this
  // realistically runs ~40 to 60% before it is worth a look. Lower is better.
  {
    const v = wagesShare;
    const low = 0.4, high = 0.6;
    const verdict = v === null ? "watch" : verdictFor(v, low, high, false);
    out.push({
      key: "wages",
      label: "Team wages as a share of revenue",
      value: v,
      low,
      high,
      goodIsHigh: false,
      format: "percent",
      verdict,
      plotMin: 0.25,
      plotMax: 0.8,
      note:
        v === null
          ? "This appears once you have revenue coming in."
          : verdict === "strong"
            ? "Lean on wages relative to revenue. Just make sure the team still feels well looked after."
            : verdict === "healthy"
              ? "Wages sit in a healthy band against revenue."
              : verdict === "watch"
                ? "Wages are creeping up as a share of revenue. Often it is diaries not full enough for the team you carry."
                : "Wages are heavy against revenue. Either the books need filling or the model needs a look.",
    });
  }

  return out;
}
