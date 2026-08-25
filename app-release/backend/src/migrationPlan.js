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

export const ADD_AI_TICKET_COMMENT_MIGRATION = Object.freeze({
  id: "2026.08.21.001",
  checksum: "add-ai-ticket-comment-v1",
  description: "Dodaje oznaczenie komentarzy zgloszen wygenerowanych przez asystenta AI",
  transactional: true
});

export const ADD_AI_ASSISTANT_SETTINGS_MIGRATION = Object.freeze({
  id: "2026.08.23.001",
  checksum: "add-ai-assistant-settings-v1",
  description: "Dodaje ustawienia asystenta AI (automatyczna wysylka sugestii)",
  transactional: true
});

export const ADD_AI_KNOWLEDGE_BASE_MIGRATION = Object.freeze({
  id: "2026.08.23.002",
  checksum: "add-ai-knowledge-base-v1",
  description: "Dodaje baze wiedzy asystenta AI (sprzet i procedury napraw)",
  transactional: true
});

export const ADD_AI_EQUIPMENT_TYPES_MIGRATION = Object.freeze({
  id: "2026.08.23.003",
  checksum: "add-ai-equipment-types-v1",
  description: "Dodaje zarzadzana liste urzadzen dla asystenta AI i zgloszen klientow",
  transactional: true
});

export const ADD_AI_KNOWLEDGE_SOLUTION_MIGRATION = Object.freeze({
  id: "2026.08.23.004",
  checksum: "add-ai-knowledge-solution-v1",
  description: "Dodaje osobne pole rozwiazania do wpisow bazy wiedzy asystenta AI",
  transactional: true
});

export const ADD_AI_KNOWLEDGE_FILES_MIGRATION = Object.freeze({
  id: "2026.08.23.005",
  checksum: "add-ai-knowledge-files-v1",
  description: "Dodaje pliki (zdjecia, PDF) dolaczane do wpisow bazy wiedzy asystenta AI",
  transactional: true
});

export const ADD_OBJECT_EQUIPMENT_MIGRATION = Object.freeze({
  id: "2026.08.25.001",
  checksum: "add-object-equipment-v1",
  description: "Dodaje ewidencje sprzetu (marka/model) per obiekt do kontekstu asystenta AI",
  transactional: true
});

export const CURRENT_SCHEMA_VERSION = ADD_OBJECT_EQUIPMENT_MIGRATION.id;
