import { createContext, useContext } from "react";

/**
 * When the React app is accessed via a tenant's custom domain
 * (e.g. book.janesphotography.com), this context holds the resolved
 * tenant slug.  It is null on the main/platform domain.
 */
export const CustomDomainContext = createContext<string | null>(null);

/** Returns the tenant slug for the current custom domain, or null. */
export function useCustomDomainSlug(): string | null {
  return useContext(CustomDomainContext);
}
