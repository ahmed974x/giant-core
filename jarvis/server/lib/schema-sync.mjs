// ADR-173: an existing PostgreSQL database catches up with jarvis/replica/schema.sql at start. The file is split
// into statements (quotes, $$ bodies and comments kept whole), and each one is made safe to run again: tables and
// indexes with "if not exists", functions and triggers with "or replace". Nothing is dropped or rewritten, so rows
// already there stay; a table that exists keeps its columns and constraints as they are. Pure: no I/O.

// The statements of a SQL file, in order, without the comments between them.
export function sqlStatements(sql) {
  const out = [];
  let cur = "", i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") { const e = sql.indexOf("\n", i); i = e < 0 ? sql.length : e + 1; cur += "\n"; continue; }
    if (c === "'") { const e = sql.indexOf("'", i + 1); const j = e < 0 ? sql.length : e + 1; cur += sql.slice(i, j); i = j; continue; }
    if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) { const e = sql.indexOf(tag[0], i + tag[0].length); const j = e < 0 ? sql.length : e + tag[0].length; cur += sql.slice(i, j); i = j; continue; }
    }
    if (c === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// PostgreSQL's own name for an index created without one: the table, its columns and "idx", joined by "_".
// Given that name, "if not exists" finds the index a fresh database made, instead of adding a second one.
export function defaultIndexName(table, columns) {
  return [table, ...columns.split(",").map(c => c.trim().split(/\s+/)[0]), "idx"].join("_");
}

// One statement made safe to run on a database that already has it.
export function idempotent(stmt) {
  return stmt
    .replace(/^create (unique )?index on (\w+) \(([^)]*)\)/i, (m, u, t, cols) => "create " + (u || "") + "index " + defaultIndexName(t, cols) + " on " + t + " (" + cols + ")")
    .replace(/^create table (?!if not exists)/i, "create table if not exists ")
    .replace(/^create (unique )?index (?!if not exists)/i, (m, u) => "create " + (u || "") + "index if not exists ")
    .replace(/^create function /i, "create or replace function ")
    .replace(/^create trigger /i, "create or replace trigger ");
}

export function syncStatements(sql) { return sqlStatements(sql).map(idempotent); }
