const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'lol-record-indun.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  riot_game_name TEXT NOT NULL,
  riot_tag_line TEXT NOT NULL,
  display_name TEXT,
  puuid TEXT,
  current_tier TEXT,
  current_rank TEXT,
  current_lp INTEGER,
  top_champions_json TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(riot_game_name, riot_tag_line)
);

CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_date TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('bo3','bo5')),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
  winner_roster TEXT CHECK(winner_roster IN ('A','B')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS series_rosters (
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  roster TEXT NOT NULL CHECK(roster IN ('A','B')),
  player_id INTEGER NOT NULL REFERENCES players(id),
  PRIMARY KEY (series_id, player_id)
);

CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  blue_roster TEXT NOT NULL CHECK(blue_roster IN ('A','B')),
  red_roster TEXT NOT NULL CHECK(red_roster IN ('A','B')),
  winner_roster TEXT NOT NULL CHECK(winner_roster IN ('A','B')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(series_id, set_number)
);

CREATE TABLE IF NOT EXISTS set_participants (
  set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  team TEXT NOT NULL CHECK(team IN ('blue','red')),
  lane TEXT NOT NULL CHECK(lane IN ('top','jungle','mid','adc','support')),
  champion_id INTEGER NOT NULL,
  PRIMARY KEY (set_id, player_id)
);

CREATE TABLE IF NOT EXISTS set_bans (
  set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  team TEXT NOT NULL CHECK(team IN ('blue','red')),
  champion_id INTEGER NOT NULL,
  ban_order INTEGER NOT NULL,
  PRIMARY KEY (set_id, team, ban_order)
);
`);

// CREATE TABLE IF NOT EXISTS는 이미 존재하는 테이블에 새 컬럼을 추가해주지 않으므로,
// 기존 배포본에 display_name 컬럼이 없다면 여기서 보강한다.
const playerColumns = db.prepare("PRAGMA table_info(players)").all().map((c) => c.name);
if (!playerColumns.includes('display_name')) {
  db.exec('ALTER TABLE players ADD COLUMN display_name TEXT');
}

module.exports = db;
