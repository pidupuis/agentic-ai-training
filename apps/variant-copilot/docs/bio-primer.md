# Bioinformatics primer

The domain knowledge behind Variant Copilot: what the data means, not how the code works (that lives in the docstrings). Each section answers a question you would ask when reading a tool result.

## From DNA to protein

A **genome** is the full DNA sequence of an organism, split into chromosomes (1–22, X, Y, and MT for mitochondria). A **gene** is a region of a chromosome that is transcribed into RNA.

A gene produces several **transcripts**: during splicing, different combinations of exons are kept. Each protein-coding transcript is translated into a **protein**, three DNA bases (a **codon**) giving one amino acid.

Ensembl gives each level its own identifier:

| Prefix | Level | Example |
| --- | --- | --- |
| `ENSG…` | gene | `ENSG00000080824` (HSP90AA1) |
| `ENST…` | transcript | `ENST00000216281` |
| `ENSP…` | protein | `ENSP00000216281` |

Because a gene has many transcripts, the same DNA change can hit amino acid 724 on one transcript, another position on a second one, and nothing at all on a non-coding one. Results are therefore always described on one reference transcript: the **canonical transcript**, nowadays the **MANE Select** transcript agreed on by Ensembl and NCBI.

**Strands.** DNA is double-stranded, and a gene can sit on either strand. When it is on the reverse strand (BRAF, for example), the base read on the transcript is the complement of the base on the genome: `A>T` on the genome becomes `T>A` on the transcript (A pairs with T, C with G).

## Reference genome and coordinates

A position only means something together with its **genome assembly**. The current human reference is **GRCh38** (also called hg38); the previous one, **GRCh37** (hg19), is still common in older papers and clinical pipelines. BRAF V600E is at 7:140753336 on GRCh38 but at 7:140453136 on GRCh37.

All coordinates in this project are GRCh38.

A **VCF** (Variant Call Format) file is the standard output of sequencing pipelines. Each variant is described by four core fields: chromosome, position, reference base (`ref`) and alternate base (`alt`). Our hard-coded variants reuse these four fields.

In Ensembl URLs, a location is a region, `chromosome:start-end`. A single-base variant starts and ends at the same position: `14:102081741-102081741`.

## HGVS nomenclature

HGVS (named after the Human Genome Variation Society) is the standard way to write a variant, so that papers, databases and clinical reports describe it identically. The prefix states the level:

| Prefix | Level | BRAF V600E | Reads as |
| --- | --- | --- | --- |
| `g.` | genome | `7:g.140753336A>T` | chromosome 7, position 140753336, A becomes T |
| `c.` | coding DNA of a transcript | `NM_004333.6:c.1799T>A` | base 1799 from the start codon, T becomes A |
| `p.` | protein | `p.Val600Glu` | amino acid 600, valine, becomes glutamate |

`V600E` is the short form of `p.Val600Glu`, with one-letter amino acid codes (V = Val, E = Glu). Scientists use it in titles and speech, so it is the form to search in PubMed. HGVS recommends three-letter codes, which are less ambiguous.

In this project, `g.` notation is the input of Ensembl VEP, and `p.` notation (`hgvsp`) comes back in its answer.

## Consequence types

The **consequence** is the predicted effect of the change on the transcript, using Sequence Ontology terms:

| Term | Meaning |
| --- | --- |
| `synonymous_variant` | the codon changes but still codes for the same amino acid |
| `missense_variant` | one amino acid is replaced by another (all three demo variants) |
| `stop_gained` (nonsense) | a codon becomes a stop codon: the protein is truncated |
| `frameshift_variant` | an insertion or deletion not divisible by 3 shifts the reading of every codon after it |
| `splice_*_variant` | the change hits an exon/intron boundary and may disturb splicing |
| `intron_variant`, `intergenic_variant` | outside coding sequence: usually no direct protein effect |

VEP returns two levels: `most_severe_consequence` is the worst effect across **all** transcripts of all overlapping genes, while `consequence_terms` is the effect on the canonical transcript only.

**Overlapping genes.** Two genes can share a region, often on opposite strands. EGFR overlaps the antisense gene EGFR-AS1, which has a canonical transcript but no protein. That is why the VEP tool keeps the canonical transcript that has a protein change (`hgvsp`).

## Reading a missense change

Not all substitutions are equal. What matters is how different the two amino acids are, and where the change sits.

HSP90AA1 p.Asp724Asn replaces aspartate (D, negatively charged) with asparagine (N, same shape, neutral). It sits 4 residues before the C-terminal **MEEVD motif**, the last five amino acids of Hsp90, which recruits TPR-domain co-chaperones such as Cyp40. Losing a charge there could plausibly affect co-chaperone binding, but nothing in the literature says so: a plausible hypothesis is not evidence.

## In silico predictions: SIFT and PolyPhen

