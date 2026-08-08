# E2B sandbox template for smoke/capability-testing Node.js repos.
# Built via `e2b template build` -- see ../README.md. Not a Cloudflare
# Container; this Dockerfile becomes a Firecracker microVM base image.
FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/user
