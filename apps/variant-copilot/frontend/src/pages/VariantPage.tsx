import { getRouteApi } from "@tanstack/react-router";

import { VariantAnalysis } from "@/components/VariantAnalysis";
import { VariantList } from "@/components/VariantList";
import { useVariantRuns } from "@/useVariantRuns";

const route = getRouteApi("/variants/$variantId");

/** /variants/{id}: one card per variant, then the open variant's analysis. */
export function VariantPage() {
  const { variantId } = route.useParams();
  const { variants, runs, savedAt, reviews, start } = useVariantRuns();
  const variant = variants.find((v) => v.id === variantId);

  return (
    <>
      <VariantList variants={variants} selectedId={variantId} runs={runs} reviews={reviews} />
      {variant ? (
        <VariantAnalysis
          key={variant.id}
          variant={variant}
          run={runs[variant.id]}
          review={reviews[variant.id]}
          savedAt={savedAt[variant.id]}
          start={start}
        />
      ) : (
        // A stale or mistyped link (once the list has loaded).
        variants.length > 0 && <p className="text-muted-foreground">Unknown variant.</p>
      )}
    </>
  );
}
