#!/usr/bin/env bash
set -euo pipefail

SUPPORT_SCRIPT="/Library/Application Support/LunaTV Local Service/uninstall-local-service.sh"

if [ ! -f "$SUPPORT_SCRIPT" ]; then
  echo "LunaTV local service uninstall helper is missing."
  echo "Download the fallback uninstall script from the LunaTV downloads panel."
  exit 1
fi

exec "$SUPPORT_SCRIPT"
