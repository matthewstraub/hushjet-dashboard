import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface Entry {
  term: React.ReactNode;
  text: React.ReactNode;
}

const PURIFIER: Entry[] = [
  {
    term: "Fan",
    text: "Off, Auto, or a speed from 1 (quietest) to 10. In Auto, the purifier sets the speed from what its sensor measures.",
  },
  {
    term: "Night mode",
    text: "Runs the purifier more quietly, for sleep. On the HJ10 it also turns Auto off and holds the fan at speed 4, even when a schedule asks for Auto. Turning night mode off leaves Auto off.",
  },
  {
    term: "Continuous monitoring",
    text: "Keeps the sensor measuring while the fan is off. With it off, PM is only measured while the fan runs, so leave it on.",
  },
  {
    term: "Filter life",
    text: "How much life the HEPA and carbon filters have left, as a percentage the purifier reports. It counts down from 100%. The purifier's filter warning is one of the checks on the Status card.",
  },
];

const SOURCES: Entry[] = [
  {
    term: "Live reading",
    text: "Opening the dashboard asks the purifier, through Dyson's cloud, for its current state, sensor readings and fault report. It takes two or three seconds. A reading is reused for a minute, taken again every two minutes while the page is open, and on demand with Refresh. Every new reading is saved.",
  },
  {
    term: "15-minute history",
    text: "Dyson's cloud keeps 15-minute averages of PM2.5, PM10, fan speed and how long the fan ran, for the last seven days. The dashboard copies them into its own database, where they're kept, whenever the scheduled sync runs and whenever the dashboard loads (at most every 10 minutes). The charts and the daily summary come from these.",
  },
  {
    term: "Outdoor air",
    text: "Dyson also gives an hourly estimate of the outdoor air for the purifier's area: an AQI, PM2.5, PM10 and NO₂. Only the current hour is available, so an hour is saved only if a copy happens during it. Hours without one are gaps in the chart.",
  },
  {
    term: "Scheduled sync",
    text: "A GitHub Actions job is set to run every 15 minutes, copying the history and saving a reading. GitHub runs scheduled jobs irregularly, often hours apart. That's fine for the history, since every copy picks up all seven days.",
  },
  {
    term: "Status",
    text: "The fault report, Wi-Fi signal and filter life come from the purifier's own messages, and the firmware status from Dyson's device list.",
  },
  {
    term: "Schedule",
    text: "The Schedule tab reads the schedule set in the MyDyson app from Dyson's cloud, at most every five minutes. It can only be changed in the app.",
  },
  {
    term: "Controls",
    text: "Signed in with the admin password, the Controls tab sends each change to the purifier through Dyson's cloud, the way the MyDyson app does, then takes a new reading so it shows what the purifier reports. The Dashboard only shows the settings, so browsing it can't change the purifier.",
  },
  {
    term: "Notes",
    text: "Added on the Dashboard, signed in with the admin password: with Add note, or by clicking a chart at the time it happened. The charts mark each one, so a spike can be read against what was going on at home: cooking, cleaning, open windows, the heat or the air conditioning.",
  },
  {
    term: "Storage",
    text: "Readings, history and notes are saved in a TiDB database. Readings and history aren't deleted; a note stays until it's deleted. The dashboard runs on Render.",
  },
];

const TERMS: Entry[] = [
  {
    term: "PM2.5",
    text: "Particles 2.5 micrometers across or smaller, about 30 times thinner than a human hair: smoke, cooking fumes, candles, traffic. They're small enough to reach deep into the lungs, which makes PM2.5 the measure most closely tied to health.",
  },
  {
    term: "PM10",
    text: "Particles 10 micrometers or smaller. That includes all PM2.5 plus coarser dust, pollen and mold. When PM10 reads about the same as PM2.5, nearly all the particles are fine ones.",
  },
  {
    term: "µg/m³",
    text: "Micrograms per cubic meter: the weight of particles in a cubic meter of air. A microgram is a millionth of a gram. Lower is better.",
  },
  {
    term: "15-minute average",
    text: "Dyson's history keeps the average for each 15 minutes, so a short burst shows up lower than its brief peak.",
  },
  {
    term: "WHO guideline",
    text: "The World Health Organization's 2021 guideline for PM2.5 is 15 µg/m³ averaged over 24 hours, and 5 µg/m³ averaged over a year. The daily summary marks a day that averages above 15.",
  },
  {
    term: "Spike",
    text: "On this dashboard, a 15-minute average of 35 µg/m³ or more, the level of the US EPA's 24-hour standard for outdoor PM2.5. It's cleared once the 15-minute average is back under 15.",
  },
  {
    term: "AQI",
    text: (
      <>
        Air Quality Index: a 0 to 500 scale that turns pollution levels into one number and a
        plain-language band. On the US EPA's scale: 0–50 Good, 51–100 Moderate, 101–150 Unhealthy
        for sensitive groups, 151–200 Unhealthy, 201–300 Very unhealthy, and 301 and up Hazardous.
        Dyson's outdoor AQI comes with its band name, but Dyson doesn't say which scale it uses.
      </>
    ),
  },
  {
    term: "NO₂",
    text: "Nitrogen dioxide, a gas from burning fuel: traffic, gas stoves, furnaces. It's only in the outdoor figures. The HushJet doesn't measure it, and Dyson doesn't say which unit its number is in.",
  },
  {
    term: "HEPA filter",
    text: "A high-efficiency particulate air filter: a dense filter that traps fine particles, including PM2.5.",
  },
  {
    term: "Carbon filter",
    text: "Activated carbon, which is very porous and absorbs some gases and odors that pass through a HEPA filter.",
  },
  {
    term: "Fan speed",
    text: "From 1 to 10. The history shows the average speed in each 15 minutes, so it can be a fraction, like 2.5.",
  },
  {
    term: "Wi-Fi signal",
    text: "Measured in dBm (decibel-milliwatts). It's negative, and closer to zero is stronger: −60 or higher is strong, and below −70 is weak.",
  },
];

/** What the purifier is, where each number comes from, and what the terms mean. */
export default function Info() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader subtitle="How this dashboard works" />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <Section title="The purifier">
          <p className="max-w-prose text-sm leading-relaxed">
            A Dyson HushJet Purifier Compact, model HJ10. It pulls room air through two filters: a
            HEPA filter that traps fine particles, and an activated carbon filter for some gases and
            odors. A sensor inside measures the particles in the room as PM2.5 and PM10.
          </p>
          <Entries entries={PURIFIER} />
        </Section>

        <Section title="Where the data comes from">
          <p className="max-w-prose text-sm leading-relaxed">
            Everything goes through Dyson's cloud, the same way the MyDyson app works, so the
            dashboard works from anywhere, not just on your home network.
          </p>
          <Entries entries={SOURCES} />
        </Section>

        <Section title="What the terms mean">
          <Entries entries={TERMS} />
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold leading-none">{title}</h2>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}

function Entries({ entries }: { entries: Entry[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-[11rem_1fr]">
      {entries.map((entry, index) => (
        <div key={index} className="contents">
          <dt className="font-medium">{entry.term}</dt>
          <dd className="max-w-prose leading-relaxed text-muted-foreground">{entry.text}</dd>
        </div>
      ))}
    </dl>
  );
}
