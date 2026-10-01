'use strict';
/*
 * Audit trail (js/audit.js, hooks in js/cloud-sync.js and js/core.js): every add / edit / delete is logged with
 * who, when, section, record and the values before and after; entries are kept on the phone until the cloud
 * accepts them, and are never lost or sent twice as different entries.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let ctx, store, cloud;
function load(opts = {}){
  store = {};
  cloud = { sets: [], fail: null, deleted: [] };
  ctx = vm.createContext({
    console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Uint8Array, setTimeout, clearTimeout,
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + Date.now()) % 256; return a; } },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { if (store.__full) throw new Error('quota'); store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
  });
  vm.runInContext('var DATA = {};', ctx);
  vm.runInContext(read('js/cloud-sync.js'), ctx);
  vm.runInContext(`
    var escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    var __enc = ${opts.enc ? 'true' : 'false'};
    var encEnabled = () => __enc;
    var encSeal = async j => 'LOCAL:' + Buffer_b64(j);
    var encOpen = async p => { if(!String(p).startsWith('LOCAL:')) throw new Error('bad'); return Buffer_unb64(String(p).slice(6)); };
    var __keys = { sales: true, production: true, reference: true };
    var skSealSection = async (sec, j) => { if(!__keys[sec]) throw new Error('no key'); return { payload: 'SEC:' + sec + ':' + Buffer_b64(j), kv: 1 }; };
    var skMustEncrypt = () => false;
    var EXPORT_SOURCES = {}, EXPORT_LABELS = {};
    var fmtDate = d => d.split('-').reverse().join('-');
  `, ctx);
  ctx.Buffer_b64 = s => Buffer.from(s, 'utf8').toString('base64');
  ctx.Buffer_unb64 = s => Buffer.from(s, 'base64').toString('utf8');
  vm.runInContext(read('js/audit.js'), ctx);
  // a signed-in phone with Cloud Sync on; the owner unless told otherwise
  store['khata-cloud-sync-on'] = '1';
  store['khata-cloud-user'] = JSON.stringify({ email: opts.email || 'se.muhammadfaizan@gmail.com', verified: true });
  ctx.fakeDb = {
    collection: name => ({
      doc: id => ({ set: async doc => {
        if (cloud.fail === 'denied') { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
        if (cloud.fail === 'offline') { throw new Error('network down'); }
        cloud.sets.push({ name, id, doc: JSON.parse(JSON.stringify(doc)) });
      } }),
    }),
  };
}
const run = code => vm.runInContext(code, ctx);
const setData = obj => run(`DATA = ${JSON.stringify(obj)}; tombRebaseline();`);
const queue = () => JSON.parse(store['khata-audit-queue'] || '[]');
// what save() does, in order: note the changes, then keep them on the phone
const save = async () => { run('tombRecordDeletions();'); await run('auditCommit()'); };
const body = item => JSON.parse(item.doc.payload);

beforeEach(() => load());

describe('what is logged', () => {
  test('an added record: who, section, list, record, after values', async () => {
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 's1', date: '2026-10-01', client: 'Javed', amount: 500 });`);
    await save();
    const q = queue();
    assert.equal(q.length, 1);
    const d = q[0].doc;
    assert.equal(d.by, 'se.muhammadfaizan@gmail.com');
    assert.equal(d.action, 'add');
    assert.equal(d.list, 'sale');
    assert.equal(d.section, 'sales');
    assert.equal(d.recId, 's1');
    assert.ok(d.ct > 0);
    assert.equal(body(q[0]).before, null);
    assert.equal(body(q[0]).after.amount, 500);
    assert.match(body(q[0]).label, /Javed/);
  });
  test('an edit keeps the values before and after, without edit stamps', async () => {
    setData({ sale: [{ id: 's1', amount: 500, _mt: 5, _mb: 'x@y.z' }] });
    run(`DATA.sale[0].amount = 650;`);
    await save();
    const q = queue();
    assert.equal(q.length, 1);
    assert.equal(q[0].doc.action, 'edit');
    assert.equal(body(q[0]).before.amount, 500);
    assert.equal(body(q[0]).after.amount, 650);
    assert.equal('_mt' in body(q[0]).before, false);
    assert.equal('_mt' in body(q[0]).after, false);
  });
  test('a delete keeps the record as it was', async () => {
    setData({ expense: [{ id: 'e1', amount: 90 }, { id: 'e2', amount: 10 }] });
    run(`DATA.expense = DATA.expense.filter(r => r.id !== 'e1');`);
    await save();
    const q = queue();
    assert.equal(q.length, 1);
    assert.equal(q[0].doc.action, 'delete');
    assert.equal(q[0].doc.recId, 'e1');
    assert.equal(body(q[0]).before.amount, 90);
    assert.equal(body(q[0]).after, null);
  });
  test('several changes in one save give one entry each, in the right sections', async () => {
    setData({ sale: [{ id: 's1', amount: 1 }], wagePayments: [{ id: 'w1', amount: 5 }] });
    run(`DATA.sale[0].amount = 2; DATA.wagePayments.push({ id: 'w2', amount: 7 });`);
    await save();
    const q = queue();
    assert.equal(q.length, 2);
    assert.deepEqual(q.map(e => e.doc.section).sort(), ['sales', 'wages']);
  });
  test('a single setting (not a list) is logged as an edit of that setting', async () => {
    setData({ businessInfo: { name: 'Old' }, sale: [] });
    run(`DATA.businessInfo = { name: 'New' };`);
    await save();
    const q = queue();
    assert.equal(q.length, 1);
    assert.equal(q[0].doc.list, 'businessInfo');
    assert.equal(q[0].doc.recId, '');
    assert.equal(body(q[0]).before.name, 'Old');
    assert.equal(body(q[0]).after.name, 'New');
  });
  test('a save with nothing changed logs nothing', async () => {
    setData({ sale: [{ id: 's1', amount: 1 }], businessInfo: { name: 'A' } });
    await save(); await save();
    assert.equal(queue().length, 0);
  });
  test('a whole-ledger replace (restore, cloud pull, merge) is not logged as edits or deletes', async () => {
    setData({ sale: [{ id: 's1', amount: 1 }], businessInfo: { name: 'A' } });
    run(`tombResetBaseline(); DATA = { sale: [{ id: 's9', amount: 9 }], businessInfo: { name: 'Z' } };`);
    await save();
    assert.equal(queue().length, 0);
    run(`DATA.sale[0].amount = 10;`); // ...but the very next real edit is
    await save();
    assert.equal(queue().length, 1);
  });
  test('nothing is logged when Cloud Sync is off or nobody is signed in', async () => {
    setData({ sale: [] });
    store['khata-cloud-sync-on'] = '0';
    run(`DATA.sale.push({ id: 'a' });`); await save();
    assert.equal(queue().length, 0);
    store['khata-cloud-sync-on'] = '1'; delete store['khata-cloud-user'];
    run(`DATA.sale.push({ id: 'b' });`); await save();
    assert.equal(queue().length, 0);
  });
  test("another person's changes are logged under their own email", async () => {
    load({ email: 'Operator@Example.com' });
    setData({ production: [] });
    run(`DATA.production.push({ id: 'p1', qty: 40 });`); await save();
    assert.equal(queue()[0].doc.by, 'operator@example.com');
    assert.equal(queue()[0].doc.section, 'production');
  });
});

describe('never lose an entry', () => {
  test('the entries are on the phone before save() goes on to store the ledger', async () => {
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a' });`);
    run('tombRecordDeletions();');
    assert.equal(queue().length, 0, 'noted in memory only until committed');
    await run('auditCommit()');
    assert.equal(queue().length, 1);
    const src = read('js/core.js');
    assert.ok(src.indexOf('await auditCommit()') < src.indexOf('const json = JSON.stringify(DATA);'), 'save() commits before it stores');
  });
  test('when the phone cannot store the queue, the entries stay in memory and go in at the next save', async () => {
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a' });`);
    store.__full = true;
    await save();
    assert.equal(queue().length, 0);
    assert.match(run('auditStatusLine()'), /storage full/);
    delete store.__full;
    run(`DATA.sale.push({ id: 'b' });`);
    await save();
    assert.deepEqual(queue().map(e => e.doc.recId).sort(), ['a', 'b']);
  });
  test('a connection failure keeps every entry and stops the caller (so the push waits)', async () => {
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a' }); DATA.sale.push({ id: 'b' });`); await save();
    cloud.fail = 'offline';
    await assert.rejects(() => run('auditFlush(fakeDb)'));
    assert.equal(queue().length, 2);
  });
  test('when the cloud refuses (rule not pasted yet) the entries stay, nothing throws, and the card says why', async () => {
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a' });`); await save();
    cloud.fail = 'denied';
    const r = await run('auditFlush(fakeDb)');
    assert.equal(r.sent, 0);
    assert.equal(queue().length, 1);
    assert.match(run('auditStatusLine()'), /updated Firebase rule/);
  });
  test('after it comes back online the queue is sent in order and emptied', async () => {
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a' });`); await save();
    run(`DATA.sale.push({ id: 'b' });`); await save();
    run(`DATA.sale.push({ id: 'c' });`); await save();
    cloud.fail = 'offline';
    await assert.rejects(() => run('auditFlush(fakeDb)'));
    cloud.fail = null;
    const r = await run('auditFlush(fakeDb)');
    assert.equal(r.sent, 3);
    assert.equal(queue().length, 0);
    assert.deepEqual(cloud.sets.map(s => JSON.parse(s.doc.payload).after.id), ['a', 'b', 'c']);
    assert.ok(cloud.sets.every(s => s.name === 'audit'));
  });
  test('an entry is sent with a fixed id, so sending it twice is the same entry', async () => {
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a' });`); await save();
    const before = queue()[0].uid;
    cloud.fail = 'offline';
    await assert.rejects(() => run('auditFlush(fakeDb)'));
    assert.equal(queue()[0].uid, before);
    cloud.fail = null;
    await run('auditFlush(fakeDb)');
    assert.equal(cloud.sets[0].id, before);
  });
  test("an account only sends its own entries; another account's stay queued on the phone", async () => {
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a' });`); await save();
    store['khata-cloud-user'] = JSON.stringify({ email: 'someone@else.com', verified: true });
    const r = await run('auditFlush(fakeDb)');
    assert.equal(r.sent, 0);
    assert.equal(queue().length, 1);
  });
  test('the queue is not wiped by anything that clears the ledger keys', () => {
    assert.ok(!/khata-audit/.test(read('js/encryption.js')));
    assert.ok(!/removeItem\(AUDIT_QUEUE_KEY\)/.test(read('js/lock-init.js')));
  });
});

describe('sealing', () => {
  test('with Encrypt Data on the entry is sealed with the section key and readable text never reaches the queue', async () => {
    load({ enc: true });
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a', client: 'SecretClient' });`); await save();
    const item = queue()[0];
    assert.equal(item.doc.encrypted, true);
    assert.equal(item.doc.kv, 1);
    assert.ok(item.doc.payload.startsWith('SEC:sales:'));
    assert.ok(!store['khata-audit-queue'].includes('SecretClient'));
    assert.equal(item.local, false);
  });
  test('without the section key it is sealed with the phone key, kept, and sealed for the cloud once the key is there', async () => {
    load({ enc: true });
    run(`__keys.sales = false;`);
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a', client: 'SecretClient' });`); await save();
    let item = queue()[0];
    assert.equal(item.local, true);
    assert.ok(item.doc.payload.startsWith('LOCAL:'));
    assert.ok(!store['khata-audit-queue'].includes('SecretClient'));
    let r = await run('auditFlush(fakeDb)');
    assert.equal(r.sent, 0, 'no key yet: stays queued');
    run(`__keys.sales = true;`);
    r = await run('auditFlush(fakeDb)');
    assert.equal(r.sent, 1);
    assert.ok(cloud.sets[0].doc.payload.startsWith('SEC:sales:'));
    assert.equal(queue().length, 0);
  });
  test('a plain entry for a section that is encrypted in the cloud waits until Encrypt Data is on', async () => {
    setData({ sale: [] });
    run(`DATA.sale.push({ id: 'a' });`); await save();
    run(`skMustEncrypt = () => true;`);
    const r = await run('auditFlush(fakeDb)');
    assert.equal(r.sent, 0);
    assert.equal(queue().length, 1);
  });
});

describe('cloud rule', () => {
  const rule = () => vm.runInContext('CLOUD_FIRESTORE_RULE', ctx);
  const block = () => { const r = rule(); const i = r.indexOf('match /audit/{id}'); return r.slice(i, r.indexOf('match /config/access')); };
  test('only the owner reads the log', () => {
    assert.match(block(), /allow read: if isOwner\(\);/);
  });
  test('an entry can only be created by its own author (or the owner), with exactly the agreed fields', () => {
    const b = block();
    assert.match(b, /request\.resource\.data\.by == me\(\)/);
    assert.match(b, /hasOnly\(\['by','ct','section','action','list','recId','encrypted','kv','payload'\]\)/);
    assert.match(b, /action in \['add','edit','delete'\]/);
  });
  test('nobody can edit an entry: the only update is sending the identical entry again; only the owner deletes', () => {
    const b = block();
    assert.match(b, /allow update: if isOwner\(\)\s*\|\| \(signedIn\(\) && resource\.data\.by == me\(\) && request\.resource\.data == resource\.data\);/);
    assert.match(b, /allow delete: if isOwner\(\);/);
  });
  test('an entry cannot claim a time in the future, more than a year back, or after the access ended', () => {
    const b = block();
    assert.match(b, /ct <= request\.time\.toMillis\(\) \+ 300000/);
    assert.match(b, /ct > request\.time\.toMillis\(\) - 31622400000/);
    assert.match(rule(), /function loggedBeforeEnd/);
  });
  test('the existing rules are untouched', () => {
    const r = rule();
    ['match /ledger/{sec}', 'match /keys/{email}', 'match /sync/{doc}', 'match /config/access', 'function canChange(sec)', 'function keepsEncryption()']
      .forEach(s => assert.ok(r.includes(s), s));
    assert.match(r, /allow create, update: if isOwner\(\) \|\| \(canChange\(sec\) && !needsApproval\(sec\) && keepsEncryption\(\)\);/);
  });
});

describe('the owner card in Settings', () => {
  test('only the owner gets it, and it is just the status and a way into the Audit screen', () => {
    const h = run('auditCardHtml()');
    assert.match(h, /Audit trail/);
    assert.match(h, /auditOpenBtn/);
    assert.ok(!/auditList/.test(h));
    store['khata-cloud-user'] = JSON.stringify({ email: 'x@y.z', verified: true });
    assert.equal(run('auditCardHtml()'), '');
  });
});

describe('the Audit screen', () => {
  const rows = () => JSON.parse(run('JSON.stringify(auditDiffRows(ROW_B, ROW_A))'));
  test('only the owner gets the screen', () => {
    assert.match(run('auditPanel()'), /auditLoadBtn/);
    store['khata-cloud-user'] = JSON.stringify({ email: 'x@y.z', verified: true });
    assert.match(run('auditPanel()'), /Only the owner/);
    assert.ok(!/auditLoadBtn/.test(run('auditPanel()')));
  });
  test('it has filters for person, section, action and date', () => {
    const h = run('auditPanel()');
    ['auditWho', 'auditSection', 'auditAction', 'auditFrom', 'auditTo'].forEach(id => assert.ok(h.includes('id="' + id + '"'), id));
    assert.match(h, /Wages|Sales/);
    assert.match(h, />Deleted</);
  });
  test('an edit shows readable field names and only the fields that changed, before and after', () => {
    run(`var ROW_B = { id: 's1', date: '2026-10-01', client: 'Javed', qty: 40, amount: 500, desc: 'x' };
         var ROW_A = { id: 's1', date: '2026-10-01', client: 'Javed', qty: 40, amount: 650, desc: 'x' };`);
    const r = rows();
    const changed = r.filter(x => x.changed);
    assert.equal(changed.length, 1);
    assert.equal(changed[0].field, 'Amount');
    assert.equal(changed[0].before, 'Rs 500');
    assert.equal(changed[0].after, 'Rs 650');
    assert.ok(r.some(x => x.field === 'Quantity' && !x.changed), 'unchanged fields are kept, marked unchanged');
    assert.ok(!r.some(x => x.field === 'Id'), 'the internal id is not shown');
    assert.equal(r.find(x => x.field === 'Date').after, '01-10-2026');
  });
  test('nested values are flattened to readable lines', () => {
    const r = JSON.parse(run(`JSON.stringify(auditDiffRows({ id: 1, cheques: [{ no: '11', amount: 500 }] }, { id: 1, cheques: [{ no: '11', amount: 900 }] }))`));
    const c = r.filter(x => x.changed);
    assert.equal(c.length, 1);
    assert.equal(c[0].field, 'Cheques 1 \u203a Amount');
    assert.equal(c[0].after, 'Rs 900');
  });
  test('an added record lists every field, a deleted one lists every field as it was', () => {
    const a = JSON.parse(run(`JSON.stringify(auditDiffRows(null, { id: 1, qty: 5, desc: 'new' }))`));
    assert.deepEqual(a.map(x => x.field), ['Quantity', 'Description']);
    assert.equal(a[0].after, '5');
    assert.equal(a[0].before, '\u2014');
    const d = JSON.parse(run(`JSON.stringify(auditDiffRows({ id: 1, qty: 5 }, null))`));
    assert.equal(d[0].before, '5');
    assert.equal(d[0].after, '\u2014');
  });
  test('a single setting (not a record) shows its value', () => {
    const r = JSON.parse(run(`JSON.stringify(auditDiffRows({ name: 'Old' }, { name: 'New' }))`));
    assert.equal(r[0].field, 'Name');
    assert.equal(r[0].before, 'Old');
    assert.equal(r[0].after, 'New');
  });
  const seed = () => run(`AUDIT_ROWS = [
    { id: '1', doc: { by: 'a@x.com', ct: 3000, section: 'sales', action: 'add', list: 'sale', recId: 's1' }, body: { label: 'S1', before: null, after: { id: 's1', amount: 10 } } },
    { id: '2', doc: { by: 'b@x.com', ct: 2000, section: 'wages', action: 'edit', list: 'wagePayments', recId: 'w1' }, body: { label: 'W1', before: { id: 'w1', amount: 5 }, after: { id: 'w1', amount: 6 } } },
    { id: '3', doc: { by: 'a@x.com', ct: 1000, section: 'sales', action: 'delete', list: 'sale', recId: 's0' }, body: { label: 'S0', before: { id: 's0', amount: 1 }, after: null } },
  ]; AUDIT_LOADED_ONCE = true;`);
  test('person, section and action narrow what is shown', () => {
    seed();
    const ids = () => JSON.parse(run('JSON.stringify(auditFiltered().map(r => r.id))'));
    assert.deepEqual(ids(), ['1', '2', '3']);
    run(`AUDIT_FILTER.who = 'a@x.com'`); assert.deepEqual(ids(), ['1', '3']);
    run(`AUDIT_FILTER.section = 'sales'; AUDIT_FILTER.action = 'delete'`); assert.deepEqual(ids(), ['3']);
    run(`AUDIT_FILTER.who = 'b@x.com'`); assert.deepEqual(ids(), []);
    run(`AUDIT_FILTER = { who: '', section: '', action: '', from: '', to: '' }`);
  });
  test('the dates are asked of the cloud (one sort field, so no index is needed); the rest is filtered on screen', async () => {
    const calls = [];
    const q = { where(f, op, v) { calls.push(['where', f, op]); return q; }, orderBy(f, d) { calls.push(['orderBy', f, d]); return q; }, startAfter() { return q; }, limit(n) { calls.push(['limit', n]); return q; }, get: async () => ({ docs: [] }) };
    ctx.qDb = { collection: n => { calls.push(['collection', n]); return q; } };
    run(`cloudSdkReady = async () => qDb; AUDIT_FILTER = { who: 'a@x.com', section: 'sales', action: 'add', from: '2026-09-01', to: '2026-09-30' };`);
    await run('auditLoad(false)');
    assert.deepEqual(calls.filter(c => c[0] === 'where').map(c => c.slice(1).join(' ')), ['ct >=', 'ct <=']);
    assert.ok(calls.some(c => c[0] === 'orderBy' && c[1] === 'ct' && c[2] === 'desc'));
    assert.ok(calls.some(c => c[0] === 'limit' && c[1] === 100));
    assert.ok(!calls.some(c => c[0] === 'where' && /by|section|action/.test(c[1])), 'no per-person/section/action queries (they would each need a Firebase index)');
    run(`AUDIT_FILTER = { who: '', section: '', action: '', from: '', to: '' }`);
  });
  test('the log is read through the same decryption the sections use', async () => {
    const doc = { by: 'a@x.com', ct: 5, section: 'sales', action: 'add', list: 'sale', recId: 's1', encrypted: false, payload: JSON.stringify({ label: 'L', before: null, after: { id: 's1' } }) };
    const r = await run(`auditOpenDoc(${JSON.stringify(doc)})`);
    assert.equal(r.body.label, 'L');
    const bad = await run(`auditOpenDoc({ section: 'sales', encrypted: true, kv: 9, payload: 'junk' })`);
    assert.ok(bad.error);
  });
  test('the CSV is what is on screen, one line per changed field, ready for a spreadsheet', () => {
    seed();
    run(`AUDIT_FILTER.who = 'b@x.com'`);
    const src = run('auditCsvSource()');
    assert.deepEqual(Array.from(src.headers), ['When', 'Person', 'Section', 'List', 'Action', 'Record', 'Field', 'Before', 'After']);
    assert.equal(src.cells.length, 1);
    const row = Array.from(src.cells[0]);
    assert.match(row[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.equal(row[1], 'b@x.com');
    assert.equal(row[2], 'Wages');
    assert.equal(row[4], 'Edited');
    assert.equal(row[6], 'Amount');
    assert.equal(row[7], 'Rs 5');
    assert.equal(row[8], 'Rs 6');
    run(`AUDIT_FILTER.who = ''`);
    assert.equal(run('auditCsvSource()').cells.length, 3);
    run(`AUDIT_FILTER = { who: '', section: '', action: '', from: '', to: '' }`);
  });
  test('the CSV registers with the common export button and keeps text inert', () => {
    assert.equal(typeof run('EXPORT_SOURCES.audit'), 'function');
    assert.equal(run('EXPORT_LABELS.audit'), 'Audit');
    run(`AUDIT_ROWS = [{ id: '1', doc: { by: 'a@x.com', ct: 1000, section: 'sales', action: 'add', list: 'sale', recId: 's' }, body: { label: '<b>x</b>', before: null, after: { id: 's', desc: '<script>1</script>' } } }]`);
    const row = Array.from(run('auditCsvSource()').cells[0]).join('|');
    assert.ok(!/<script>/.test(row));
  });
  test('the screen is wired into the app: a Tools tab, a panel, a wire step, offered only to the owner', () => {
    assert.match(read('js/core.js'), /\{id:'audit', label:'Audit'/);
    assert.match(read('js/wiring.js'), /audit: typeof auditPanel === 'function'/);
    assert.match(read('js/wiring.js'), /if\(id==='audit'.*wireAuditPanel/);
    assert.match(read('js/view-only.js'), /if\(id === 'audit'\) return typeof cloudIsOwner === 'function' && cloudIsOwner\(\)/);
  });
  test('the script is loaded after write-access.js and cached for offline use', () => {
    const html = read('index.html');
    const at = f => html.indexOf('<script src="./js/' + f + '"></script>');
    assert.ok(at('write-access.js') > 0 && at('write-access.js') < at('audit.js'));
    assert.ok(at('audit.js') < at('lock-init.js'));
    assert.match(read('service-worker.js'), /'\.\/js\/audit\.js'/);
  });
});

describe('year-old entries', () => {
  test('the owner removes entries older than a year, once a day', async () => {
    const old = [{ ref: 1 }, { ref: 2 }];
    let queries = 0;
    const db = {
      collection: () => ({
        where: (f, op, v) => ({ limit: () => ({ get: async () => { queries++; assert.equal(f, 'ct'); assert.equal(op, '<'); assert.ok(v < Date.now() - 360 * 86400000); return queries === 1 ? { empty: false, size: 2, forEach: fn => old.forEach(d => fn({ ref: d.ref })) } : { empty: true, size: 0, forEach() {} }; } }) }),
      }),
      batch: () => ({ delete: r => cloud.deleted.push(r), commit: async () => {} }),
    };
    await run('(async()=>{})()');
    ctx.purgeDb = db;
    await run('auditPurge(purgeDb)');
    assert.deepEqual(cloud.deleted, [1, 2]);
    const q1 = queries;
    await run('auditPurge(purgeDb)');
    assert.equal(queries, q1, 'already done today');
  });
  test('a person who is not the owner never purges', async () => {
    store['khata-cloud-user'] = JSON.stringify({ email: 'x@y.z', verified: true });
    let touched = false;
    ctx.purgeDb = { collection: () => { touched = true; return {}; } };
    await run('auditPurge(purgeDb)');
    assert.equal(touched, false);
  });
});
