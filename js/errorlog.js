/* Error log + diagnostics. Loaded first. Keeps the last 50 errors on this phone (no ledger data, only
 * messages), so a "silent" failure can be seen later: Backup & Restore > Copy diagnostics. */
const ERRLOG_KEY = 'khata-errors';
function logErr(ctx, e){
  try{
    const a = JSON.parse(localStorage.getItem(ERRLOG_KEY) || '[]');
    a.push({t: new Date().toISOString(), c: String(ctx || ''), m: String((e && e.message) || e).slice(0, 300),
      s: String((e && e.stack) || '').split('\n').slice(0, 3).join(' | ').slice(0, 300)});
    while(a.length > 50) a.shift();
    localStorage.setItem(ERRLOG_KEY, JSON.stringify(a));
  }catch(_){ /* logging must never cause an error */ }
}
function diagnosticsText(){
  const meta = document.querySelector('meta[name="app-build"]');
  let errs = '[]'; try{ errs = localStorage.getItem(ERRLOG_KEY) || '[]'; }catch(_){}
  return ['Build: ' + (meta ? meta.content : '?'), 'Online: ' + navigator.onLine, 'Agent: ' + navigator.userAgent,
    'Storage: ' + (typeof LEDGER_BACKEND !== 'undefined' ? LEDGER_BACKEND : '?') + ', ' + (typeof LEDGER_CHARS !== 'undefined' ? LEDGER_CHARS : '?') + ' chars',
    'Errors: ' + errs].join('\n');
}
if(typeof window !== 'undefined'){
  window.addEventListener('error', ev => logErr('error ' + String(ev.filename || '').split('/').pop() + ':' + ev.lineno, ev.error || ev.message));
  window.addEventListener('unhandledrejection', ev => logErr('promise', ev.reason));
  document.addEventListener('click', async ev => {
    if(!ev.target.closest || !ev.target.closest('#diag_copy')) return;
    try{ await navigator.clipboard.writeText(diagnosticsText()); showToast('Diagnostics copied'); }
    catch(e){ try{ window.prompt('Copy this:', diagnosticsText()); }catch(_){} }
  });
}
