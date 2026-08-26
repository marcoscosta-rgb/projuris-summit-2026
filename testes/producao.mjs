import { chromium, devices } from 'playwright';

const APP  = 'https://marcoscosta-rgb.github.io/projuris-summit-2026/app/';
const FORM = 'https://marcoscosta-rgb.github.io/projuris-summit-2026/form/';
const RAIZ = 'https://marcoscosta-rgb.github.io/projuris-summit-2026/';

let ok = 0, bad = 0;
const OK = m => { ok++; console.log('  OK    ' + m); };
const NO = m => { bad++; console.log('  FALHA ' + m); };

const nav = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await nav.newContext({ ...devices['iPhone 13'], permissions: ['camera'] });
const pg = await ctx.newPage();
const erros = [];
pg.on('pageerror', e => erros.push(e.message));
pg.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });

console.log('1) Redirecionamento da raiz');
await pg.goto(RAIZ, { waitUntil: 'networkidle', timeout: 60000 });
await pg.waitForTimeout(1500);
pg.url().includes('/app/') ? OK('raiz leva ao leitor: ' + pg.url()) : NO('raiz foi para ' + pg.url());

console.log('\n2) Carregamento do app em producao');
await pg.waitForTimeout(1200);
(await pg.locator('#tExec.on').isVisible()) ? OK('tela inicial visivel') : NO('tela inicial nao apareceu');
(await pg.locator('#listaExec button').count()) === 6 ? OK('6 executivos listados') : NO('lista de executivos errada');
(await pg.evaluate(() => typeof window.jsQR)) === 'function' ? OK('jsQR carregado do proprio site (offline-safe)') : NO('jsQR nao carregou');
const cfg = await pg.evaluate(() => window.PS26 && window.PS26.formGuid);
cfg === '7516a8ea-ce4d-4ac7-8084-39322536b259' ? OK('ligado ao formulario correto') : NO('formGuid=' + cfg);

console.log('\n3) Instalavel no celular (PWA)');
const man = await pg.evaluate(async () => {
  const l = document.querySelector('link[rel="manifest"]');
  if (!l) return null;
  const r = await fetch(l.href); return r.ok ? await r.json() : null;
});
man && man.name ? OK('manifest valido: "' + man.short_name + '"') : NO('manifest ausente ou invalido');
const sw = await pg.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r).catch(() => false));
sw ? OK('service worker registrado — funciona offline') : NO('service worker nao registrou');

console.log('\n4) Camera');
await pg.locator('#listaExec button', { hasText: 'Marcos Costa' }).click();
await pg.waitForTimeout(2500);
const st = (await pg.locator('#statusScan').textContent()).trim();
st.includes('Procurando') ? OK('camera ativa procurando QR') : NO('camera: ' + st);

console.log('\n5) Captura e envio REAL ao HubSpot');
await pg.locator('#btnManual').click(); await pg.waitForTimeout(400);
const marca = 'PROD-' + Date.now().toString().slice(-6);
await pg.locator('#fNome').fill('Verificacao Producao');
await pg.locator('#fEmpresa').fill('Teste ' + marca);
await pg.locator('#fCargo').fill('Validacao');
await pg.locator('#fEmail').fill('verifica.' + marca.toLowerCase() + '@exemplo-d4sign-teste.com');
await pg.locator('#cRamo button', { hasText: 'Tecnologia' }).click();
await pg.locator('#cFunc button', { hasText: '11-50' }).click();
await pg.locator('#btnSalvar').click();
await pg.waitForTimeout(6000);
(await pg.locator('#tOk.on').isVisible()) ? OK('lead salvo') : NO('nao confirmou salvamento');
const badge = (await pg.locator('#hFila').textContent()).trim();
badge.includes('enviado') ? OK('enviado ao HubSpot de verdade: "' + badge + '"') : NO('badge: ' + badge);
console.log('     marcador para conferir no CRM: ' + marca);

console.log('\n6) Fila offline em producao');
await ctx.setOffline(true);
await pg.locator('#btnProximo').click(); await pg.waitForTimeout(400);
await pg.locator('#btnManual').click(); await pg.waitForTimeout(300);
await pg.locator('#fNome').fill('Teste Offline');
await pg.locator('#fEmpresa').fill('Sem Rede');
await pg.locator('#fEmail').fill('offline.' + marca.toLowerCase() + '@exemplo-d4sign-teste.com');
await pg.locator('#btnSalvar').click(); await pg.waitForTimeout(1200);
(await pg.locator('#tOk.on').isVisible()) ? OK('captura funciona sem internet') : NO('perdeu captura offline');
const b2 = (await pg.locator('#hFila').textContent()).trim();
b2.includes('na fila') ? OK('sinaliza pendencia: "' + b2 + '"') : NO('badge offline: ' + b2);
await ctx.setOffline(false);

console.log('\n7) Pagina de fallback com o formulario');
const pg2 = await ctx.newPage();
await pg2.goto(FORM, { waitUntil: 'networkidle', timeout: 60000 });
await pg2.waitForTimeout(6000);
let alvo = pg2;
for (const f of pg2.frames()) { if (await f.locator('input,select').count() > 3) { alvo = f; break; } }
const campos = await alvo.evaluate(() => [...document.querySelectorAll('input,select,textarea')]
  .filter(e => e.type !== 'hidden').map(e => e.name || e.id));
console.log('     campos renderizados: ' + campos.length);
campos.length >= 13 ? OK('formulario embutido renderiza (' + campos.length + ' campos)') : NO('so ' + campos.length + ' campos');
campos.some(c => String(c).includes('ps26_captado_por')) ? OK('campo do executivo presente') : NO('sem campo de executivo');
await pg2.screenshot({ path: '/private/tmp/claude-501/-Users-marcoscosta/37ce9c6d-f5db-460a-b544-227617310b33/scratchpad/prod-form.png', fullPage: true });

console.log('\n8) Erros de console');
const graves = erros.filter(e => !/favicon|Failed to load resource.*404/i.test(e));
graves.length === 0 ? OK('sem erros graves') : NO('erros: ' + graves.slice(0, 3).join(' | '));

await pg.screenshot({ path: '/private/tmp/claude-501/-Users-marcoscosta/37ce9c6d-f5db-460a-b544-227617310b33/scratchpad/prod-app.png' });
console.log('\n' + ok + ' passaram, ' + bad + ' falharam');
await nav.close();
process.exit(bad ? 1 : 0);
