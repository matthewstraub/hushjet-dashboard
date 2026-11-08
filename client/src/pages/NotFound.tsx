import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CircleHelp } from "lucide-react";
import { useLocation } from "wouter";

/** Any address the dashboard doesn't have, in the same theme as the rest of the site. */
export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 py-8 text-center">
          <CircleHelp className="mx-auto size-10 text-muted-foreground" aria-hidden />
          <h1 className="text-4xl font-light">404</h1>
          <p className="text-muted-foreground">There's no page at this address.</p>
          <Button onClick={() => setLocation("/")}>Go to the dashboard</Button>
        </CardContent>
      </Card>
    </div>
  );
}
