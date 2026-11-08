const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbDir = path.join(__dirname, 'data');
fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(process.env.DB_PATH || path.join(dbDir, 'cursor.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(
` 
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mata_kuliah TEXT NOT NULL,
    pengajar    TEXT NOT NULL,
    waktu       TEXT NOT NULL,
    ruang       TEXT NOT NULL,
    kode_sesi   TEXT NOT NULL,
    link_modul  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'Belum Mulai'
                CHECK (status IN ('Belum Mulai', 'Berlangsung', 'Selesai')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS attendances (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    nim          TEXT NOT NULL,
    nama         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'Check-In'
                 CHECK (status IN ('Check-In', 'Hadir Penuh')),
    checkin_at   TEXT NOT NULL,
    checkout_at  TEXT,
    UNIQUE (event_id, nim)
  );

  CREATE INDEX IF NOT EXISTS idx_att_event ON attendances(event_id);
`
);

function ensureAdmin() {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASS || 'admin123';
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!exists) {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, bcrypt.hashSync(password, 10));
  }
}

function pad(n) { return String(n).padStart(2, '0'); }
function localStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function seedDemo(reset = false) {
  if (reset) db.prepare('DELETE FROM events').run();
  const now = new Date();
  const at = (dayOffset, hour, min = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, min, 0, 0);
    return localStamp(d);
  };

const insertEvent = db.prepare(
`
  INSERT INTO events (mata_kuliah, pengajar, waktu, ruang, kode_sesi, link_modul, status)
  VALUES (@mata_kuliah, @pengajar, @waktu, @ruang, @kode_sesi, @link_modul, @status)
`
);

const insertAtt = db.prepare(
`
  INSERT INTO attendances (event_id, nim, nama, status, checkin_at, checkout_at)
  VALUES (?, ?, ?, ?, ?, ?)
`
);

const events = [
  { mata_kuliah: 'Algoritma dan Pemrograman', pengajar: 'Rizky Pratama', waktu: at(-7, 13), ruang: 'Lab Komputer 3', kode_sesi: 'ALGO2026', link_modul: 'https://example.com/modul/algoritma.pdf', status: 'Selesai' },
  { mata_kuliah: 'Basis Data', pengajar: 'Nadia Safitri', waktu: at(0, 10), ruang: 'Ruang D-401', kode_sesi: 'BASDAT26', link_modul: 'https://example.com/modul/basis-data.pdf', status: 'Berlangsung' },
  { mata_kuliah: 'Pemrograman Web Dasar', pengajar: 'Kevin Hartono', waktu: at(0, 15, 30), ruang: 'Lab Komputer 1', kode_sesi: 'WEBDAS26', link_modul: 'https://example.com/modul/web-dasar.pdf', status: 'Berlangsung' },
  { mata_kuliah: 'Struktur Data', pengajar: 'Aulia Rahman', waktu: at(3, 9), ruang: 'Ruang C-203', kode_sesi: 'STRDAT26', link_modul: 'https://example.com/modul/struktur-data.pdf', status: 'Belum Mulai' },
  { mata_kuliah: 'Jaringan Komputer', pengajar: 'Dimas Anggara', waktu: at(-3, 16), ruang: 'Ruang B-105', kode_sesi: 'JARKOM26', link_modul: 'https://example.com/modul/jarkom.pdf', status: 'Selesai' }
];

const tx = db.transaction(() => {
  const ids = events.map((e) => insertEvent.run(e).lastInsertRowid);
  const iso = (s) => new Date(s).toISOString();

  insertAtt.run(ids[0], '00000012345', 'Carlos Limanto', 'Hadir Penuh', iso(events[0].waktu), iso(events[0].waktu.replace('T13', 'T15')));
  insertAtt.run(ids[0], '00000012346', 'Dicky Darma', 'Check-In', iso(events[0].waktu), null);

  insertAtt.run(ids[1], '00000023456', 'Farrel Miko', 'Check-In', new Date().toISOString(), null);
  insertAtt.run(ids[1], '00000023457', 'Radja Pratama', 'Check-In', new Date().toISOString(), null);
  }
);
  tx();
}

function eventCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM events').get().c;
}

module.exports = { db, ensureAdmin, seedDemo, eventCount };
