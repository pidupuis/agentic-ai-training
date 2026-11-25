import { cn } from "@/lib/utils";
import type { Variant } from "@/types";
import type { Run } from "@/useAgentStream";

/**
 * Left column: one button per variant; the selected one is highlighted.
 *
 * Shows only facts that describe the variant itself (gene, protein, genomic HGVS),
 * never a hint of the expected answer, so the expert's judgment is not biased.
 * A small status shows which variants were analyzed in this session.
 */
export function VariantList({
  variants,
  selectedId,
  runs,
  onSelect,
}: {
  variants: Variant[];
  selectedId: string | null;
  runs: Record<string, Run>;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="space-y-1">
      {variants.map((v) => {
        const status = runs[v.id]?.status; // undefined = never analyzed
        return (
          <li key={v.id}>
            <button
              onClick={() => onSelect(v.id)}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left hover:bg-muted",
                v.id === selectedId && "bg-muted",
              )}
            >
              <div className="flex items-center justify-between font-medium">
                <span>
                  {v.gene} {v.protein_short}
                </span>
                {status === "running" && (
                  <span className="text-xs text-muted-foreground">running…</span>
                )}
                {status === "done" && (
                  <span className="text-xs text-muted-foreground">analyzed</span>
                )}
                {status === "error" && <span className="text-xs text-destructive">failed</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {v.protein} · {v.hgvs_g}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
