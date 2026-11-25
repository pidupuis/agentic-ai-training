"""PubMed tool: literature search through NCBI E-utilities.

This is the most "agentic" tool: the model writes its own queries, and may run
several (variant alone, variant + Hsp90, variant + a cancer type...).
Two calls are chained: esearch finds article ids (PMIDs), efetch returns their details.
"""

import xml.etree.ElementTree as ET
from urllib.parse import quote_plus

from app.tools.cache import cached_get

SOURCE = "PubMed"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
NCBI_PAUSE = 0.4  # NCBI allows 3 requests/second without an API key
MAX_RESULTS = 10  # hard cap: every article is sent back to the LLM on each turn

# Example after completion by httpx (params are URL-encoded):
#   https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=%22BRAF%22%5Btiab%5D+AND+%22V600E%22%5Btiab%5D&retmode=json&retmax=2&sort=relevance
ESEARCH_URL = f"{EUTILS}/esearch.fcgi"

# Example after completion by httpx:
#   https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=41368991%2C22281684&retmode=xml
EFETCH_URL = f"{EUTILS}/efetch.fcgi"

# Human-facing pages, used as citations. Examples after formatting:
#   https://pubmed.ncbi.nlm.nih.gov/22281684/
#   https://pubmed.ncbi.nlm.nih.gov/?term=%22BRAF%22%5Btiab%5D+AND+%22V600E%22%5Btiab%5D
ARTICLE_URL = "https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
SEARCH_PAGE_URL = "https://pubmed.ncbi.nlm.nih.gov/?term={term}"

ABSTRACT_MAX_CHARS = 600  # keep tool results small: the LLM reasons better and costs less


def search_pubmed(query: str, max_results: int = 5) -> dict:
    """Search PubMed and return the most relevant articles with short abstracts.

    Args:
        query: PubMed query. Use [tiab] tags, e.g. '"BRAF"[tiab] AND "V600E"[tiab]':
            without tags, PubMed silently drops unknown words like "D724N".
        max_results: how many articles to fetch in detail, clamped to 1..MAX_RESULTS
            (total_count is always the full count).

    Returns:
        The common tool contract, never an exception:
        - success: {"source": "PubMed", "url": <search page>, "data": {
              "query": <as sent>,
              "translated_query": <what PubMed really searched>,
              "total_count": <int, all matches>,
              "articles": <see _parse_efetch>}}
        - failure: {"source": "PubMed", "error": "<message>"}

    Example:
        >>> d = search_pubmed('"BRAF"[tiab] AND "V600E"[tiab]', 2)["data"]
        >>> d["total_count"], d["translated_query"]
        (9000, '"BRAF"[Title/Abstract] AND "V600E"[Title/Abstract]')
    """
    try:
        # The model may send 500 or "5": clamp in code, the schema bounds are only a hint.
        max_results = max(1, min(int(max_results), MAX_RESULTS))

        # Step 1: esearch, the ids of the matching articles.
        result = cached_get(
            ESEARCH_URL,
            {
                "db": "pubmed",
                "term": query,
                "retmode": "json",
                "retmax": max_results,  # number of ids returned, not the total count
                "sort": "relevance",  # default is most recent first
            },
            pause=NCBI_PAUSE,
        )["esearchresult"]
        # Example of `result` (trimmed):
        #   {"count": "9000", "idlist": ["41368991", "22281684"],
        #    "querytranslation": "\"BRAF\"[Title/Abstract] AND \"V600E\"[Title/Abstract]"}
        pmids = result.get("idlist", [])

        # Step 2: efetch, details of those articles (only if there are any).
        articles = []
        if pmids:
            xml = cached_get(
                EFETCH_URL,
                # efetch takes a comma-separated list: "41368991,22281684"
                {"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"},
                as_json=False,  # efetch has no JSON output for PubMed
                pause=NCBI_PAUSE,
            )
            articles = _parse_efetch(xml)
    except Exception as e:  # never raise: the agent must be able to read the error
        return {"source": SOURCE, "error": str(e)}

    return {
        "source": SOURCE,
        # quote_plus encodes quotes, brackets and spaces for the URL:
        #   '"BRAF"[tiab] AND ...' -> '%22BRAF%22%5Btiab%5D+AND+...'
        "url": SEARCH_PAGE_URL.format(term=quote_plus(query)),
        "data": {
            "query": query,
            # Shows what PubMed actually searched: reveals dropped words.
            "translated_query": result.get("querytranslation", ""),
            "total_count": int(result.get("count", 0)),  # E-utilities returns numbers as strings
            "articles": articles,
        },
    }


