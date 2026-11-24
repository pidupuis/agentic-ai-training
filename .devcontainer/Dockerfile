FROM mcr.microsoft.com/devcontainers/typescript-node:26

USER root

# Outils dont le pare-feu a besoin
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       iptables ipset dnsutils aggregate jq curl sudo \
    && rm -rf /var/lib/apt/lists/*

# Le script de pare-feu, et sudo limité à ce seul script
COPY egress-firewall.sh /usr/local/bin/egress-firewall.sh
RUN chmod 0755 /usr/local/bin/egress-firewall.sh \
    && rm -f /etc/sudoers.d/node \
    && echo "node ALL=(root) NOPASSWD: /usr/local/bin/egress-firewall.sh" > /etc/sudoers.d/node-firewall \
    && chmod 0440 /etc/sudoers.d/node-firewall

RUN mkdir -p /home/node/.claude && chown node:node /home/node/.claude

COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /uvx /bin/
ENV UV_LINK_MODE=copy

RUN mkdir -p /commandhistory \
    && touch /commandhistory/.zsh_history \
    && chown -R node:node /commandhistory

USER node