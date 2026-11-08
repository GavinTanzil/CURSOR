const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { db, ensureAdmin, seedDemo, eventCount } = require('./db');

const PORT = process.env.PORT || 3000;
const STATUS = ['Belum Mulai', 'Berlangsung', 'Selesai'];

ensureAdmin();
if (eventCount() === 0 && process.env.SEED_DEMO !== 'false') seedDemo();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(
  session({
    name: 'cursor.sid',
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
  })
);

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const pad = (n) => String(n).padStart(2, '0');

app.locals.fmtWaktu = (s) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}.${pad(d.getMinutes())} WIB`;
};
app.locals.fmtTs = (iso) => {
  if (!iso) return '-';
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
};
app.locals.statusClass = (s) => ({ 'Belum Mulai': 'soon', Berlangsung: 'live', Selesai: 'done' }[s]);
app.locals.STATUS = STATUS;

app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.isAdmin = Boolean(req.session.adminId);
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const sent = Buffer.from(String(req.body?._csrf || ''));
  const real = Buffer.from(req.session.csrf);
  if (sent.length !== real.length || !crypto.timingSafeEqual(sent, real)) {
    return res.status(403).render('error', { title: 'Permintaan ditolak', message: 'Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.' });
  }
  next();
});

const flash = (req, type, msg) => { req.session.flash = { type, msg }; };

const EVENT_SELECT = `
  SELECT e.*,
    (SELECT COUNT(*) FROM attendances a WHERE a.event_id = e.id AND a.status = 'Hadir Penuh') AS hadir_penuh,
    (SELECT COUNT(*) FROM attendances a WHERE a.event_id = e.id AND a.status = 'Check-In')    AS di_kelas
  FROM events e`;
const ORDER = `ORDER BY CASE e.status WHEN 'Berlangsung' THEN 0 WHEN 'Belum Mulai' THEN 1 ELSE 2 END, e.waktu DESC`;

const getEvent = (id) => db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id));
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

app.get('/', (req, res) => {
  const q = clean(req.query.q, 100);
  const status = STATUS.includes(req.query.status) ? req.query.status : '';
  const events = db
    .prepare(`${EVENT_SELECT} WHERE (@q = '' OR e.mata_kuliah LIKE '%' || @q || '%' ESCAPE '\\') AND (@status = '' OR e.status = @status) ${ORDER}`)
    .all({ q: escapeLike(q), status });
  res.render('index', { title: 'Daftar Kelas', events, q, status });
});

// Check-In (awal kelas)
app.post('/kelas/:id/checkin', (req, res) => {
  const ev = getEvent(req.params.id);
  const back = `/#kelas-${req.params.id}`;
  if (!ev) { flash(req, 'error', 'Kelas tidak ditemukan.'); return res.redirect('/'); }

  const nama = clean(req.body.nama, 100);
  const nim = clean(req.body.nim, 20);

  if (nama.length < 3) { flash(req, 'error', 'Nama lengkap minimal 3 karakter.'); return res.redirect(back); }
  if (!/^\d{5,20}$/.test(nim)) { flash(req, 'error', 'NIM harus berupa angka (5–20 digit).'); return res.redirect(back); }
  if (ev.status === 'Selesai') { flash(req, 'error', 'Check-In gagal: kelas ini sudah selesai.'); return res.redirect(back); }
  if (ev.status !== 'Berlangsung') { flash(req, 'error', 'Check-In baru dibuka saat kelas berlangsung.'); return res.redirect(back); }

  try {
    db.prepare(`INSERT INTO attendances (event_id, nim, nama, status, checkin_at) VALUES (?, ?, ?, 'Check-In', ?)`)
      .run(ev.id, nim, nama, new Date().toISOString());
    flash(req, 'ok', `Check-In berhasil untuk ${nama}. Jangan lupa Check-Out di akhir kelas.`);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') flash(req, 'error', `NIM ${nim} sudah melakukan Check-In di kelas ini.`);
    else throw err;
  }
  res.redirect(back);
});

