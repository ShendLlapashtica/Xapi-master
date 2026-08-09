-- x_user_id was only ever needed to query the official, paid X API
-- (GET /2/users/by). Listening now goes through rettiwt-api (see
-- src/listener/x-client.ts), which searches by username directly --
-- resolving a numeric id ahead of time is no longer required, and
-- shouldn't be a mandatory field blocking someone from adding an account.
-- SQLite has no ALTER COLUMN; rebuild the table.
CREATE TABLE accounts_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  handle     TEXT NOT NULL UNIQUE,
  x_user_id  TEXT UNIQUE,
  added_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
INSERT INTO accounts_new (id, handle, x_user_id, added_at)
  SELECT id, handle, x_user_id, added_at FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;
