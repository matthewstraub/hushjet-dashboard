import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

/**
 * The purifier's latest reading beside Dyson's latest outdoor figures for
 * the area, row by row. Hidden until there are outdoor figures to compare.
 */
export function AirComparisonCard({ indoor }: { indoor?: IndoorReading }) {
  const status = trpc.readings.status.useQuery(undefined, { refetchInterval: 2 * 60_000 });
  const outdoor = status.data?.outdoor;
  if (!outdoor) return null;

  const notMeasured = <span className="text-muted-foreground">Not measured</span>;
  const rows: { key: string; label: React.ReactNode; indoors: React.ReactNode; outdoors: string }[] = [
    {
      key: "pm25",
      label: "PM2.5",
      indoors: pmUnitText(indoor?.pm25, indoor?.sensorStatus),
      outdoors: pmUnitText(outdoor.pm25),
    },
    {
      key: "pm10",
      label: "PM10",
      indoors: pmUnitText(indoor?.pm10, indoor?.sensorStatus),
      outdoors: pmUnitText(outdoor.pm10),
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
        outdoor.aqi === null ? "–" : outdoor.aqiName ? `${outdoor.aqi} · ${outdoor.aqiName}` : String(outdoor.aqi),
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
                <th scope="row" className={`${TH} text-muted-foreground`}>
                  {row.label}
                </th>
                <td className={`${TD} font-medium`}>{row.indoors}</td>
                <td className={`${TD} pr-0 font-medium`}>{row.outdoors}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          Outdoor figures are Dyson's hourly estimate for the purifier's area, as in the MyDyson
          app. Dyson doesn't say which unit NO₂ is in.
        </p>
      </CardContent>
    </Card>
  );
}
