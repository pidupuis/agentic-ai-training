import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { AuditLog } from "@/components/AuditLog";
import { variantsQuery } from "@/lib/queries";

const route = getRouteApi("/audit");

/**
 * /audit?variant=braf-v600e,egfr-l858r: the audit trail, filtered on the variants in
 * the URL (none = all), so that a filtered view can be shared or reloaded.
 */
export function AuditPage() {
  const { variant } = route.useSearch();
  const navigate = route.useNavigate();
  const { data: variants = [] } = useQuery(variantsQuery());
  const ids = variant ? variant.split(",") : [];

  // replace: toggling a chip does not add a history entry, Back leaves the audit trail.
  const setIds = (next: string[]) =>
    navigate({ search: { variant: next.length > 0 ? next.join(",") : undefined }, replace: true });

  return (
    <main className="rounded-xl border bg-card p-5">
      <AuditLog
        variants={variants}
        variantIds={ids}
        onToggle={(id) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])}
        onShowAll={() => setIds([])}
        onOpen={(id) => navigate({ to: "/variants/$variantId", params: { variantId: id } })}
      />
    </main>
  );
}
