export const LEGACY_SCHEMA_MIGRATION = Object.freeze({
  id: "2026.08.05.001",
  checksum: "legacy-schema-bootstrap-v1",
  description: "Bazowy schemat Prestige Systems HUB",
  transactional: false
});

export const ADD_PASSWORD_CHANGED_AT_MIGRATION = Object.freeze({
  id: "2026.08.06.001",
  checksum: "add-password-changed-at-v1",
  description: "Dodaje sledzenie daty ostatniej zmiany hasla",
  transactional: true
});

export const CURRENT_SCHEMA_VERSION = ADD_PASSWORD_CHANGED_AT_MIGRATION.id;
