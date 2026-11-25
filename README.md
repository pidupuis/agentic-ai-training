# agentic-ai-training

Small applications built to learn and demonstrate agentic AI: hand-written agent loops, tool calling, structured output and human-in-the-loop review, without agent frameworks.

## Apps

| App | What it does | Stack |
| --- | --- | --- |
| [Variant Copilot](apps/variant-copilot/) | An agent annotates a tumor variant from Ensembl and PubMed; an expert reviews its sourced conclusion | Python, FastAPI, OpenAI · React, TypeScript, Tailwind, shadcn/ui |

## Repository layout

```
.devcontainer/      dev container with an egress firewall (allowlisted domains only)
scripts/            repo-wide checks, e.g. check_network.sh for the firewall
apps/<name>/        one folder per app: backend/ (uv), frontend/ (Yarn workspace), docs/
```

Frontends are Yarn 4 workspaces (`apps/*/frontend`), installed once from the root with `yarn install`. Backends are independent uv projects.
