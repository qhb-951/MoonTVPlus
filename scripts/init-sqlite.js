const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

// SHA-256 加密密码（与 Redis 保持一致）
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function getSqliteDbPath() {
  return process.env.SQLITE_DB_PATH || path.join(process.cwd(), '.data', 'moontv.db');
}

function ensureDataDir(dbPath) {
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function configureDatabase(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

function columnExists(db, tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function migrationAlreadySatisfied(db, file) {
  if (file === '003_add_new_episodes_to_play_records.sql') {
    return columnExists(db, 'play_records', 'new_episodes');
  }

  if (file === '004_add_tvbox_subscribe_token.sql') {
    return columnExists(db, 'users', 'tvbox_subscribe_token');
  }

  return false;
}

function markMigrationApplied(db, file) {
  db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (filename, applied_at) VALUES (?, ?)'
  ).run(file, Date.now());
}

function runMigrations(db) {
  ensureMigrationTable(db);

  const applied = new Set(
    db.prepare('SELECT filename FROM schema_migrations ORDER BY filename ASC')
      .all()
      .map((row) => row.filename)
  );

  const migrationFiles = getMigrationFiles();

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }

    if (migrationAlreadySatisfied(db, file)) {
      console.log(`⏭️ Migration already satisfied, marking as applied: ${file}`);
      markMigrationApplied(db, file);
      continue;
    }

    const migrationPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log(`▶️ Applying migration: ${file}`);

    const transaction = db.transaction(() => {
      db.exec(sql);
      markMigrationApplied(db, file);
    });

    transaction();
    console.log(`✅ Migration applied: ${file}`);
  }
}

function ensureDefaultAdmin(db) {
  const username = process.env.USERNAME || 'admin';
  const password = process.env.PASSWORD || '123456789';
  const passwordHash = hashPassword(password);

  const existingUser = db
    .prepare('SELECT username FROM users WHERE username = ? LIMIT 1')
    .get(username);

  if (existingUser) {
    console.log(`ℹ️ Admin user already exists: ${username}`);
    return;
  }

  db.prepare(`
    INSERT INTO users (
      username, password_hash, role, created_at,
      playrecord_migrated, favorite_migrated, skip_migrated
    )
    VALUES (?, ?, 'owner', ?, 1, 1, 1)
  `).run(username, passwordHash, Date.now());

  console.log(`✅ Default admin user created: ${username}`);
}

function initSQLiteDatabase() {
  const dbPath = getSqliteDbPath();
  ensureDataDir(dbPath);

  let db;
  try {
    db = new Database(dbPath);
  } catch (error) {
    if (error && typeof error.message === 'string' && error.message.includes('Could not locate the bindings file')) {
      console.error('❌ better-sqlite3 native binding is missing or incompatible with current Node.js runtime.');
      console.error('💡 Please run: pnpm rebuild better-sqlite3');
      console.error('💡 If you recently changed Node.js version, reinstall dependencies or rebuild native modules.');
    }
    throw error;
  }
  configureDatabase(db);

  console.log('📦 Initializing SQLite database...');
  console.log('📍 Database location:', dbPath);

  try {
    runMigrations(db);
    ensureDefaultAdmin(db);
  } finally {
    db.close();
  }

  console.log('🎉 SQLite database is ready!');
}

module.exports = {
  initSQLiteDatabase,
  getSqliteDbPath,
};

if (require.main === module) {
  try {
    initSQLiteDatabase();
  } catch (err) {
    console.error('❌ SQLite initialization failed:', err);
    process.exit(1);
  }
}
