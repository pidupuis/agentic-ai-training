import { toSteps } from "@/lib/steps";
import type { AgentEvent } from "@/types";

/** A PubMed article as returned by the search_pubmed tool (backend/app/tools/pubmed.py). */
export type Article = { pmid: string; title: string; journal: string; year: string; url: string };

/** A PubMed search that found nothing: the query as sent, and its search page. */
export type EmptySearch = { query: string; url: string };

/**
 * What the PubMed tool really returned during a run, read from the trace rather than
 * from the agent's own wording:
 * - `articles`: every article returned, by url, to show its PMID, year and journal next
 *   to the claim that cites it;
 * - `emptySearches`: the searches with 0 results. An absence of evidence is not
 *   evidence, so these are shown apart from the evidence list.
 *
 * Example, for a run with one search that found nothing:
 *   { articles: Map {}, emptySearches: [{ query: '"HSP90AA1"[tiab] AND "D724N"[tiab]',
 *     url: "https://pubmed.ncbi.nlm.nih.gov/?term=%22HSP90AA1%22..." }] }
 */
export function pubmedResults(events: AgentEvent[]) {
  const articles = new Map<string, Article>();
  const emptySearches: EmptySearch[] = [];
  for (const { call, result } of toSteps(events)) {
    const r = result?.result;
    if (call.tool !== "search_pubmed" || !r?.data) continue;
    const data = r.data as { query?: string; total_count?: number; articles?: Article[] };
    for (const a of data.articles ?? []) articles.set(a.url, a);
    if (data.total_count === 0) emptySearches.push({ query: data.query ?? "", url: r.url });
  }
  return { articles, emptySearches };
}
