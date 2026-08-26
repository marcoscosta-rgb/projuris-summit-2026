import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';

const RAIZ = '/Users/marcoscosta/projuris-summit-2026/app';
const T = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.png':'image/png' };
const srv = http.createServer((rq, rs) => {
  const u = decodeURIComponent(rq.url.split('?')[0]);
  const p = path.join(RAIZ, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(p)) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'text/plain' }); rs.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(8811, r));
const D = '/private/tmp/claude-501/-Users-marcoscosta/37ce9c6d-f5db-460a-b544-227617310b33/scratchpad/';

let falhas = 0, avisos = 0;
const OK = m => console.log('    ok      ' + m);
const NO = m => { falhas++; console.log('    FALHA   ' + m); };
const WA = m => { avisos++; console.log('    atencao ' + m); };

const LARG = [
  { nome:'iPhone SE', w:320, h:568 },
  { nome:'iPhone 13', w:390, h:844 },
  { nome:'Android XL', w:430, h:932 },
];

const verifica = async (pg, rotulo, larguraTela) => {
  console.log('    -- ' + rotulo);
  // 1) texto picotado por flex/grid
  const pic = await pg.evaluate(() => {
    const r = [];
    for (const el of document.querySelectorAll('*')) {
      const d = getComputedStyle(el).display;
      if (!/^(inline-)?(flex|grid)$/.test(d)) continue;
      const solto = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (solto.length && el.children.length) {
        r.push({ t: el.tagName.toLowerCase() + (el.id ? '#'+el.id : el.className ? '.'+String(el.className).split(' ')[0] : ''),
                 d, s: solto[0].textContent.trim().slice(0,40) });
      }
    }
    return r;
  });
  pic.length ? pic.forEach(p => NO(`texto picotado em <${p.t}> (${p.d}) — "${p.s}…"`))
             : OK('sem texto picotado');

  // 2) rolagem lateral
  const rol = await pg.evaluate(() => ({ d: document.documentElement.scrollWidth, w: window.innerWidth }));
  rol.d <= rol.w + 1 ? OK(`sem rolagem lateral (${rol.d} ≤ ${rol.w})`)
                     : NO(`rola lateralmente: ${rol.d}px em ${rol.w}px`);

  // 3) elementos fora da tela
  const fora = await pg.evaluate(() => {
    const o = [];
    for (const el of document.querySelectorAll('.tela.on *, header *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        o.push({ t: el.tagName.toLowerCase() + (el.id ? '#'+el.id : ''), l: Math.round(r.left), r: Math.round(r.right) });
      }
    }
    return o.slice(0,4);
  });
  fora.length ? fora.forEach(f => NO(`<${f.t}> fora da tela (${f.l} → ${f.r})`)) : OK('nada fora da tela');

  // 4) alvos de toque
  const peq = await pg.evaluate(() => {
    const o = [];
    for (const el of document.querySelectorAll('.tela.on button, .tela.on a, .tela.on input, .tela.on textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.height < 40) o.push({ t: (el.textContent||el.id||'').trim().slice(0,24), h: Math.round(r.height) });
    }
    return o;
  });
  peq.length ? peq.forEach(p => WA(`alvo baixo ${p.h}px: "${p.t}"`)) : OK('alvos de toque ≥ 40px');

  // 5) contraste sobre a cor realmente pintada
  const ct = await pg.evaluate(() => {
    const lum = a => { const [r,g,b]=a.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);}); return .2126*r+.7152*g+.0722*b; };
    const pega = s => { const m=String(s).match(/rgba?\(([^)]+)\)/); return m?m[1].split(',').map(parseFloat).slice(0,3):null; };
    const fundo = el => { let n=el; while(n && n!==document.documentElement){ const bg=getComputedStyle(n).backgroundColor; const p=pega(bg); if(p && !/, *0\)$/.test(bg)) return p; n=n.parentElement; } return pega(getComputedStyle(document.body).backgroundColor) || [11,18,32]; };
    const raz = (a,b)=>{const L1=lum(a),L2=lum(b);return (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);};
    const out = [];
    for (const el of document.querySelectorAll('.tela.on h1, .tela.on h2, .tela.on p, .tela.on label, .tela.on .chip, .tela.on .mini, .tela.on .rodape, header b, header span, .badge, .leitura, .aviso, .card .rot, .card .val')) {
      const r0 = el.getBoundingClientRect(); if (!r0.width || !r0.height) continue;
      const cs = getComputedStyle(el); const c = pega(cs.color); if (!c) continue;
      const px = parseFloat(cs.fontSize);
      const grande = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
      const v = +raz(c, fundo(el)).toFixed(2);
      out.push({ t: el.tagName.toLowerCase()+(el.className?'.'+String(el.className).split(' ')[0]:''), v, min: grande?3:4.5, px: Math.round(px) });
    }
    return out;
  });
  const ruins = ct.filter(c => c.v < c.min);
  ruins.length ? ruins.slice(0,6).forEach(c => NO(`contraste ${c.v}:1 em ${c.t} (min ${c.min}, ${c.px}px)`))
               : OK(`contraste ok em ${ct.length} elementos (menor ${ct.length?Math.min(...ct.map(c=>c.v)):'-'}:1)`);
};

