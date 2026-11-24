#!/usr/bin/env bash
# Checks that the firewall lets each required domain through.
# Any HTTP status proves the request got out. 000 means blocked.
fail=0
check() {
  code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$2")
  if [ "$code" = "000" ]; then echo "BLOCKED  $1  ($2)"; fail=1
  else echo "OK $code  $1"; fi
}
check "OpenAI"         "https://api.openai.com/v1/models"
check "Ensembl VEP"    "https://rest.ensembl.org/info/ping?content-type=application/json"
check "PubMed"         "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?retmode=json"
check "PyPI"           "https://pypi.org/simple/httpx/"
check "PyPI files"     "https://files.pythonhosted.org/"
check "yarn registry"  "https://registry.yarnpkg.com/vite"
check "yarn binaries"  "https://repo.yarnpkg.com/tags"
check "npm registry"   "https://registry.npmjs.org/vite"
check "shadcn"         "https://ui.shadcn.com/"
check "GitHub"         "https://github.com"

# Counter-check: a domain outside the allowlist must be blocked.
code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' https://example.com)
if [ "$code" = "000" ]; then echo "OK       firewall active (example.com blocked)"
else echo "WARNING  example.com is reachable: is the firewall on?"; fi
exit $fail