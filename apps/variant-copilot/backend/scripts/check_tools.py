"""Smoke test for the two tools: one VEP call and one PubMed search per demo variant.

Run from backend/:   uv run python scripts/check_tools.py
Replay from cache:   OFFLINE=1 uv run python scripts/check_tools.py
Exit code is 1 if any tool fails or returns an unexpected gene/protein.
"""

import sys
from pathlib import Path

# Python puts the script's own folder (scripts/) on the import path, not backend/.
# Add backend/ so that `import app...` works when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.tools.ensembl import get_vep_annotation  # noqa: E402 (import after sys.path fix)
from app.tools.pubmed import search_pubmed  # noqa: E402
from app.variants import VARIANTS  # noqa: E402

ok = True
for v in VARIANTS:
    vep = get_vep_annotation(v.hgvs_g)
    if "error" in vep:
        print(f"FAIL  {v.id}  VEP error: {vep['error']}")
        ok = False
        continue
    d = vep["data"]
    # Compare with the expected values hard-coded in variants.py
    mismatch = d["gene_symbol"] != v.gene or d["hgvsp"] != v.protein
    ok = ok and not mismatch

    query = f'"{v.gene}"[tiab] AND "{v.protein_short}"[tiab]'
    pm = search_pubmed(query)
    count = pm["data"]["total_count"] if "data" in pm else f"error: {pm['error']}"
    ok = ok and "data" in pm

    print(
        f"{'MISMATCH' if mismatch else 'OK':8}  {v.id:15}  {d['gene_symbol']} {d['hgvsp']:12}"
        f"  gnomAD={d['gnomad_exomes_af']}  PubMed={count}"
    )

sys.exit(0 if ok else 1)
