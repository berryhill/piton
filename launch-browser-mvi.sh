#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$REPOSITORY_ROOT"

PNPM_VERSION=$(pnpm --version)
if [ "$PNPM_VERSION" != "11.1.3" ]; then
  printf '%s\n' "Piton browser MVI requires pnpm 11.1.3 (found $PNPM_VERSION)." >&2
  exit 2
fi

pnpm install --frozen-lockfile
exec pnpm dev