FROM ubuntu:26.04
ARG ACT_VERSION=0.2.98
ARG ACT_SHA256=a30ba1a1582cb93810c77f743415cac33c16f60fc288116a8e0943144b6a6a4f
ARG NODE_VERSION=24.15.0
ARG YQ_VERSION=4.47.2
ARG GH_VERSION=2.103.3
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential bzip2 ca-certificates curl docker.io file git git-lfs gnupg iproute2 jq \
      libnss-myhostname locales openssh-client pkg-config procps python3 python3-pip python3-venv rsync sudo tini \
      tzdata unzip wget xz-utils zip zstd \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1 --no-same-owner \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_arm64.tar.gz" \
      | tar -xz -C /usr/local --strip-components=1 --no-same-owner \
    && curl -fsSL -o /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_arm64" \
    && chmod +x /usr/local/bin/yq \
    && curl -fsSL -o /tmp/act.tgz "https://github.com/nektos/act/releases/download/v${ACT_VERSION}/act_Linux_arm64.tar.gz" \
    && echo "${ACT_SHA256}  /tmp/act.tgz" | sha256sum -c - \
    && tar -xzf /tmp/act.tgz -C /usr/local/bin act && rm /tmp/act.tgz
RUN (userdel -r ubuntu 2>/dev/null || true) \
    && useradd --create-home --uid 1001 --shell /bin/bash --groups docker runner \
    && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner && install -d -o runner /opt/hostedtoolcache
USER runner
WORKDIR /home/runner
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
