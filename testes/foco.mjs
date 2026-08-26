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
await new Promise(r => srv.listen(8813, r));

let falhas = 0;
const OK = m => console.log('  ok    ' + m);
const NO = m => { falhas++; console.log('  FALHA ' + m); };

const nav = await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });

// o cenario real: o dedo toca o campo, o navegador rola ate ele.
// o campo tem de ficar inteiramente visivel, abaixo do cabecalho fixo.
for (const L of [{n:'iPhone SE',w:320,h:568},{n:'iPhone 13',w:390,h:844},{n:'Android XL',w:430,h:932}]) {
  console.log(`\n${L.n} (${L.w}x${L.h})`);
  const ctx = await nav.newContext({ viewport:{width:L.w,height:L.h}, deviceScaleFactor:2, permissions:['camera'] });
  const pg = await ctx.newPage();
  await pg.goto('http://localhost:8813/index.html', { waitUntil:'networkidle' });
  await pg.evaluate(() => localStorage.clear());
  await pg.reload({ waitUntil:'networkidle' });
  await pg.waitForTimeout(700);
  await pg.locator('#listaExec button', { hasText:'Leonardo Santos' }).click();
  await pg.waitForTimeout(1700);
  await pg.locator('#btnManual').click(); await pg.waitForTimeout(500);

  const campos = ['#fNome','#fEmpresa','#fCargo','#fEmail','#fTel','#fObs'];
  const ruins = [];
  for (const sel of campos) {
    await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.waitForTimeout(120);
    await pg.locator(sel).scrollIntoViewIfNeeded();
    await pg.locator(sel).focus();
    await pg.waitForTimeout(320);
    const r = await pg.evaluate(s => {
      const el = document.querySelector(s);
      const c = el.getBoundingClientRect();
      const h = document.querySelector('header').getBoundingClientRect();
      const rot = document.querySelector('label[for="' + el.id + '"]');
      const rc = rot ? rot.getBoundingClientRect() : null;
      return {
        campoTop: Math.round(c.top), campoBottom: Math.round(c.bottom),
        headerBottom: Math.round(h.bottom), janela: window.innerHeight,
        rotuloTop: rc ? Math.round(rc.top) : null,
      };
    }, sel);
    const campoOk = r.campoTop >= r.headerBottom && r.campoBottom <= r.janela;
    const rotuloOk = r.rotuloTop === null || r.rotuloTop >= r.headerBottom;
    if (!campoOk || !rotuloOk) {
      ruins.push(`${sel} (campo ${r.campoTop}→${r.campoBottom}, rotulo em ${r.rotuloTop}, cabecalho ate ${r.headerBottom}, janela ${r.janela})`);
    }
  }
  ruins.length
    ? ruins.forEach(x => NO('ao focar, fica obstruido: ' + x))
    : OK(`os ${campos.length} campos ficam visiveis e livres ao receber foco`);

  // chips de qualificacao tambem precisam ser alcancaveis
  await pg.locator('#cRamo').scrollIntoViewIfNeeded();
  await pg.waitForTimeout(300);
  const chip = await pg.evaluate(() => {
    const c = document.querySelector('#cRamo').getBoundingClientRect();
    const h = document.querySelector('header').getBoundingClientRect();
    return { top: Math.round(c.top), hb: Math.round(h.bottom) };
  });
  chip.top >= chip.hb ? OK('grupo de qualificacao livre do cabecalho')
                      : NO(`chips sob o cabecalho (topo ${chip.top}, cabecalho ate ${chip.hb})`);
  await ctx.close();
}

console.log('\n' + (falhas ? `${falhas} FALHA(S)` : 'nenhum campo fica obstruido ao receber foco'));
await nav.close(); srv.close();
process.exit(falhas ? 1 : 0);
