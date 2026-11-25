from dataclasses import dataclass

@dataclass(frozen=True)
class Variant:
    id: str
    gene: str
    protein: str  # HGVS protein notation, e.g. p.Val600Glu
    protein_short: str  # one-letter form, e.g. V600E
    chrom: str
    pos: int  # GRCh38
    ref: str
    alt: str

    @property
    def hgvs_g(self) -> str:
        """Genomic HGVS notation, the input format of Ensembl VEP."""
        return f"{self.chrom}:g.{self.pos}{self.ref}>{self.alt}"


VARIANTS = [
    Variant("braf-v600e", "BRAF", "p.Val600Glu", "V600E", "7", 140753336, "A", "T"),
    Variant("egfr-l858r", "EGFR", "p.Leu858Arg", "L858R", "7", 55191822, "T", "G"),
    Variant("hsp90aa1-d724n", "HSP90AA1", "p.Asp724Asn", "D724N", "14", 102081741, "C", "T"),
]

VARIANTS_BY_ID = {v.id: v for v in VARIANTS}