app.post('/kelas/:id/checkout', (req, res) => {
  const ev = getEvent(req.params.id);
  const back = `/#kelas-${req.params.id}`;
  if (!ev) { flash(req, 'error', 'Kelas tidak ditemukan.'); return res.redirect('/'); }

  const nim = clean(req.body.nim, 20);
  const kode = clean(req.body.kode_sesi, 20).toUpperCase();

  if (!nim || !kode) { flash(req, 'error', 'NIM dan Kode Sesi wajib diisi.'); return res.redirect(back); }
  if (ev.status === 'Belum Mulai') { flash(req, 'error', 'Kelas belum dimulai.'); return res.redirect(back); }
  if (kode !== ev.kode_sesi.toUpperCase()) { flash(req, 'error', 'Check-Out gagal: Kode Sesi salah.'); return res.redirect(back); }

  const att = db.prepare('SELECT * FROM attendances WHERE event_id = ? AND nim = ?').get(ev.id, nim);
  if (!att) { flash(req, 'error', `Check-Out gagal: NIM ${nim} belum melakukan Check-In di kelas ini.`); return res.redirect(back); }
  if (att.status === 'Hadir Penuh') { flash(req, 'error', `NIM ${nim} sudah Check-Out sebelumnya (Hadir Penuh).`); return res.redirect(back); }

  db.prepare(`UPDATE attendances SET status = 'Hadir Penuh', checkout_at = ? WHERE id = ? AND status = 'Check-In'`)
    .run(new Date().toISOString(), att.id);
  flash(req, 'ok', `Check-Out berhasil. ${att.nama} tercatat Hadir Penuh.`);
  res.redirect(back);
});

app.get('/kelas/:id/modul', (req, res) => {
  const ev = getEvent(req.params.id);
  if (!ev) { flash(req, 'error', 'Kelas tidak ditemukan.'); return res.redirect('/'); }
  if (ev.status !== 'Selesai') {
    flash(req, 'error', 'Modul masih terkunci. Modul terbuka setelah Admin menandai kelas Selesai.');
    return res.redirect(`/#kelas-${ev.id}`);
  }
  res.redirect(ev.link_modul);
});

const attempts = new Map();
function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  return rec && rec.count >= 5 && Date.now() < rec.until;
}

app.get('/admin/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Masuk Admin' });
});

