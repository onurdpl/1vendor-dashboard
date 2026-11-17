FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS node20

FROM mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948

# The existing CI contract is Node 20. The official Playwright 1.60 image uses Node 24.
COPY --from=node20 /usr/local /opt/node20
ENV PATH="/opt/node20/bin:${PATH}"

# Install tools in the disposable image build, never during the proof test run.
# PGDG and Ubuntu packages are signature-checked by Apt; no TLS checks are disabled.
# Official Ubuntu instructions publish fingerprint B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8.
# https://www.postgresql.org/download/linux/ubuntu/
COPY .github/ci/pgdg-ACCC4CF8.asc /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
RUN echo '0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76  /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc' | sha256sum --check --strict \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main' \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
