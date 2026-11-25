FROM mcr.microsoft.com/devcontainers/typescript-node:26

USER root

# Tools the firewall needs (dnsmasq-base: the DNS resolver that fills the ipset)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       iptables ipset dnsutils dnsmasq-base aggregate jq curl sudo \
    && rm -rf /var/lib/apt/lists/*

# The firewall script, and sudo restricted to that single script
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

# Bake uv's Python into the image: ~/.local is wiped on every rebuild otherwise.
RUN uv python install 3.12
