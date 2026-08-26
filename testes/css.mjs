import { chromium, devices } from 'playwright';
import { loadImage, createCanvas } from 'canvas';
import http from 'http'; import fs from 'fs'; import path from 'path';

const RAIZ = '/Users/marcoscosta/projuris-summit-2026/app';
const T = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.png':'image/png' };
const srv = http.createServer((rq, rs) => {
  const u = decodeURIComponent(rq.url.split('?')[0]);
  const p = path.join(RAIZ, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(p)) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'text/plain' }); rs.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(8804, r));

let ok = 0, bad = 0;
const OK = m => { ok++; console.log('  OK    ' + m); };
const NO = m => { bad++; console.log('  FALHA ' + m); };

// ---- 1) toda variavel CSS usada esta declarada ----
console.log('1) Variaveis CSS');
const html = fs.readFileSync(RAIZ + '/index.html', 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const declaradas = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const usadas = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]));
const orfas = [...usadas].filter(v => !declaradas.has(v));
console.log('   declaradas: ' + [...declaradas].join(' '));
console.log('   usadas: ' + usadas.size);
orfas.length ? NO('variaveis usadas mas NAO declaradas: ' + orfas.join(', '))
             : OK('todas as ' + usadas.size + ' variaveis usadas estao declaradas');

// ---- 2) cor realmente pintada na tela ----
console.log('\n2) Cores efetivamente pintadas (lidas do pixel)');
const nav = await chromium.launch({ args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
const ctx = await nav.newContext({ ...devices['iPhone 13'], permissions: ['camera'] });
const pg = await ctx.newPage();
await pg.goto('http://localhost:8804/index.html', { waitUntil: 'networkidle' });
await pg.waitForTimeout(800);

const D = '/private/tmp/claude-501/-Users-marcoscosta/37ce9c6d-f5db-460a-b544-227617310b33/scratchpad/';
await pg.screenshot({ path: D + 'check-fundo.png' });
const img = await loadImage(D + 'check-fundo.png');
const c = createCanvas(img.width, img.height); const cx = c.getContext('2d');
cx.drawImage(img, 0, 0);
// pixel numa area de fundo puro (abaixo do conteudo, longe de textos)
const px = cx.getImageData(Math.floor(img.width * 0.5), Math.floor(img.height * 0.92), 1, 1).data;
const cor = `rgb(${px[0]}, ${px[1]}, ${px[2]})`;
console.log('   pixel do fundo da pagina: ' + cor);
const escuro = (px[0] + px[1] + px[2]) / 3 < 80;
escuro ? OK('fundo escuro conforme o design (' + cor + ')')
       : NO('fundo NAO esta escuro: ' + cor + ' — texto claro ficaria ilegivel');

// contraste real texto x fundo pintado
const lum = a => { const [r,g,b] = a.map(v => { v/=255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); });
  return .2126*r + .7152*g + .0722*b; };
const razao = (a,b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05); };
const txt = [238, 243, 251];
const r = razao(txt, [px[0], px[1], px[2]]);
console.log('   contraste texto claro x fundo real: ' + r.toFixed(2) + ':1');
r >= 4.5 ? OK('legivel (minimo 4.5:1)') : NO('ILEGIVEL: ' + r.toFixed(2) + ':1');

// ---- 3) cartoes e chips tambem pintados ----
console.log('\n3) Superficies internas');
await pg.locator('#listaExec button', { hasText: 'Marcos Costa' }).click();
await pg.waitForTimeout(1200);
await pg.locator('#btnManual').click(); await pg.waitForTimeout(400);
const sup = await pg.evaluate(() => {
  const pega = s => { const el = document.querySelector(s); return el ? getComputedStyle(el).backgroundColor : null; };
  return { input: pega('#fNome'), chip: pega('#cRamo button'), botao: pega('#btnSalvar') };
});
for (const [nome, v] of Object.entries(sup)) {
  const transp = !v || v === 'rgba(0, 0, 0, 0)';
  transp ? NO(nome + ' sem cor de fundo (' + v + ')') : OK(nome + ' pintado: ' + v);
}

console.log('\n' + ok + ' passaram, ' + bad + ' falharam');
await nav.close(); srv.close();
process.exit(bad ? 1 : 0);
