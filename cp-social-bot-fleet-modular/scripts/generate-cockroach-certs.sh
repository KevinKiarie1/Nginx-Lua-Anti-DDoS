#!/bin/sh
set -eu

CERTS_DIR="${1:-ops/cockroach/certs}"
IMAGE="${COCKROACH_IMAGE:-cockroachdb/cockroach:v23.2.0}"

mkdir -p "${CERTS_DIR}"
rm -f "${CERTS_DIR}"/*.crt "${CERTS_DIR}"/*.key

docker run --rm -v "${PWD}/${CERTS_DIR}:/cockroach/certs" "${IMAGE}" \
  cert create-ca --certs-dir=/cockroach/certs --ca-key=/cockroach/certs/ca.key

docker run --rm -v "${PWD}/${CERTS_DIR}:/cockroach/certs" "${IMAGE}" \
  cert create-node localhost 127.0.0.1 host.docker.internal cockroach1 cockroach2 cockroach3 \
  --certs-dir=/cockroach/certs --ca-key=/cockroach/certs/ca.key

docker run --rm -v "${PWD}/${CERTS_DIR}:/cockroach/certs" "${IMAGE}" \
  cert create-client root --certs-dir=/cockroach/certs --ca-key=/cockroach/certs/ca.key

echo "CockroachDB certificates written to ${CERTS_DIR}"