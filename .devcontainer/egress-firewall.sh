#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures
IFS=$'\n\t'       # Stricter word splitting

# Domains the container may reach (subdomains included).
# Their IPs are not resolved once here: dnsmasq adds every IP it resolves for
# these domains to the "allowed-domains" ipset, so CDN IP rotation is handled.
ALLOWED_DOMAINS=(
    "pypi.org"
    "files.pythonhosted.org"
    "repo.yarnpkg.com"
    "registry.yarnpkg.com"
    "registry.npmjs.org"
    "api.anthropic.com"
    "claude.ai"
    "downloads.claude.ai"
    "platform.claude.com"
    "sentry.io"
    "statsig.com"
    "api.openai.com"
    "rest.ensembl.org"
    "eutils.ncbi.nlm.nih.gov"
    "ui.shadcn.com"
    "objects.githubusercontent.com"
    "release-assets.githubusercontent.com"
)

DNSMASQ_CONF=/run/dnsmasq-allowlist.conf
DNSMASQ_PID=/run/dnsmasq.pid
UPSTREAM_SAVE=/etc/resolv.conf.upstream

# Flush existing rules and delete existing ipsets
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
# Stop dnsmasq first: it holds a reference to the ipset
if [ -f "$DNSMASQ_PID" ]; then
    kill "$(cat "$DNSMASQ_PID")" 2>/dev/null || true
    rm -f "$DNSMASQ_PID"
fi
pkill -x dnsmasq 2>/dev/null || true
ipset destroy allowed-domains 2>/dev/null || true

# Create ipset with CIDR support
ipset create allowed-domains hash:net

# --- Local DNS resolver (dnsmasq) ---------------------------------------------
# Remember Docker's original resolver the first time; on later runs
# /etc/resolv.conf already points to 127.0.0.1.
if ! grep -q '^nameserver 127\.0\.0\.1$' /etc/resolv.conf; then
    cp /etc/resolv.conf "$UPSTREAM_SAVE"
fi
UPSTREAM_DNS=$(grep -m1 '^nameserver' "$UPSTREAM_SAVE" | awk '{print $2}')
if [ -z "$UPSTREAM_DNS" ]; then
    echo "ERROR: Failed to detect upstream DNS server"
    exit 1
fi
echo "Upstream DNS: $UPSTREAM_DNS"

{
    echo "listen-address=127.0.0.1"
    echo "bind-interfaces"
    echo "no-resolv"
    echo "no-hosts"
    echo "server=$UPSTREAM_DNS"
    # The ipset is IPv4 only: don't hand out IPv6 addresses
    echo "filter-AAAA"
    for domain in "${ALLOWED_DOMAINS[@]}"; do
        echo "ipset=/$domain/allowed-domains"
    done
} > "$DNSMASQ_CONF"

dnsmasq --conf-file="$DNSMASQ_CONF" --pid-file="$DNSMASQ_PID"
echo "dnsmasq started"

# Point the container at dnsmasq (keep search/options lines from Docker)
{
    echo "nameserver 127.0.0.1"
    grep -v '^nameserver' "$UPSTREAM_SAVE" || true
} > /etc/resolv.conf

# --- Base rules ---------------------------------------------------------------
# DNS: only dnsmasq may talk to the upstream resolver, so nothing can bypass it
# (bypassing would resolve an IP without adding it to the ipset).
iptables -A OUTPUT -d "$UPSTREAM_DNS" -p udp --dport 53 -m owner --uid-owner dnsmasq -j ACCEPT
iptables -A OUTPUT -d "$UPSTREAM_DNS" -p tcp --dport 53 -m owner --uid-owner dnsmasq -j ACCEPT
# Allow outbound SSH
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
# Allow inbound SSH responses
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
# Allow localhost (includes queries to dnsmasq on 127.0.0.1)
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# --- GitHub (published, stable CIDR ranges) -----------------------------------
echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -s https://api.github.com/meta)
if [ -z "$gh_ranges" ]; then
    echo "ERROR: Failed to fetch GitHub IP ranges"
    exit 1
fi

if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null; then
    echo "ERROR: GitHub API response missing required fields"
    exit 1
fi

echo "Processing GitHub IPs..."
while read -r cidr; do
    if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "ERROR: Invalid CIDR range from GitHub meta: $cidr"
        exit 1
    fi
    ipset -exist add allowed-domains "$cidr"
done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)

# --- Host network -------------------------------------------------------------
# Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi

HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"

iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# --- Default deny ---------------------------------------------------------------
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# First allow established connections for already approved traffic
# (also lets dnsmasq receive the upstream DNS answers)
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Then allow only specific outbound traffic to allowed domains
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# Reject everything else immediately, so blocked connections fail fast
# instead of hanging until the TCP timeout (~2 min with DROP)
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Firewall configuration complete"
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
else
    echo "Firewall verification passed - unable to reach https://example.com as expected"
fi

# Verify GitHub API access
if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://api.github.com"
    exit 1
else
    echo "Firewall verification passed - able to reach https://api.github.com as expected"
fi

# Verify a dnsmasq-managed domain (IP added to the ipset at resolution time)
if ! curl --connect-timeout 5 -o /dev/null https://ui.shadcn.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://ui.shadcn.com"
    exit 1
else
    echo "Firewall verification passed - able to reach https://ui.shadcn.com via dnsmasq"
fi
