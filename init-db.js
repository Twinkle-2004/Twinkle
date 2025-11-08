const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const DB = path.join(__dirname, 'data.json');

let db = { users: [], inventory_items: [], inventory_audit: [], app_meta: {} };
if (fs.existsSync(DB)) {
  try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch (e) { fs.renameSync(DB, DB + '.bak.' + Date.now()); }
}
if (!db.users.find(u => u.username === 'admin')) db.users.push({ id: randomUUID(), username: 'admin', role: 'admin', created_at: new Date().toISOString() });
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || randomUUID();
db.app_meta = db.app_meta || {};
db.app_meta.ADMIN_TOKEN = ADMIN_TOKEN;
fs.writeFileSync(DB, JSON.stringify(db, null, 2), 'utf8');
console.log('\n=== DB INIT COMPLETE ===');
console.log('ADMIN_TOKEN=' + ADMIN_TOKEN);
console.log('data saved to', DB);