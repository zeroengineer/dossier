#!/bin/sh
# Container entrypoint: when the workspace volume ($DOSSIER_HOME) is empty, create a workspace from the shipped
# example (like `dossier init`) and then run the command. A folder that already holds files is never touched.
# Set DOSSIER_AUTO_INIT=0 to turn the first-run copy off.
set -eu

home="${DOSSIER_HOME:-/workspace}"

if [ "${1:-}" = "dossier" ] && [ "${2:-}" = "init" ]; then
  : # an explicit `dossier init` does its own initialisation
elif [ ! -e "$home/workspace.json" ] && [ "${DOSSIER_AUTO_INIT:-1}" = "1" ]; then
  if [ -n "$(ls -A "$home" 2>/dev/null)" ]; then
    echo "dossier: $home has no workspace.json but is not empty; leaving it as it is" >&2
  elif [ -d "$home" ] && [ ! -w "$home" ]; then
    echo "dossier: $home is not writable by uid $(id -u); make the mounted folder writable by that user" >&2
    echo "         (for example: mkdir -p workspace && sudo chown $(id -u):$(id -g) workspace)" >&2
    exit 1
  else
    echo "dossier: $home is empty; creating a workspace from the shipped example" >&2
    node --no-warnings=ExperimentalWarning /app/bin/dossier.js init "$home" >&2
  fi
fi

exec "$@"