const nav = await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });

for (const L of LARG) {
  console.log(`\n  ${L.nome} (${L.w}px)`);
  const ctx = await nav.newContext({ viewport:{width:L.w,height:L.h}, deviceScaleFactor:2, permissions:['camera'] });
  const pg = await ctx.newPage();
  const erros = [];
  pg.on('pageerror', e => erros.push(e.message));
  await pg.goto('http://localhost:8811/index.html', { waitUntil:'networkidle' });
  await pg.evaluate(() => localStorage.clear());
  await pg.reload({ waitUntil:'networkidle' });
  await pg.waitForTimeout(800);

  await verifica(pg, 'tela: escolher executivo', L.w);
  await pg.screenshot({ path:`${D}app-${L.w}-1exec.png`, fullPage:true });

  await pg.locator('#listaExec button', { hasText:'Simone de Alencar Rodrigues' }).click();
  await pg.waitForTimeout(2000);
  await verifica(pg, 'tela: camera', L.w);
  await pg.screenshot({ path:`${D}app-${L.w}-2camera.png` });

  await pg.locator('#btnManual').click(); await pg.waitForTimeout(400);
  // simula o cenario real do cracha Sympla: so o codigo
  await pg.evaluate(() => {
    document.getElementById('boxCodigo').innerHTML =
      '<div class="card"><div class="rot">Código do crachá lido</div><div class="val">UT9UBBGC7L</div></div>';
    document.getElementById('avisoParse').innerHTML =
      '<div class="aviso w"><b>O crachá só trouxe o código.</b><br>Ele foi guardado e serve para cruzar com o mailing depois. Preencha nome e empresa — leva poucos segundos.</div>';
  });
  await pg.locator('#fNome').fill('Ana Paula Ribeiro');
  await pg.locator('#fEmpresa').fill('Ribeiro Advogados Associados');
  await pg.locator('#cRamo button', { hasText:'Escritório de Advocacia' }).click();
  await pg.waitForTimeout(300);
  await verifica(pg, 'tela: ficha do lead', L.w);
  await pg.screenshot({ path:`${D}app-${L.w}-3ficha.png`, fullPage:true });

  erros.length ? NO('erro de script: ' + erros[0]) : OK('sem erro de script');
  await ctx.close();
}

console.log('\n' + '='.repeat(56));
console.log(falhas ? `${falhas} FALHA(S), ${avisos} atencao(oes)` : `tudo passou (${avisos} atencao(oes))`);
await nav.close(); srv.close();
process.exit(falhas ? 1 : 0);