def _parse_efetch(xml: str) -> list[dict]:
    """Turn the efetch XML (one <PubmedArticle> per PMID) into short article dicts.

    Args:
        xml: raw efetch response, as text.

    Returns:
        One dict per article: {pmid, title, journal, year, abstract, url}.
        The abstract is truncated to ABSTRACT_MAX_CHARS and may be empty.

    Example input (trimmed to the elements we read, one article shown):
        <PubmedArticleSet>
          <PubmedArticle>
            <MedlineCitation>
              <PMID Version="1">22281684</PMID>
              <Article>
                <Journal>
                  <JournalIssue><PubDate><Year>2012</Year><Month>Jan</Month></PubDate></JournalIssue>
                  <Title>Nature</Title>
                </Journal>
                <ArticleTitle>Unresponsiveness of colon cancer to BRAF(V600E) inhibition
                  through feedback activation of EGFR.</ArticleTitle>
                <Abstract>
                  <AbstractText>Inhibition of the BRAF(V600E) oncoprotein by ...</AbstractText>
                </Abstract>
              </Article>
            </MedlineCitation>
            <PubmedData>...</PubmedData>  <!-- references, ids: ignored -->
          </PubmedArticle>
        </PubmedArticleSet>

    Example output:
        [{"pmid": "22281684",
          "title": "Unresponsiveness of colon cancer to BRAF(V600E) inhibition through feedback activation of EGFR.",
          "journal": "Nature", "year": "2012",
          "abstract": "Inhibition of the BRAF(V600E) oncoprotein by ... (600 chars max)",
          "url": "https://pubmed.ncbi.nlm.nih.gov/22281684/"}]
    """
    articles = []
    # .iter() walks the whole tree and yields every matching element.
    for art in ET.fromstring(xml).iter("PubmedArticle"):
        # Paths are anchored on MedlineCitation/Article: a bare ".//PMID" or
        # ".//AbstractText" could also match the reference list or translated abstracts.
        cit = art.find("MedlineCitation")
        article = cit.find("Article")
        pmid = _text(cit.find("PMID"))

        # Structured abstracts are split into sections (Background, Methods...):
        # join them all. Some articles have no abstract at all -> "".
        abstract = " ".join(_text(a) for a in article.iterfind("Abstract/AbstractText"))

        pub_date = article.find("Journal/JournalIssue/PubDate")
        # Most dates have <Year>; some only have <MedlineDate>2011 Jan-Feb</MedlineDate>,
        # whose first 4 characters are the year.
        year = _text(pub_date.find("Year")) or _text(pub_date.find("MedlineDate"))[:4]

        articles.append({
            "pmid": pmid,
            "title": _text(article.find("ArticleTitle")),
            "journal": _text(article.find("Journal/Title")),
            "year": year,
            "abstract": abstract[:ABSTRACT_MAX_CHARS],
            "url": ARTICLE_URL.format(pmid=pmid),  # the URL the agent must cite
        })
    return articles


def _text(el: ET.Element | None) -> str:
    """All text inside an XML element, nested tags included; "" if the element is missing.

    el.text would stop at the first child tag, itertext() does not:
        <ArticleTitle><i>BRAF</i> V600E in melanoma</ArticleTitle>
        el.text                  -> None
        "".join(el.itertext())   -> "BRAF V600E in melanoma"
    """
    return "".join(el.itertext()).strip() if el is not None else ""
