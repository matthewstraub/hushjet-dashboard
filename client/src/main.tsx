import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Query Error]", event.query.state.error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Mutation Error]", event.mutation.state.error);
  }
});

const linkOptions = {
  url: "/api/trpc",
  transformer: superjson,
  async fetch(input: RequestInfo | URL, init?: RequestInit) {
    const response = await globalThis.fetch(input, {
      ...(init ?? {}),
      credentials: "include",
    });
    // The server answers 401 once a session expires; send the browser back
    // through sign-in instead of leaving the page full of failed queries.
    if (response.status === 401) {
      const here = window.location.pathname + window.location.search;
      window.location.assign(`/login?next=${encodeURIComponent(here)}`);
    }
    return response;
  },
};

const UNBATCHED = new Set([
  "readings.live",
  "readings.refresh",
  "readings.history",
  "readings.daily",
]);

const trpcClient = trpc.createClient({
  links: [
    // A batch is answered only when every call in it is done. These can take
    // a few seconds through Dyson's cloud (a live read, or copying Dyson's
    // newest history first), so they travel alone and never hold up the rest
    // of the page.
    splitLink({
      condition: op => UNBATCHED.has(op.path),
      true: httpLink(linkOptions),
      false: httpBatchLink(linkOptions),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