Both predict whether an amino acid change damages the protein. They are **hints, not evidence**.

- **SIFT** looks at evolutionary conservation: if a position never changes across species, changing it is suspicious. Values: `tolerated`, `deleterious`. A `_low_confidence` suffix means the alignment had few sequences at that position, which is common near protein ends.
- **PolyPhen-2** adds structural information. Values: `benign`, `possibly_damaging`, `probably_damaging`.

Their key limitation for cancer: they predict "damaging" but cannot tell *loss* of function from *gain* of function. An oncogenic mutation like EGFR L858R does not break the protein, it makes it constantly active, yet both tools flag it as damaging.

## Population frequency: gnomAD

**gnomAD** aggregates sequencing data from hundreds of thousands of people without known severe disease. It gives the **allele frequency** (AF): the fraction of chromosomes carrying the variant. `gnomade` is the exome dataset, `gnomadg` the genome dataset.

- A **frequent** variant (AF above ~1%) is very likely benign: a harmful change would not be that common in healthy people.
- A **rare** variant (HSP90AA1 D724N: 2.2e-05, about 2 in 100,000) tells you nothing more. Rarity is not evidence of harm.
- An **absent** variant (EGFR L858R: `null`) is expected for somatic hotspots: they arise in tumors and are not inherited, so healthy people do not carry them.

## Somatic vs germline

- **Germline** variants are inherited and present in every cell of the body. This is what gnomAD measures.
- **Somatic** variants are acquired during life, here by the tumor, and are present only in tumor cells.

Tumor sequencing finds both, and separating them is part of the job. Our three variants are treated as somatic.

## Variant databases

| Identifier | Database | What it means | What it does **not** mean |
| --- | --- | --- | --- |
| `rs…` | dbSNP | the variant has been reported to dbSNP | anything about its effect |
| `COSV…` | COSMIC | the variant has been observed in at least one tumor | that it causes cancer (it may be a passenger) |
| PMID | PubMed | a unique article identifier | — |

A single change can have several COSMIC ids (EGFR L858R has two), since COSMIC keeps separate entries depending on how and where it was reported.

**Driver vs passenger.** Tumors accumulate many mutations. **Drivers** give the cell a growth advantage and push the cancer forward; **passengers** just came along. Showing which one a variant is requires literature and functional studies, not a database entry.

## Searching PubMed

PubMed indexes biomedical literature. Without field tags, its automatic term mapping **silently drops words it does not recognize**: `HSP90AA1 D724N` searches only the gene and returns ~1,500 unrelated articles. With tags, `"HSP90AA1"[tiab] AND "D724N"[tiab]` returns 0, the correct answer.

- `[tiab]` restricts a term to the title and abstract.
- The `querytranslation` field shows what PubMed actually searched: always check it.
- Articles write variants inconsistently: `V600E`, `Val600Glu`, `BRAF(V600E)`, `c.1799T>A`. A thorough search tries several forms.

## Classifying a variant

**Oncogenicity** asks: does this somatic variant drive cancer? The ClinGen/CGC/VICC standard (2022) uses five classes:

1. oncogenic
2. likely oncogenic
3. **VUS**, variant of uncertain significance
4. likely benign
5. benign

A **VUS** is an honest answer, not a failure: the evidence does not allow a decision. Calling a variant oncogenic on predictions alone is the error to avoid. This tool adds a sixth outcome, `insufficient_evidence`, for when the agent could not gather enough to apply the scale at all.

**Actionability** is a different question: is there a treatment for it? The AMP/ASCO/CAP tiers go from tier I (an approved targeted therapy exists, e.g. BRAF inhibitors for V600E melanoma) to tier IV (benign). A variant can be clearly oncogenic and still have no targeted therapy.

## Hsp90 and its clients

**Hsp90** is a molecular chaperone: it helps other proteins (its **clients**) fold and stay stable. Many mutant oncogenic kinases, including BRAF V600E and EGFR L858R, depend on it more than their normal forms do, which is why Hsp90 inhibitors were developed as cancer drugs. **HSP90AA1** is the gene coding for Hsp90α, the inducible form.

The three demo variants follow that thread: two Hsp90-dependent oncogenes with abundant literature, and one variant of Hsp90 itself with none.

## How evidence weighs

| Signal | Weight | Example in this project |
| --- | --- | --- |
| Functional studies, clinical trials in the literature | strong | thousands of BRAF V600E papers |
| Recurrence in tumors (COSMIC) | moderate, depends on counts | `COSV…` ids |
| Population frequency | strong for benign if frequent, neutral if rare | gnomAD AF |
| In silico predictions | weak | SIFT, PolyPhen |
| Biological plausibility (position, charge) | a hypothesis to test, not evidence | D724 next to MEEVD |

This is the reasoning the agent must reproduce: weak signals alone never justify an oncogenic call.
