# E2B sandbox template for smoke/capability-testing Python repos.
# Built via `e2b template build` -- see ../README.md.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/user
