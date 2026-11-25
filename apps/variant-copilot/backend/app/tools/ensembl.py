"""Ensembl VEP tool: predicted effect of a genomic variant.

VEP (Variant Effect Predictor) maps a DNA change onto genes and transcripts
and predicts what it does to the protein. We keep only the canonical
transcript and a few fields the agent actually reasons on.
"""

from app.tools.cache import cached_get

SOURCE = "Ensembl VEP"

# Example after formatting:
#   https://rest.ensembl.org/vep/human/hgvs/14:g.102081741C>T
VEP_URL = "https://rest.ensembl.org/vep/human/hgvs/{hgvs}"

# Human-facing page for the citation (opened by the browser, not the agent).
# Example after formatting:
#   https://www.ensembl.org/Homo_sapiens/Location/View?r=14:102081741-102081741
ENSEMBL_LOCATION_URL = "https://www.ensembl.org/Homo_sapiens/Location/View?r={chrom}:{pos}-{pos}"


def get_vep_annotation(hgvs_g: str) -> dict:
    """Annotate a genomic variant with Ensembl VEP.

    Args:
        hgvs_g: genomic HGVS notation on GRCh38, e.g. "14:g.102081741C>T"
            (chromosome 14, position 102081741, reference base C, alternate base T).

    Returns:
        The common tool contract, never an exception:
        - success: {"source": "Ensembl VEP", "url": <Ensembl page>, "data": <see _parse_vep>}
        - failure: {"source": "Ensembl VEP", "error": "<message>"}

    Example:
        >>> get_vep_annotation("14:g.102081741C>T")["data"]["hgvsp"]
        'p.Asp724Asn'
    """
    # Reject malformed input with a readable error so the model can fix its call
    if ":g." not in hgvs_g:
        return {
            "source": "Ensembl VEP",
            "error": (
                f"Invalid HGVS {hgvs_g!r}: expected '<chrom>:g.<pos><ref>><alt>', "
                "e.g. '14:g.102081741C>T'"
            ),
        }
    # "14:g.102081741C>T" -> chrom "14", rest "102081741C>T"
    chrom, rest = hgvs_g.split(":g.", 1)
    # Keep only the digits of "102081741C>T" -> "102081741"
    pos = "".join(c for c in rest if c.isdigit())
    # The alternate base is the last character: "...C>T" -> "T"
    # (only valid for single-base substitutions, which is all we handle)
    alt = hgvs_g[-1]

    try:
        # Example of the full request (params are appended by httpx):
        #   https://rest.ensembl.org/vep/human/hgvs/14:g.102081741C>T?canonical=1&hgvs=1&content-type=application/json
        body = cached_get(
            VEP_URL.format(hgvs=hgvs_g),
            {
                "canonical": 1,  # flag which transcript is the canonical one
                "hgvs": 1,  # include HGVS notations (we need hgvsp)
                # Ask for JSON via a query param: same effect as the
                # "Content-Type: application/json" header, but cached_get takes no headers.
                "content-type": "application/json",
            },
        )
        data = _parse_vep(body, alt)
    except Exception as e:  # never raise: the agent must be able to read the error
        return {"source": SOURCE, "error": str(e)}

    if data is None:
        return {"source": SOURCE, "error": "No canonical protein-coding transcript"}

    return {
        "source": SOURCE,
        "url": ENSEMBL_LOCATION_URL.format(chrom=chrom, pos=pos),
        "data": data,
    }


def _parse_vep(body: list, alt: str) -> dict | None:
    """Reduce the raw VEP response (~10 KB) to the ~10 fields the agent needs.

    Args:
        body: the JSON returned by VEP, a list with one entry per input variant.
        alt: the alternate base, used to read the allele frequency of this exact change.

    Returns:
        The cleaned-up data dict, or None if no canonical transcript codes for a protein.

    Example input (trimmed to the fields we read):
        [{
          "most_severe_consequence": "missense_variant",
          "transcript_consequences": [
            {"gene_symbol": "HSP90AA1", "transcript_id": "ENST00000216281", "canonical": 1,
             "consequence_terms": ["missense_variant"],
             "hgvsp": "ENSP00000216281.8:p.Asp724Asn", "protein_start": 724,
             "sift_prediction": "deleterious_low_confidence",
             "polyphen_prediction": "possibly_damaging"},
            {"gene_symbol": "HSP90AA1", "transcript_id": "ENST00000...", ...}  # non-canonical
          ],
          "colocated_variants": [
            {"id": "COSV53488860"},
            {"id": "rs563025620",
             "frequencies": {"T": {"gnomade": 2.243e-05, "gnomadg": 6.569e-06, ...}}}
          ]
        }]

    Example output:
        {"most_severe_consequence": "missense_variant",
         "gene_symbol": "HSP90AA1", "transcript_id": "ENST00000216281",
         "consequence_terms": ["missense_variant"], "hgvsp": "p.Asp724Asn",
         "protein_start": 724,
         "sift_prediction": "deleterious_low_confidence",
         "polyphen_prediction": "possibly_damaging",
         "known_ids": ["COSV53488860", "rs563025620"],
         "gnomad_exomes_af": 2.243e-05}
    """
    # VEP returns one entry per input variant; we always send exactly one.
    hit = body[0]

    # First transcript that is canonical AND has a protein change (hgvsp).
    # The hgvsp filter skips overlapping non-coding genes, e.g. the antisense
    # gene EGFR-AS1, which is also "canonical" but has no protein.
    # next(generator, None) works like JS .find(): first match, or None.
    tx = next(
        (
            t
            for t in hit.get("transcript_consequences", [])
            if t.get("canonical") == 1 and t.get("hgvsp")
        ),
        None,
    )
    if tx is None:
        return None

    known_ids, gnomad_af = [], None
    # colocated_variants = entries of other databases at the same position:
    # "rs…" from dbSNP (the variant was reported), "COSV…" from COSMIC (seen in a tumor).
    for cv in hit.get("colocated_variants", []):
        known_ids.append(cv["id"])
        # frequencies -> {alt base} -> "gnomade" (gnomAD exomes).
        # Chained .get(..., {}) avoids a KeyError when a level is missing
        # (COSMIC entries have no frequencies at all).
        freq = cv.get("frequencies", {}).get(alt, {}).get("gnomade")
        if freq is not None:
            gnomad_af = freq

    return {
        # Worst consequence across ALL transcripts of all overlapping genes.
        "most_severe_consequence": hit["most_severe_consequence"],
        "gene_symbol": tx["gene_symbol"],
        "transcript_id": tx["transcript_id"],
        # Consequence on the canonical transcript only.
        "consequence_terms": tx["consequence_terms"],
        # "ENSP00000216281.8:p.Asp724Asn" -> "p.Asp724Asn" (drop the protein id prefix)
        "hgvsp": tx["hgvsp"].split(":")[-1],
        # .get(): these fields are absent for some consequence types.
        "protein_start": tx.get("protein_start"),
        "sift_prediction": tx.get("sift_prediction"),  # predictions, not evidence
        "polyphen_prediction": tx.get("polyphen_prediction"),
        "known_ids": known_ids,
        # None = absent from gnomAD; expected for somatic hotspots like EGFR L858R.
        "gnomad_exomes_af": gnomad_af,
    }
