import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";

import { variantsQuery } from "@/lib/queries";

/**
 * The first variant is open by default: the page never shows an empty state.
 * A component, not a loader: if the backend is still starting, the redirect happens as
 * soon as the variant list arrives (App shows the error meanwhile).
 */
export function FirstVariant() {
  const { data: variants } = useQuery(variantsQuery());
  const first = variants?.[0];
  return first ? (
    <Navigate to="/variants/$variantId" params={{ variantId: first.id }} replace />
  ) : null;
}
