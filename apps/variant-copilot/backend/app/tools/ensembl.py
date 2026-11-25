from app.tools.cache import cached_get

SOURCE = "Ensembl VEP"
VEP_URL = "https://rest.ensembl.org/vep/human/hgvs/{hgvs}"


def get_vep_annotation(hgvs_g: str) -> dict:
    """Predicted effect of a genomic variant on the canonical transcript."""
    chrom, rest = hgvs_g.split(":g.")
    pos = "".join(c for c in rest if c.isdigit())
    alt = hgvs_g[-1]
    url = f"https://www.ensembl.org/Homo_sapiens/Location/View?r={chrom}:{pos}-{pos}"

    try:
        body = cached_get(
            VEP_URL.format(hgvs=hgvs_g),
            {"canonical": 1, "hgvs": 1, "content-type": "application/json"},
        )
    except Exception as e:  # never raise: the agent must read the error
        return {"source": SOURCE, "error": str(e)}

    hit = body[0]
    # canonical AND with a protein change (skips antisense genes like EGFR-AS1)
    tx = next(
        (t for t in hit.get("transcript_consequences", [])
         if t.get("canonical") == 1 and t.get("hgvsp")),
        None,
    )
    if tx is None:
        return {"source": SOURCE, "error": "No canonical protein-coding transcript"}

    known_ids, gnomad_af = [], None
    for cv in hit.get("colocated_variants", []):
        known_ids.append(cv["id"])
        freq = cv.get("frequencies", {}).get(alt, {}).get("gnomade")
        if freq is not None:
            gnomad_af = freq

    return {
        "source": SOURCE,
        "url": url,
        "data": {
            "most_severe_consequence": hit["most_severe_consequence"],
            "gene_symbol": tx["gene_symbol"],
            "transcript_id": tx["transcript_id"],
            "consequence_terms": tx["consequence_terms"],
            "hgvsp": tx["hgvsp"].split(":")[-1],
            "protein_start": tx.get("protein_start"),
            "sift_prediction": tx.get("sift_prediction"),
            "polyphen_prediction": tx.get("polyphen_prediction"),
            "known_ids": known_ids,  # rs… = dbSNP, COSV… = COSMIC
            "gnomad_exomes_af": gnomad_af,
        },
    }