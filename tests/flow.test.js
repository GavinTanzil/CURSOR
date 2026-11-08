process.env.DB_PATH = require('path').join(require('os').tmpdir(), `cursor-test-${Date.now()}.db`);
process.env.SEED_DEMO = 'false';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let server, base;
const jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function req(path, { method = 'GET', form } = {}) {
  const res = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { cookie: cookieHeader(), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined
  });
  (res.headers.getSetCookie?.() || []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
  return res;
}
async function page(path) { const r = await req(path); return { r, html: await r.text() }; }
async function csrf() { const { html } = await page('/'); return html.match(/name="_csrf" value="([^"]+)"/)?.[1] || (await page('/admin/login')).html.match(/name="_csrf" value="([^"]+)"/)[1]; }
async function post(path, form) { const token = await csrf(); return req(path, { method: 'POST', form: { _csrf: token, ...form } }); }
async function flashAfter(res) { assert.ok([302, 303].includes(res.status), `status ${res.status}`); const { html } = await page('/'); return (html.match(/class="flash[^"]*"[^>]*>([^<]+)</) || [])[1] || ''; }

test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://localhost:${server.address().port}`; });
test.after(() => server.close());

let evId;
test('admin wajib login & CRUD: Create', async () => {
  let r = await req('/admin');
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /login/);

  r = await post('/admin/login', { username: 'admin', password: 'salah' });
  assert.match(await flashAfter(r), /salah/);

  r = await post('/admin/login', { username: 'admin', password: 'admin123' });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/admin');

  r = await post('/admin/events', { mata_kuliah: 'Basis Data', pengajar: 'Dosen Uji', waktu: '2026-11-10T10:00', ruang: 'D-401', kode_sesi: 'kode123', link_modul: 'https://example.com/m.pdf', status: 'Belum Mulai' });
  assert.equal(r.status, 302);
  const { html } = await page('/admin');
  assert.match(html, /Basis Data/);
  evId = html.match(/id="kelas-(\d+)"/)[1];
});

test('Create ditolak bila data tidak valid', async () => {
  const r = await post('/admin/events', { mata_kuliah: 'X', pengajar: '', waktu: 'bukan-tanggal', ruang: '', kode_sesi: '!', link_modul: 'javascript:alert(1)' });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /Link modul harus berupa URL/);
});

test('Check-In tidak bisa saat kelas belum berlangsung', async () => {
  const r = await post(`/kelas/${evId}/checkin`, { nama: 'Andi Wijaya', nim: '12345678901' });
  assert.match(await flashAfter(r), /baru dibuka saat kelas berlangsung/);
});

test('Modul terkunci saat Belum Mulai / Berlangsung (UI & server)', async () => {
  let { html } = await page('/');
  assert.match(html, /Download Modul \(terkunci\)/);
  assert.doesNotMatch(html, /example\.com\/m\.pdf/);
  const r = await req(`/kelas/${evId}/modul`);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `/#kelas-${evId}`);
});

test('Update: status menjadi Berlangsung', async () => {
  const r = await post(`/admin/events/${evId}/status`, { status: 'Berlangsung' });
  assert.equal(r.status, 302);
});

test('Check-In: sukses, validasi NIM ganda, validasi input', async () => {
  let r = await post(`/kelas/${evId}/checkin`, { nama: 'Andi Wijaya', nim: '12345678901' });
  assert.match(await flashAfter(r), /Check-In berhasil/);
  r = await post(`/kelas/${evId}/checkin`, { nama: 'Andi Wijaya', nim: '12345678901' });
  assert.match(await flashAfter(r), /sudah melakukan Check-In/);
  r = await post(`/kelas/${evId}/checkin`, { nama: 'Budi', nim: 'abc' });
  assert.match(await flashAfter(r), /NIM harus berupa angka/);
  const { html } = await page('/admin');
  assert.match(html, /Check-In \(Belum Check-Out\)/);
});

test('Check-Out: NIM belum Check-In, kode salah, sukses, ganda', async () => {
  let r = await post(`/kelas/${evId}/checkout`, { nim: '99999999999', kode_sesi: 'KODE123' });
  assert.match(await flashAfter(r), /belum melakukan Check-In/);
  r = await post(`/kelas/${evId}/checkout`, { nim: '12345678901', kode_sesi: 'SALAH' });
  assert.match(await flashAfter(r), /Kode Sesi salah/);
  r = await post(`/kelas/${evId}/checkout`, { nim: '12345678901', kode_sesi: 'kode123' });
  assert.match(await flashAfter(r), /Hadir Penuh/);
  r = await post(`/kelas/${evId}/checkout`, { nim: '12345678901', kode_sesi: 'KODE123' });
  assert.match(await flashAfter(r), /sudah Check-Out/);
  const { html } = await page('/');
  assert.match(html, /<strong>1<\/strong> hadir penuh/);
});

test('Peserta yang tidak Check-Out tetap Check-In', async () => {
  await post(`/kelas/${evId}/checkin`, { nama: 'Citra Dewi', nim: '22222222222' });
  const { html } = await page('/admin');
  assert.match(html, /22222222222/);
  assert.match(html, /1 Check-In \(belum Check-Out\), 1 hadir penuh/);
});

test('Selesai: Check-In ditutup, modul terbuka untuk siapa saja', async () => {
  await post(`/admin/events/${evId}/status`, { status: 'Selesai' });
  let r = await post(`/kelas/${evId}/checkin`, { nama: 'Doni Saputra', nim: '33333333333' });
  assert.match(await flashAfter(r), /sudah selesai/);

  Object.keys(jar).forEach((k) => delete jar[k]);
  const { html } = await page('/');
  assert.match(html, /Download Modul<\/a>/);
  r = await req(`/kelas/${evId}/modul`);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://example.com/m.pdf');
});

test('Pencarian berdasarkan nama mata kuliah', async () => {
  assert.match((await page('/?q=basis')).html, /<h2>Basis Data<\/h2>/);
  assert.match((await page('/?q=zzz')).html, /Tidak ada kelas yang cocok/);
  assert.doesNotMatch((await page('/?q=%25')).html, /<h2>Basis Data<\/h2>/);
});

test('POST tanpa token CSRF ditolak', async () => {
  const r = await req(`/kelas/${evId}/checkin`, { method: 'POST', form: { nama: 'X Y Z', nim: '12345' } });
  assert.equal(r.status, 403);
});

test('Update info, lalu Delete', async () => {
  await post('/admin/login', { username: 'admin', password: 'admin123' });
  let r = await post(`/admin/events/${evId}`, { mata_kuliah: 'Basis Data Lanjut', pengajar: 'Dosen Uji', waktu: '2026-11-10T10:00', ruang: 'D-402', kode_sesi: 'KODE123', link_modul: 'https://example.com/m.pdf', status: 'Selesai' });
  assert.equal(r.status, 302);
  assert.match((await page('/admin')).html, /<h2>Basis Data Lanjut<\/h2>/);
  r = await post(`/admin/events/${evId}/delete`, {});
  assert.equal(r.status, 302);
  assert.doesNotMatch((await page('/admin')).html, /<h2>Basis Data Lanjut<\/h2>/);
});
