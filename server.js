const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DB_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3000;

function loadDb() {
  if (!fs.existsSync(DB_FILE)) return { users: [], inventory_items: [], inventory_audit: [], app_meta: {} };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { fs.renameSync(DB_FILE, DB_FILE + '.corrupt.' + Date.now()); return { users: [], inventory_items: [], inventory_audit: [], app_meta: {} }; }
}
function saveDb(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }

const lock = { locked: false };
async function withDb(fn) {
  while (lock.locked) await new Promise(r => setTimeout(r, 5));
  lock.locked = true;
  try {
    const db = loadDb();
    const r = await fn(db);
    saveDb(db);
    return r;
  } finally { lock.locked = false; }
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (loadDb().app_meta && loadDb().app_meta.ADMIN_TOKEN) || 'dev-token';

const app = express();
app.use(express.json());
// log requests (authorization header only)
app.use((req,res,next) => { console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} auth=${!!req.headers.authorization}`); next(); });
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req,res) => res.send('Inventory API — open /index.html'));

function requireAuth(req,res,next){
  const a = req.headers['authorization'];
  if(!a) return res.status(401).json({code:'NO_AUTH',message:'Missing Authorization header'});
  const p = a.split(' ');
  if(p.length!==2 || p[0]!=='Bearer' || p[1]!==ADMIN_TOKEN) return res.status(403).json({code:'FORBIDDEN',message:'Invalid token'});
  req.user = { id:'admin' };
  next();
}

function findItem(db,id){ return db.inventory_items.find(i=>i.item_id===id); }

app.post('/api/v1/inventory', requireAuth, async (req,res) => {
  const { sku, product_name } = req.body;
  if (!sku || !product_name) return res.status(400).json({code:'VALIDATION',message:'sku & product_name required'});
  const result = await withDb(db => {
    if (db.inventory_items.some(x => x.sku === sku && !x.deleted_at)) return { status:409, body:{code:'DUPLICATE_SKU',message:'SKU already exists'} };
    const id = randomUUID();
    const rec = Object.assign({ item_id:id, created_at:new Date().toISOString(), updated_at:new Date().toISOString(), deleted_at:null, created_by:req.user.id, updated_by:req.user.id }, req.body);
    db.inventory_items.push(rec);
    db.inventory_audit.unshift({ audit_id: randomUUID(), item_id:id, operation:'CREATE', changed_by:req.user.id, changed_at:new Date().toISOString(), diff:null, full_record:rec });
    return { status:201, body:rec };
  });
  return res.status(result.status).json(result.body);
});

app.get('/api/v1/inventory', requireAuth, (req,res) => {
  const includeDeleted = req.query.include_deleted === 'true';
  const db = loadDb();
  res.json(includeDeleted ? db.inventory_items : db.inventory_items.filter(i=>!i.deleted_at));
});

app.get('/api/v1/inventory/:id', requireAuth, (req,res) => {
  const db = loadDb(); const row = findItem(db, req.params.id);
  if(!row) return res.status(404).json({code:'NOT_FOUND'});
  res.json(row);
});

app.patch('/api/v1/inventory/:id', requireAuth, async (req,res) => {
  const allowed = ['product_name','category','quantity','supplier','price','location','metadata'];
  const updates = {}; for(const k of allowed) if(k in req.body) updates[k]=req.body[k];
  if(Object.keys(updates).length===0) return res.status(400).json({code:'NO_UPDATES',message:'No valid fields'});
  const r = await withDb(db => {
    const ex = findItem(db, req.params.id); if(!ex) return { status:404, body:{code:'NOT_FOUND'} };
    const before = {...ex};
    for(const k in updates) ex[k] = (k==='quantity'||k==='price') ? (updates[k]==null?null:Number(updates[k])) : updates[k];
    ex.updated_at = new Date().toISOString(); ex.updated_by = req.user.id;
    const diff = {}; for(const k in updates) diff[k] = { before: before[k], after: ex[k] };
    db.inventory_audit.unshift({ audit_id: randomUUID(), item_id: ex.item_id, operation:'UPDATE', changed_by:req.user.id, changed_at:new Date().toISOString(), diff, full_record:{...ex} });
    return { status:200, body:ex };
  });
  return res.status(r.status).json(r.body);
});

app.delete('/api/v1/inventory/:id', requireAuth, async (req,res) => {
  const r = await withDb(db => {
    const ex = findItem(db, req.params.id); if(!ex) return { status:404, body:{code:'NOT_FOUND'} };
    const before = ex.deleted_at; ex.deleted_at = new Date().toISOString(); ex.updated_at = ex.deleted_at; ex.updated_by = req.user.id;
    db.inventory_audit.unshift({ audit_id: randomUUID(), item_id: ex.item_id, operation:'DELETE', changed_by:req.user.id, changed_at:new Date().toISOString(), diff:{deleted_at:{before,after:ex.deleted_at}}, full_record:{...ex} });
    return { status:200, body:{ok:true} };
  });
  return res.status(r.status).json(r.body);
});

app.get('/api/v1/inventory/:id/audit', requireAuth, (req,res) => {
  const db = loadDb();
  res.json(db.inventory_audit.filter(a=>a.item_id===req.params.id).sort((a,b)=>b.changed_at.localeCompare(a.changed_at)));
});

// JSON 404 for API paths
app.use('/api', (req,res) => res.status(404).json({code:'NOT_FOUND',message:`No API route ${req.method} ${req.originalUrl}`}));

app.listen(PORT, () => console.log(`Inventory API running at http://localhost:${PORT}`));
