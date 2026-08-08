# E2B sandbox template for smoke/capability-testing Rust repos.
# Built via `e2b template build` -- see ../README.md.
FROM rust:1.83-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/user