app.post('/admin/login', (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    flash(req, 'error', 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
    return res.redirect('/admin/login');
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(clean(req.body.username, 50));
  const ok = user && bcrypt.compareSync(String(req.body.password || ''), user.password_hash);
  if (!ok) {
    const rec = attempts.get(ip) || { count: 0, until: 0 };
    rec.count += 1; rec.until = Date.now() + 15 * 60 * 1000;
    attempts.set(ip, rec);
    flash(req, 'error', 'Username atau password salah.');
    return res.redirect('/admin/login');
  }
  attempts.delete(ip);
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.adminId = user.id;
    req.session.csrf = crypto.randomBytes(24).toString('hex');
    res.redirect('/admin');
  });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

const requireAdmin = (req, res, next) => {
  if (req.session.adminId) return next();
  flash(req, 'error', 'Silakan masuk sebagai admin terlebih dahulu.');
  res.redirect('/admin/login');
};

function validateEvent(body) {
  const v = {
    mata_kuliah: clean(body.mata_kuliah, 100),
    pengajar: clean(body.pengajar, 100),
    waktu: clean(body.waktu, 16),
    ruang: clean(body.ruang, 50),
    kode_sesi: clean(body.kode_sesi, 20).toUpperCase(),
    link_modul: clean(body.link_modul, 500),
    status: STATUS.includes(body.status) ? body.status : 'Belum Mulai'
  };
  const errors = [];
  if (v.mata_kuliah.length < 3) errors.push('Nama mata kuliah minimal 3 karakter.');
  if (v.pengajar.length < 3) errors.push('Nama pengajar minimal 3 karakter.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.waktu) || Number.isNaN(new Date(v.waktu).getTime())) errors.push('Tanggal & jam tidak valid.');
  if (!v.ruang) errors.push('Ruang kelas wajib diisi.');
  if (!/^[A-Z0-9_-]{4,20}$/.test(v.kode_sesi)) errors.push('Kode sesi 4–20 karakter (huruf, angka, - atau _).');
  try {
    const u = new URL(v.link_modul);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
  } catch { errors.push('Link modul harus berupa URL http:// atau https://.'); }
  return { v, errors };
}

app.get('/admin', requireAdmin, (req, res) => {
  const events = db.prepare(`${EVENT_SELECT} ${ORDER}`).all();
  const attStmt = db.prepare('SELECT * FROM attendances WHERE event_id = ? ORDER BY checkin_at');
  events.forEach((e) => { e.peserta = attStmt.all(e.id); });
  const stats = {
    total: events.length,
    live: events.filter((e) => e.status === 'Berlangsung').length,
    done: events.filter((e) => e.status === 'Selesai').length,
    hadir: events.reduce((n, e) => n + e.hadir_penuh, 0)
  };
  res.render('admin/dashboard', { title: 'Dashboard Admin', events, stats });
});

app.get('/admin/events/new', requireAdmin, (req, res) => {
  res.render('admin/form', {
    title: 'Tambah Kelas', action: '/admin/events', errors: [],
    v: { mata_kuliah: '', pengajar: '', waktu: '', ruang: '', kode_sesi: '', link_modul: '', status: 'Belum Mulai' }, isEdit: false
  });
});

app.post('/admin/events', requireAdmin, (req, res) => {
  const { v, errors } = validateEvent(req.body);
  if (errors.length) return res.status(400).render('admin/form', { title: 'Tambah Kelas', action: '/admin/events', errors, v, isEdit: false });
  db.prepare(`INSERT INTO events (mata_kuliah, pengajar, waktu, ruang, kode_sesi, link_modul, status)
              VALUES (@mata_kuliah, @pengajar, @waktu, @ruang, @kode_sesi, @link_modul, @status)`).run(v);
  flash(req, 'ok', `Kelas "${v.mata_kuliah}" berhasil ditambahkan.`);
  res.redirect('/admin');
});

app.get('/admin/events/:id/edit', requireAdmin, (req, res) => {
  const ev = getEvent(req.params.id);
  if (!ev) return res.status(404).render('error', { title: 'Tidak ditemukan', message: 'Kelas tidak ditemukan.' });
  res.render('admin/form', { title: 'Edit Kelas', action: `/admin/events/${ev.id}`, errors: [], v: ev, isEdit: true });
});

app.post('/admin/events/:id', requireAdmin, (req, res) => {
  const ev = getEvent(req.params.id);
  if (!ev) return res.status(404).render('error', { title: 'Tidak ditemukan', message: 'Kelas tidak ditemukan.' });
  const { v, errors } = validateEvent(req.body);
  if (errors.length) return res.status(400).render('admin/form', { title: 'Edit Kelas', action: `/admin/events/${ev.id}`, errors, v, isEdit: true });
  db.prepare(`UPDATE events SET mata_kuliah=@mata_kuliah, pengajar=@pengajar, waktu=@waktu, ruang=@ruang,
              kode_sesi=@kode_sesi, link_modul=@link_modul, status=@status WHERE id=@id`).run({ ...v, id: ev.id });
  flash(req, 'ok', `Kelas "${v.mata_kuliah}" berhasil diperbarui.`);
  res.redirect('/admin');
});

app.post('/admin/events/:id/status', requireAdmin, (req, res) => {
  const ev = getEvent(req.params.id);
  if (!ev || !STATUS.includes(req.body.status)) return res.redirect('/admin');
  db.prepare('UPDATE events SET status = ? WHERE id = ?').run(req.body.status, ev.id);
  flash(req, 'ok', `Status "${ev.mata_kuliah}" diubah menjadi ${req.body.status}.`);
  res.redirect('/admin');
});

app.post('/admin/events/:id/delete', requireAdmin, (req, res) => {
  const ev = getEvent(req.params.id);
  if (ev) {
    db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
    flash(req, 'ok', `Kelas "${ev.mata_kuliah}" berhasil dihapus.`);
  }
  res.redirect('/admin');
});

app.get('/admin/events/:id/export.csv', requireAdmin, (req, res) => {
  const ev = getEvent(req.params.id);
  if (!ev) return res.redirect('/admin');
  const safe = (val) => {
    let s = String(val ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = db.prepare('SELECT * FROM attendances WHERE event_id = ? ORDER BY checkin_at').all(ev.id);
  const csv = ['NIM,Nama,Status,Check-In,Check-Out']
    .concat(rows.map((r) => [r.nim, r.nama, r.status === 'Check-In' ? 'Check-In (Belum Check-Out)' : r.status, r.checkin_at, r.checkout_at || ''].map(safe).join(',')))
    .join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="presensi-${ev.id}.csv"`);
  res.send('\uFEFF' + csv);
});

app.use((req, res) => res.status(404).render('error', { title: 'Tidak ditemukan', message: 'Halaman yang kamu cari tidak ada.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Terjadi kesalahan', message: 'Ada masalah di server. Coba lagi sebentar lagi.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`CURSOR berjalan di http://localhost:${PORT}`));
}
module.exports = app;
