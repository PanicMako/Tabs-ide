import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

type RouterHistory = NonNullable<Parameters<typeof createRouter>[0]["history"]>;

export function getRouter(history: RouterHistory) {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    history,
    // Preload a route's (now code-split) chunk + data on hover/touch intent, so
    // by the time the user clicks it's already in memory — kills the "first click
    // is slow" delay for navigations without eagerly bundling every screen.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    context: {
      queryClient,
    },
    Wrap: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
