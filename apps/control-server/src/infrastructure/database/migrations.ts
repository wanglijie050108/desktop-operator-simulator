import type Database from "better-sqlite3";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "create_agent_and_command_tables",
    sql: `
      CREATE TABLE agents (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ONLINE', 'OFFLINE', 'PAUSED', 'BUSY')),
        capabilities_json TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        version TEXT NOT NULL,
        connected_at TEXT NOT NULL
      );

      CREATE TABLE desktop_commands (
        command_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        action TEXT NOT NULL,
        state TEXT NOT NULL
          CHECK (state IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT
      );

      CREATE INDEX desktop_commands_task_id_idx ON desktop_commands(task_id);
      CREATE INDEX desktop_commands_state_idx ON desktop_commands(state);
    `,
  },
  {
    version: 2,
    name: "create_task_tables",
    sql: `
      CREATE TABLE inbound_messages (
        id TEXT PRIMARY KEY NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('WECHAT')),
        external_message_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        content TEXT NOT NULL,
        received_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX inbound_messages_source_identity_idx
        ON inbound_messages(source, conversation_id, external_message_id);

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        short_code TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN ('AI_QUESTION', 'PRODUCT_SEARCH')),
        state TEXT NOT NULL CHECK (
          state IN (
            'RECEIVED',
            'PLANNED',
            'WAITING_FOR_INPUT',
            'RUNNING',
            'WAITING_FOR_HUMAN',
            'SUCCEEDED',
            'FAILED',
            'CANCELLED',
            'REJECTED',
            'INTERRUPTED'
          )
        ),
        request_json TEXT NOT NULL,
        result_json TEXT,
        policy_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX tasks_state_idx ON tasks(state);

      CREATE TABLE task_steps (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        name TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')
        ),
        attempt INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        artifact_refs_json TEXT NOT NULL DEFAULT '[]',
        started_at TEXT,
        finished_at TEXT
      );

      CREATE UNIQUE INDEX task_steps_task_sequence_idx
        ON task_steps(task_id, sequence);

      CREATE TABLE confirmations (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        confirmed_by TEXT NOT NULL,
        confirmed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        nonce TEXT NOT NULL UNIQUE,
        consumed_at TEXT
      );

      CREATE INDEX confirmations_task_id_idx ON confirmations(task_id);
    `,
  },
  {
    version: 3,
    name: "create_trusted_sender_table",
    sql: `
      CREATE TABLE trusted_senders (
        sender_id TEXT PRIMARY KEY NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function migrateDatabase(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const hasMigration = sqlite.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  const recordMigration = sqlite.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  const apply = sqlite.transaction((migration: Migration) => {
    sqlite.exec(migration.sql);
    recordMigration.run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (hasMigration.get(migration.version) === undefined) {
      apply(migration);
    }
  }
}
