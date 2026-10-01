/* Urdu (اردو) display language. Loaded after autobackup.js and just before lock-init.js (which must stay last).
 *
 * WHAT IT DOES: a small button in the header ("اردو" / "English") switches the screen text between English and
 * Urdu on THIS phone only. It is a display layer: after the app draws a screen, every piece of text that exactly
 * matches an entry in I18N_UR is swapped for its Urdu version; switching back puts the English text back.
 *
 * WHAT IT NEVER TOUCHES: the ledger. Names, qualities, looms, clients, amounts, dates and notes you typed are not
 * in the dictionary, so they stay exactly as entered. This file does not read or write DATA, does not call save(),
 * and the language choice is kept only in this phone's storage (never synced, never in a backup).
 *
 * WHAT IS NOT TRANSLATED (yet): any text not in the dictionary stays English, so a screen can be part Urdu, part
 * English. Pop-up messages, PDFs and receipts, CSV files, the lock screen and the Wages / Sale / Recovery pages
 * are still English. To translate more, add the English text exactly as it appears and its Urdu below.
 * Layout stays left-to-right; Urdu text itself reads right-to-left and lines up to the right on its own.
 */
const I18N_KEY = 'khata-lang';                 // 'ur' or 'en', this phone only
const I18N_UR = {
  // Menu groups and pages
  'Daily':'روزانہ', 'Money':'رقم', 'Family':'گھر', 'Materials':'مال', 'Tools':'ٹولز',
  'Overview':'جائزہ', 'Production':'پیداوار', 'Sale':'فروخت', 'Recovery':'وصولی', 'Expense':'اخراجات', 'Wages':'اجرت',
  'Loans (Employee)':'قرض (ملازم)', 'Grey Cloth Rate':'گرے کپڑے کا ریٹ', 'Family Expense':'گھریلو اخراجات',
  'Personal Expense':'ذاتی اخراجات', 'Personal Loans (Given)':'ذاتی قرض (دیے گئے)', 'Owner Loans (to Company)':'مالک کا قرض (کمپنی کو)', 'Warp (Tana)':'تانا',
  'Weft (Bana)':'بانا', 'Warp (Tana) Beam':'تانا بیم', 'Cash Checkpoints':'کیش چیک پوائنٹس', 'Graphs':'گراف',
  'Approvals':'منظوریاں', 'Audit':'آڈٹ', 'Settings':'سیٹنگز', 'Backup & Restore':'بیک اپ اور بحالی',
  // Header
  'View only':'صرف دیکھنے کی اجازت', 'Loading…':'لوڈ ہو رہا ہے…',
  // Production: entry form
  'Log Production':'پیداوار درج کریں', 'Date':'تاریخ', 'Time':'وقت', 'Quality':'کوالٹی', 'Loom':'لوم',
  'Quantity Produced (mtr)':'تیار شدہ مقدار (میٹر)', 'Employees & Their Meters':'ملازمین اور ان کے میٹر',
  'Employee 1':'ملازم 1', 'Employee 1 Meters':'ملازم 1 کے میٹر', 'Employee 2 (optional)':'ملازم 2 (اختیاری)',
  'Employee 2 Meters':'ملازم 2 کے میٹر', 'Employee 3':'ملازم 3', 'Employee 3 Meters':'ملازم 3 کے میٹر',
  '+ Add a third employee':'+ تیسرا ملازم شامل کریں', 'Add & next loom →':'شامل کریں اور اگلا لوم ←',
  'Add Entry':'اندراج شامل کریں', 'Cancel Edit':'ترمیم منسوخ کریں',
  // Production: bulk import and log
  'Bulk Import':'اکٹھا درآمد', 'Import Rows':'قطاریں درآمد کریں', 'Production Log':'پیداوار کا ریکارڈ',
  'Filter by Quality':'کوالٹی کے مطابق فلٹر', 'All Qualities':'تمام کوالٹیز', 'All Time':'تمام وقت',
  'This Month':'اس مہینے', 'Last Month':'پچھلے مہینے', 'This Year':'اس سال', 'Custom…':'اپنی مرضی…',
  'From':'سے', 'To':'تک', 'Qty':'مقدار', 'Beam':'بیم', 'Emp 1':'ملازم 1', 'Emp 2':'ملازم 2', 'Emp 3':'ملازم 3', 'Diff':'فرق',
  // Settings lists
  'General':'عمومی', 'Security & sync':'سیکیورٹی اور سنک', 'People':'افراد', 'Looms & materials':'لومز اور مال',
  'Qualities':'کوالٹیز', 'Looms':'لومز', 'Employees':'ملازمین', 'Name':'نام',
  // Common buttons
  'Edit':'ترمیم', 'Delete':'حذف', 'Cancel':'منسوخ', 'Save':'محفوظ کریں', 'Close':'بند کریں', 'Search':'تلاش',
  'Yes':'ہاں', 'No':'نہیں', 'OK':'ٹھیک ہے', 'Info':'معلومات', 'Undo':'واپس'
};
// Text that starts with one of these (and then carries a number or name) keeps its tail as it is.
const I18N_UR_PREFIX = [ ['Remaining to assign:', 'باقی تقسیم کرنا ہے:'] ];
const I18N_ATTRS = ['placeholder', 'title', 'aria-label'];
let I18N_LANG = 'en';
let I18N_TIMER = 0;
let I18N_OBS = null;
const I18N_NODES = (typeof WeakMap !== 'undefined') ? new WeakMap() : null; // text node -> {en, ur}

