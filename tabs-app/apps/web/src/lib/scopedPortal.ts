import { createContext, useContext } from "react";

// Keep settings overlays in their appearance boundary without changing body styles.
export const ScopedPortalContext = createContext<HTMLElement | undefined>(undefined);
export const useScopedPortalContainer = () => useContext(ScopedPortalContext);
