#!/usr/bin/env bash
set -euo pipefail

SERVICE_LABEL="io.qzz.lunatv.local-service"
APPLICATION_DIR="/Applications/LunaTV Local Service"
PLIST_PATH="/Library/LaunchDaemons/${SERVICE_LABEL}.plist"
SUPPORT_DIR="/Library/Application Support/LunaTV Local Service"
LOG_DIR="/Library/Logs/LunaTV Local Service"
USER_ROOT="${HOME}/.lunatv"
SYSTEM_BINARY="${SUPPORT_DIR}/lunatv-server"
USER_BINARY="${USER_ROOT}/bin/lunatv-server"

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

if [ -f "$PLIST_PATH" ]; then
  run_as_root launchctl bootout system "$PLIST_PATH" >/dev/null 2>&1 || true
fi

pkill -f "$SYSTEM_BINARY" >/dev/null 2>&1 || true
pkill -f "$USER_BINARY" >/dev/null 2>&1 || true

run_as_root rm -f "$PLIST_PATH" || true
run_as_root rm -rf "$APPLICATION_DIR" || true
run_as_root rm -rf "$LOG_DIR" || true
run_as_root rm -rf "$SUPPORT_DIR" || true
rm -rf "$USER_ROOT"
rm -f /tmp/lunatv-server.log

if command -v pkgutil >/dev/null 2>&1; then
  while IFS= read -r package_id; do
    [ -n "$package_id" ] || continue
    run_as_root pkgutil --forget "$package_id" >/dev/null 2>&1 || true
  done < <(pkgutil --pkgs | grep '^io\.qzz\.lunatv\.local-service\.mac-') || true
fi

echo "LunaTV local service uninstalled."
echo "Refresh LunaTV in your browser to use the default route."
