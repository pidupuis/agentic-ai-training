import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { AgentStreamProvider } from "@/AgentStreamProvider";
import { queryClient } from "@/lib/queries";
import { router } from "@/router";

// AgentStreamProvider sits above the router: changing routes never closes a stream.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AgentStreamProvider>
        <RouterProvider router={router} />
      </AgentStreamProvider>
      {/* Development only: left out of the production build. */}
      <ReactQueryDevtools />
    </QueryClientProvider>
  </StrictMode>,
);
