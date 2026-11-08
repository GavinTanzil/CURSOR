const { ensureAdmin, seedDemo } = require('./db');
ensureAdmin();
seedDemo(true);
console.log('Data contoh berhasil dibuat (kelas lama dihapus).');
