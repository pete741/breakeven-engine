# @clinicmastery/breakeven-engine

The canonical Clinic Mastery rolling break even and forecasting engine, extracted
into one shared package so every Clinic Mastery property (the Rolling Break Even
tool and clinicmasterymarketing.com) computes the same numbers from one source of
truth.

Pure, deterministic, framework free. The core mechanic is the rolling reward: in
any week a practitioner is paid the higher of their base wage or their reward (a
percentage of what they bill). Every formula in `engine.ts` is reverse engineered
from Pete's MASTER COPY Break Even and Forecasting spreadsheet and validated
against it in `engine.test.ts`.

## Modules
- `engine.ts` computeBusiness, the validated break even maths and types.
- `hire.ts` forecastHire, the month by month Next Hire breakeven forecast.
- `defaults.ts` newPerson, newSite, defaultBusiness.
- `benchmarks.ts` healthy band verdicts.
- `format.ts` AU locale formatters.

## Consuming
Designed to be imported as TypeScript source and transpiled by the host bundler.
In a Next app add the package to `transpilePackages` in `next.config`.
