# CockroachDB TLS Assets

This directory is intentionally empty in source control. Production certificate material is generated locally by [scripts/generate-cockroach-certs.sh](../../../scripts/generate-cockroach-certs.sh).

Expected files:

- `ca.crt`
- `ca.key`
- `client.root.crt`
- `client.root.key`
- `node.crt`
- `node.key`

Do not commit generated `.crt` or `.key` files.
