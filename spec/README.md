# spec/

The JSON Schemas in `schemas/` (draft 2020-12) are the API contract. Change them only through an ADR and a version bump in each schema's `$id`.

- **`schemas/common.schema.json`:** shared definitions: address, 32-byte hex value, signature, SHA-256 artifact hash, token amount (base units as a decimal string), scope, settlement mode.
- **`examples/*.example.json`:** one instance per schema. CI validates each example against the schema of the same name.

The examples are illustrative. Their hashes and signatures are placeholders and will not verify cryptographically. The model IDs in the judgment example are placeholders, to be replaced with pinned IDs from `config/judges.yaml`.

Validation as of October 30, 2026 (measured): all 11 examples pass under Ajv 8 (2020-12, strict mode). The schemas also reject three bad inputs:
- a fractional amount;
- a model ID containing "latest";
- an extra field in a judge verdict.

The `$id` URLs (`https://holdback.dev/schemas/v0.1/…`) are namespaces for resolving `$ref` between files. They are not hosted. Replace the domain if the project gets one.
