import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { migrateDatabase } from "./migrations.js";
import { databaseSchema } from "./schema.js";

export interface DatabaseContext {
  db: BetterSQLite3Database<typeof databaseSchema>;
  close: () => void;
}

export function openDatabase(databasePath: string): DatabaseContext {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (databasePath !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  migrateDatabase(sqlite);

  return {
    db: drizzle(sqlite, { schema: databaseSchema }),
    close: () => {
      sqlite.close();
    },
  };
}
