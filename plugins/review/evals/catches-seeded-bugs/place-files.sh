#!/usr/bin/env bash
# Clone the seeded-bug fixture (a small Python notes library) into the run directory,
# checked out on the feature branch, with a local main branch as the review base.
set -eu
bundle="$(cd "$(dirname "$0")" && pwd)/files/tinynotes.bundle"
tmp=$(mktemp -d)
git clone -q -b feature/list-search-export "$bundle" "$tmp/repo"
git -C "$tmp/repo" branch -q main origin/main
cp -R "$tmp/repo/." .
rm -rf "$tmp"