// The Urdu for one piece of text (already trimmed), or null when it is not in the dictionary.
function i18nTranslate(s){
  if(Object.prototype.hasOwnProperty.call(I18N_UR, s)) return I18N_UR[s];
  for(const [p, u] of I18N_UR_PREFIX){ if(s.startsWith(p)) return u + s.slice(p.length); }
  return null;
}
function i18nSkipNode(el){
  if(!el) return true;
  if(/^(SCRIPT|STYLE|TEXTAREA|INPUT|NOSCRIPT)$/.test(el.tagName)) return true;
  return !!(el.closest && el.closest('[data-no-i18n],[contenteditable="true"]'));
}
function i18nTextNode(n){
  const cur = n.nodeValue;
  const rec = I18N_NODES.get(n);
  if(rec && cur === rec.ur) return;                  // already Urdu
  const core = cur.replace(/\s+/g, ' ').trim();
  if(!core) return;
  const ur = i18nTranslate(core);
  if(ur === null) return;
  const out = cur.match(/^\s*/)[0] + ur + cur.match(/\s*$/)[0];
  I18N_NODES.set(n, { en: cur, ur: out });
  n.nodeValue = out;
}
function i18nAttrsOf(el){
  I18N_ATTRS.forEach(a=>{
    const v = el.getAttribute(a);
    if(!v || el.getAttribute('data-ur-' + a) === v) return;
    const ur = i18nTranslate(v.trim());
    if(ur === null) return;
    el.setAttribute('data-en-' + a, v);
    el.setAttribute('data-ur-' + a, ur);
    el.setAttribute(a, ur);
  });
}
function i18nWalk(root){
  const w = document.createTreeWalker(root, 1 | 4, null);   // elements and text
  let n;
  while((n = w.nextNode())){
    if(n.nodeType === 3){ if(!i18nSkipNode(n.parentElement)) i18nTextNode(n); }
    else if(!/^(SCRIPT|STYLE)$/.test(n.tagName)) i18nAttrsOf(n);
  }
}
function i18nRestore(root){
  const w = document.createTreeWalker(root, 1 | 4, null);
  let n;
  while((n = w.nextNode())){
    if(n.nodeType === 3){
      const rec = I18N_NODES.get(n);
      if(rec && n.nodeValue === rec.ur) n.nodeValue = rec.en;
    } else {
      I18N_ATTRS.forEach(a=>{
        const ur = n.getAttribute('data-ur-' + a);
        if(ur === null) return;
        if(n.getAttribute(a) === ur) n.setAttribute(a, n.getAttribute('data-en-' + a));
        n.removeAttribute('data-ur-' + a); n.removeAttribute('data-en-' + a);
      });
    }
  }
}
function i18nObserve(){
  if(!I18N_OBS) I18N_OBS = new MutationObserver(i18nSchedule);
  I18N_OBS.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS });
}
function i18nRun(){
  if(!document.body) return;
  if(I18N_OBS) I18N_OBS.disconnect();               // our own changes must not wake the observer
  try{ i18nWalk(document.body); }catch(e){ console.error(e); }
  i18nObserve();
}
function i18nSchedule(){
  if(I18N_LANG !== 'ur' || I18N_TIMER) return;
  I18N_TIMER = setTimeout(()=>{ I18N_TIMER = 0; i18nRun(); }, 30);
}
function i18nButtonLabel(){
  const b = document.getElementById('langBtn');
  if(b) b.textContent = I18N_LANG === 'ur' ? 'English' : 'اردو';
}
function i18nSetLang(l){
  I18N_LANG = (l === 'ur') ? 'ur' : 'en';
  try{ localStorage.setItem(I18N_KEY, I18N_LANG); }catch(e){ /* the choice just will not be remembered */ }
  document.documentElement.setAttribute('lang', I18N_LANG);
  i18nButtonLabel();
  if(I18N_LANG === 'ur') i18nRun();
  else {
    if(I18N_OBS) I18N_OBS.disconnect();
    try{ i18nRestore(document.body); }catch(e){ console.error(e); }
  }
}
function i18nInit(){
  const css = document.createElement('style');
  css.textContent =
    'html[lang="ur"] body,html[lang="ur"] button,html[lang="ur"] input,html[lang="ur"] select,html[lang="ur"] textarea{font-family:"Noto Naskh Arabic","Geeza Pro","Segoe UI",Tahoma,sans-serif}' +
    'html[lang="ur"] label,html[lang="ur"] h1,html[lang="ur"] h2,html[lang="ur"] h3,html[lang="ur"] p,html[lang="ur"] th,html[lang="ur"] .note,html[lang="ur"] .group-label,html[lang="ur"] .sub{unicode-bidi:plaintext}' +
    '#langBtn{position:relative;font-size:14px;font-weight:700;line-height:18px;min-height:0;height:auto;padding:2px 14px;margin:0;border-radius:20px;pointer-events:auto}' +
    '#langBtn::after{content:"";position:absolute;inset:-10px -8px}' +
    'html[lang=\"ur\"] label,html[lang=\"ur\"] p,html[lang=\"ur\"] th,html[lang=\"ur\"] td,html[lang=\"ur\"] .note,html[lang=\"ur\"] .legend,html[lang=\"ur\"] .chip,html[lang=\"ur\"] .stat .label,html[lang=\"ur\"] .ov-kpi .label{font-size:1.12em;line-height:1.9}' +
    'html[lang=\"ur\"] h2,html[lang=\"ur\"] h3{line-height:1.7}' +
    'html[lang=\"ur\"] input,html[lang=\"ur\"] select,html[lang=\"ur\"] textarea{font-size:1.08em;line-height:1.6}';
  document.head.appendChild(css);
  const meta = document.querySelector('.appbar-meta');
  if(meta){
    const b = document.createElement('button');
    b.id = 'langBtn'; b.type = 'button'; b.className = 'ghost'; b.setAttribute('data-no-i18n', '');
    b.setAttribute('aria-label', 'Language');
    b.addEventListener('click', ()=> i18nSetLang(I18N_LANG === 'ur' ? 'en' : 'ur'));
    meta.insertBefore(b, meta.firstChild);
  }
  let saved = 'en';
  try{ saved = localStorage.getItem(I18N_KEY) === 'ur' ? 'ur' : 'en'; }catch(e){ /* default English */ }
  i18nSetLang(saved);
}
if(typeof document !== 'undefined' && document.body){ i18nInit(); }
