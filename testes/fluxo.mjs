import { chromium, devices } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';

const RAIZ = '/Users/marcoscosta/projuris-summit-2026/app';
const T = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.png':'image/png' };
const srv = http.createServer((rq, rs) => {
  const u = decodeURIComponent(rq.url.split('?')[0]);
  const p = path.join(RAIZ, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(p)) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'text/plain' }); rs.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(8820, r));

let ok = 0, bad = 0;
const OK = m => { ok++; console.log('  ok    ' + m); };
const NO = m => { bad++; console.log('  FALHA ' + m); };

const nav = await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
const ctx = await nav.newContext({ ...devices['iPhone 13'], permissions:['camera'] });
const pg = await ctx.newPage();
const erros = [];
pg.on('pageerror', e => erros.push(e.message));
pg.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });

const enviados = [];
await pg.route('**/api.hsforms.com/**', async r => {
  enviados.push(JSON.parse(r.request().postData() || '{}'));
  await r.fulfill({ status:200, contentType:'application/json', body:'{"inlineMessage":"ok"}' });
});
await pg.addInitScript(() => {
  window.addEventListener('DOMContentLoaded', () => { if (window.PS26) window.PS26.formGuid = 'teste-0000'; });
});

await pg.goto('http://localhost:8820/index.html', { waitUntil:'networkidle' });
await pg.evaluate(() => localStorage.clear());
await pg.reload({ waitUntil:'networkidle' });
await pg.waitForTimeout(800);

console.log('1) Escolher executivo leva direto ao preenchimento');
await pg.locator('#listaExec button', { hasText:'Marcos Costa' }).click();
await pg.waitForTimeout(900);
(await pg.locator('#tFicha.on').isVisible()) ? OK('abre a ficha, sem passar pela camera') : NO('nao abriu a ficha');
(await pg.locator('#tScan.on').count()) === 0 ? OK('tela de camera nao aparece') : NO('camera apareceu no caminho');
(await pg.locator('#fNome').isVisible()) ? OK('campo de nome pronto para digitar') : NO('campo de nome ausente');

console.log('\n2) Captação completa');
await pg.locator('#fNome').fill('Ana Paula Ribeiro');
await pg.locator('#fEmpresa').fill('Ribeiro Advogados');
await pg.locator('#fEmail').fill('ana@ribeiro.adv.br');
await pg.locator('#cRamo button', { hasText:'Escritório de Advocacia' }).click();
await pg.locator('#btnSalvar').click();
await pg.waitForTimeout(1500);
(await pg.locator('#tOk.on').isVisible()) ? OK('lead salvo') : NO('nao salvou');
enviados.length === 1 ? OK('enviado ao HubSpot') : NO('envios: ' + enviados.length);
if (enviados.length) {
  const c = {}; enviados[0].fields.forEach(f => c[f.name] = f.value);
  c.ps26_captado_por === 'Marcos Costa' ? OK('carimbado: ' + c.ps26_captado_por) : NO('captado_por=' + c.ps26_captado_por);
  c.ps26_origem_captura === 'Preenchimento manual' ? OK('origem correta') : NO('origem=' + c.ps26_origem_captura);
}

console.log('\n3) Próximo lead abre ficha limpa (sem câmera no meio)');
await pg.locator('#btnProximo').click();
await pg.waitForTimeout(800);
(await pg.locator('#tFicha.on').isVisible()) ? OK('volta direto para a ficha') : NO('nao voltou para a ficha');
(await pg.locator('#fNome').inputValue()) === '' ? OK('campos limpos') : NO('campo veio preenchido');

console.log('\n4) Câmera segue acessível para cartão de visita');
(await pg.locator('#btnLerQR').isVisible()) ? OK('botao de ler QR disponivel na ficha') : NO('botao de QR sumiu');
await pg.locator('#btnLerQR').click();
await pg.waitForTimeout(2000);
(await pg.locator('#tScan.on').isVisible()) ? OK('abre a camera quando pedido') : NO('camera nao abriu');
await pg.locator('#btnManual').click(); await pg.waitForTimeout(600);
(await pg.locator('#tFicha.on').isVisible()) ? OK('volta da camera para a ficha') : NO('nao voltou');

console.log('\n5) Fila acessível pela ficha');
(await pg.locator('#btnFila2').isVisible()) ? OK('botao de pendentes na ficha') : NO('sem acesso a fila');
await pg.locator('#btnFila2').click(); await pg.waitForTimeout(700);
(await pg.locator('#tFila.on').isVisible()) ? OK('abre a lista de pendentes') : NO('lista nao abriu');
await pg.locator('#btnVoltarScan').click(); await pg.waitForTimeout(700);
(await pg.locator('#tFicha.on').isVisible()) ? OK('volta para a ficha') : NO('nao voltou da fila');

console.log('\n6) Reabrir o app');
await pg.reload({ waitUntil:'networkidle' });
await pg.waitForTimeout(1200);
(await pg.locator('#tFicha.on').isVisible()) ? OK('reabre direto na ficha') : NO('nao reabriu na ficha');
(await pg.locator('#hExec').textContent()).includes('Marcos') ? OK('executivo mantido') : NO('perdeu o executivo');

const graves = erros.filter(e => !/favicon|manifest|sw\.js/i.test(e));
graves.length === 0 ? OK('sem erro de script') : NO('erros: ' + graves.slice(0,2).join(' | '));

console.log('\n' + ok + ' passaram, ' + bad + ' falharam');
await nav.close(); srv.close();
process.exit(bad ? 1 : 0);
