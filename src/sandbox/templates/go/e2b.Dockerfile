# E2B sandbox template for smoke/capability-testing Go repos.
# Built via `e2b template build` -- see ../README.md.
FROM golang:1.23-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/user
