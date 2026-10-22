'use strict';
/* Dark mode readability (v3.19.1): the coral-red, amber and chart colours must stay readable on the dark card/paper,
   and the old literal dark red / amber that failed on black must not come back. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function lum(hex){
  const n = hex.replace('#',''); const c = [0,2,4].map(i => parseInt(n.slice(i,i+2),16)/255)
    .map(v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4));
  return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
}
const ratio = (a,b) => { const [x,y] = [lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
// the LAST dark declaration of a token wins in the stylesheet, so read the last one
function darkToken(name){
  const re = new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})', 'g'); const blocks = [];
  const start = html.indexOf(':root[data-theme="dark"]{');
  const part = html.slice(start, html.indexOf('html[data-theme="dark"]{ background'));
  let m; while((m = re.exec(part))) blocks.push(m[1]); return blocks.pop();
}

test('dark text colours are readable on the card and the page (WCAG AA 4.5:1)', () => {
  for(const t of ['red','amber','gold','green','gx-teal','gx-blue','gx-purple','gx-ochre','gx-grey','ink-soft']){
    const c = darkToken(t); assert.ok(c, t + ' has a dark value');
    assert.ok(ratio(c,'#1E2327') >= 4.5, t + ' ' + c + ' on card = ' + ratio(c,'#1E2327').toFixed(2));
    assert.ok(ratio(c,'#15181B') >= 4.5, t + ' ' + c + ' on paper');
  }
});
test('red text also reads on the red-tinted delete chip, and white reads on the deep-red fill', () => {
  assert.ok(ratio(darkToken('red'), darkToken('tonal-del')) >= 4.5);
  assert.ok(ratio('#FFFFFF', darkToken('red-solid')) >= 4.5);
});
test('the pale salmon red is gone from dark mode', () => {
  assert.notEqual(darkToken('red').toUpperCase(), '#EE9186');
  assert.ok(!/#EE9186/i.test(html));
});
test('chart series hues are distinct (no two chart colours within a tiny RGB distance)', () => {
  const names = ['gx-teal','gold','green','gx-blue','gx-purple','gx-ochre','gx-grey','red'];
  const rgb = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16));
  for(let i=0;i<names.length;i++) for(let j=i+1;j<names.length;j++){
    const a = rgb(darkToken(names[i])), b = rgb(darkToken(names[j]));
    const d = Math.sqrt(a.reduce((s,v,k)=>s+(v-b[k])**2,0));
    assert.ok(d > 60, names[i] + ' vs ' + names[j] + ' distance ' + d.toFixed(0));
  }
});
test('literal dark-unfriendly colours have dark overrides', () => {
  assert.match(html, /:root\[data-theme="dark"\] \.field-err\{ color:var\(--danger\)/);
  assert.match(html, /:root\[data-theme="dark"\] :is\(\.stat \.value\.adv[^}]*color:var\(--amber\)/);
  assert.match(html, /:root\[data-theme="dark"\] #graphs_root \.gx-grp\.sel \.gx-selbg\{ opacity:\.14/);
});
