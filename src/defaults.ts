import type { BusinessInput, Person, Role, EmploymentType, Site } from "./engine";

// A small, realistic starter so the dashboard is alive the moment it loads.
// Numbers are illustrative, not any real clinic.

let counter = 0;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${counter}_${Math.round(performanceNow())}`;
}

// Avoid Date.now / Math.random at module scope (keeps SSR + tests stable enough);
// a monotonic-ish seed is plenty for local ids.
function performanceNow(): number {
  if (typeof performance !== "undefined" && performance.now) {
    return Math.floor(performance.now() * 1000) % 1_000_000;
  }
  return counter * 7919;
}

export function newPerson(role: Role, overrides: Partial<Person> = {}): Person {
  const base: Record<Role, Partial<Person>> = {
    admin: { hourlyRate: 32, hoursPerWeek: 30, rewardPct: 0 },
    therapist: { hourlyRate: 38, hoursPerWeek: 38, rewardPct: 0.4, avgSpend: 105, clientsPerWeek: 42 },
    director: { hourlyRate: 55, hoursPerWeek: 38, rewardPct: 0, avgSpend: 110, clientsPerWeek: 0, ownershipPct: 1 },
  };
  return {
    id: uid("p"),
    name: "",
    role,
    employmentType: "employee" as EmploymentType,
    hourlyRate: 0,
    hoursPerWeek: 0,
    rewardPct: 0,
    avgSpend: 0,
    clientsPerWeek: 0,
    ...base[role],
    ...overrides,
  };
}

export function newSite(name: string, overrides: Partial<Site> = {}): Site {
  return {
    id: uid("s"),
    name,
    weeklyExpenses: 3000,
    people: [],
    ...overrides,
  };
}

export function defaultBusiness(): BusinessInput {
  // A healthy, profitable clinic out of the box (around $130k profit a year), so
  // the tool opens on a clinic that is working, not one bleeding money.
  return {
    clinicName: "Your Clinic",
    settings: {
      superRate: 0.12,
      revenueWeeks: 46,
      annualLeaveWeeks: 4,
      superOnContractors: true,
      fullTimeClientLoad: 45,
      revenueMode: "clients",
    },
    sites: [
      {
        id: uid("s"),
        name: "Main Clinic",
        weeklyExpenses: 3800,
        people: [
          newPerson("director", { name: "You", hourlyRate: 60, hoursPerWeek: 38, avgSpend: 120, clientsPerWeek: 22, ownershipPct: 1 }),
          newPerson("admin", { name: "Front desk", hourlyRate: 33, hoursPerWeek: 38 }),
          newPerson("admin", { name: "Admin support", hourlyRate: 32, hoursPerWeek: 30 }),
          newPerson("therapist", { name: "Therapist 1", hourlyRate: 42, hoursPerWeek: 38, rewardPct: 0.4, avgSpend: 115, clientsPerWeek: 48 }),
          newPerson("therapist", { name: "Therapist 2", hourlyRate: 40, hoursPerWeek: 38, rewardPct: 0.4, avgSpend: 110, clientsPerWeek: 46 }),
          newPerson("therapist", { name: "Therapist 3", hourlyRate: 40, hoursPerWeek: 38, rewardPct: 0.4, avgSpend: 110, clientsPerWeek: 44 }),
          newPerson("therapist", { name: "Therapist 4", hourlyRate: 38, hoursPerWeek: 38, rewardPct: 0.4, avgSpend: 108, clientsPerWeek: 42 }),
        ],
      },
    ],
  };
}
