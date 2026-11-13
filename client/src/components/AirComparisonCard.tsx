import { BandLabel } from "@/components/AirQuality";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { bandFor, bandNamed, type Pollutant } from "@/lib/airQuality";
import { clockTime, numberText, pmUnitText } from "@/lib/format";
import { trpc } from "@/lib/trpc";

const TH = "py-2 pr-4 text-left font-normal";
const TD = "py-2 pr-4 whitespace-nowrap";

export interface IndoorReading {
  takenAt: string;
  pm25: number | null;
  pm10: number | null;
  /** OFF, INIT or FAIL when the PM sensor isn't giving numbers. */
  sensorStatus: string | null;
}

/** A PM figure, with its air quality band under it. */
function PmCell({ pollutant, value, status }: { pollutant: Pollutant; value: number | null | undefined; status?: string | null }) {
  const band = bandFor(pollutant, value);
  return (
    <>
      <span className="block">{pmUnitText(value, status)}</span>
      {band && <BandLabel band={band} className="text-xs font-normal text-muted-foreground" />}
    </>
  );
}

/**
 * The purifier's latest reading beside Dyson's latest outdoor figures for
 * the area, row by row, each PM figure with its band on the MyDyson app's
 * scale. Hidden until there are outdoor figures to compare.
 */
export function AirComparisonCard({ indoor }: { indoor?: IndoorReading }) {
  const status = trpc.readings.status.useQuery(undefined, { refetchInterval: 2 * 60_000 });
  const outdoor = status.data?.outdoor;
  if (!outdoor) return null;

  const notMeasured = <span className="text-muted-foreground">Not measured</span>;
  // The MyDyson app colors an outdoor "Good" like the indoor scale's, so a band name the
  // scale shares gets its color; any other name stays plain text.
  const aqiBand = bandNamed(outdoor.aqiName);
  const rows: { key: string; label: React.ReactNode; indoors: React.ReactNode; outdoors: React.ReactNode }[] = [
    {
      key: "pm25",
      label: "PM2.5",
      indoors: <PmCell pollutant="pm25" value={indoor?.pm25} status={indoor?.sensorStatus} />,
      outdoors: <PmCell pollutant="pm25" value={outdoor.pm25} />,
    },
    {
      key: "pm10",
      label: "PM10",
      indoors: <PmCell pollutant="pm10" value={indoor?.pm10} status={indoor?.sensorStatus} />,
      outdoors: <PmCell pollutant="pm10" value={outdoor.pm10} />,
    },
    {
      key: "aqi",
      // The full name wraps onto three lines on a phone.
      label: (
        <>
          <span className="sm:hidden">AQI</span>
          <span className="hidden sm:inline">Air quality index</span>
        </>
      ),
      indoors: notMeasured,
      outdoors:
        // Not filter(Boolean): an AQI of 0 is a real value.
        outdoor.aqi === null ? (
          "–"
        ) : aqiBand ? (
          <>
            {outdoor.aqi} · <BandLabel band={aqiBand} />
          </>
        ) : outdoor.aqiName ? (
          `${outdoor.aqi} · ${outdoor.aqiName}`
        ) : (
          String(outdoor.aqi)
        ),
    },
    { key: "no2", label: "NO₂", indoors: notMeasured, outdoors: numberText(outdoor.no2) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Indoor vs. outdoor air</CardTitle>
        <CardDescription>The purifier's latest reading next to the air outside</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="align-bottom">
              <td className={TH} />
              <th scope="col" className={TH}>
                <span className="block font-medium">Indoors</span>
                <span className="block text-xs text-muted-foreground">
                  Purifier{indoor ? `, ${clockTime(indoor.takenAt)}` : ""}
                </span>
              </th>
              <th scope="col" className={`${TH} pr-0`}>
                <span className="block font-medium">Outdoors</span>
                <span className="block text-xs text-muted-foreground">
                  Dyson estimate, {clockTime(outdoor.measuredAt)}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className="border-t border-border">
                <th scope="row" className={`${TH} align-top text-muted-foreground`}>
                  {row.label}
                </th>
                <td className={`${TD} align-top font-medium`}>{row.indoors}</td>
                <td className={`${TD} pr-0 align-top font-medium`}>{row.outdoors}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          Outdoor figures are Dyson's hourly estimate for the purifier's area, as in the MyDyson
          app. Bands are on the app's air quality scale. Dyson doesn't say which unit NO₂ is in.
        </p>
      </CardContent>
    </Card>
  );
}
