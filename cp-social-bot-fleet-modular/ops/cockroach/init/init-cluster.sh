#!/bin/sh
set -eu

HOST="${COCKROACH_INIT_HOST:-cockroach1:26257}"
CERTS_DIR="${COCKROACH_CERTS_DIR:-/cockroach/certs}"

: "${COCKROACH_DATABASE:?COCKROACH_DATABASE is required}"
: "${COCKROACH_APP_USER:?COCKROACH_APP_USER is required}"
: "${COCKROACH_APP_PASSWORD:?COCKROACH_APP_PASSWORD is required}"

echo "Waiting for CockroachDB cluster initialization on ${HOST}..."
while true; do
  if output=$(cockroach init --certs-dir="${CERTS_DIR}" --host="${HOST}" 2>&1); then
    echo "CockroachDB cluster initialized"
    break
  fi

  case "${output}" in
    *"cluster has already been initialized"*)
      echo "CockroachDB cluster already initialized"
      break
      ;;
    *)
      echo "Cluster init not ready yet; retrying in 2s"
      sleep 2
      ;;
  esac
done

until cockroach sql --certs-dir="${CERTS_DIR}" --host="${HOST}" -e "SELECT 1" >/dev/null 2>&1; do
  echo "Waiting for SQL endpoint on ${HOST}..."
  sleep 2
done

APP_PASSWORD_ESCAPED=$(printf "%s" "${COCKROACH_APP_PASSWORD}" | sed "s/'/''/g")

cockroach sql --certs-dir="${CERTS_DIR}" --host="${HOST}" <<SQL
CREATE DATABASE IF NOT EXISTS ${COCKROACH_DATABASE};
CREATE USER IF NOT EXISTS ${COCKROACH_APP_USER};
ALTER USER ${COCKROACH_APP_USER} WITH PASSWORD '${APP_PASSWORD_ESCAPED}';
GRANT ALL ON DATABASE ${COCKROACH_DATABASE} TO ${COCKROACH_APP_USER};
GRANT ALL ON SCHEMA ${COCKROACH_DATABASE}.public TO ${COCKROACH_APP_USER};
SQL

echo "Bootstrap SQL completed"