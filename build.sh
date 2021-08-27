#!/usr/bin/env bash
cd "$(dirname "$0")"
docker buildx build --push --tag willhn/gh-updater:$1 .
