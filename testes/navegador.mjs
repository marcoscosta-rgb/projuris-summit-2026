import { chromium, devices } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const RAIZ = '/Users/marcoscosta/projuris-summit-2026/app';
const TIPOS = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' };

const servidor = http.createServer((req, res) => {
  const p = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(RAIZ) || !fs.existsSync(p)) { res.writeHead(404); return res.end('nao encontrado'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(p)] || 'text/plain' });
  res.end(fs.readFileSync(p));
});
await new Promise(r => servidor.listen(8799, r));
const URL_APP = 'http://localhost:8799/index.html';

let falhas = 0, passou = 0;
const ok = m => { passou++; console.log('  OK    ' + m); };
const bad = m => { falhas++; console.log('  FALHA ' + m); };
const secao = t => console.log('\n' + t);

const navegador = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await navegador.newContext({
  ...devices['iPhone 13'],
  permissions: ['camera'],
  ignoreHTTPSErrors: true,
});
const pg = await ctx.newPage();

const errosConsole = [];
pg.on('console', m => { if (m.type() === 'error') errosConsole.push(m.text()); });
pg.on('pageerror', e => errosConsole.push('pageerror: ' + e.message));

// intercepta o envio ao HubSpot e guarda o que foi enviado
const enviados = [];
await pg.route('**/api.hsforms.com/**', async route => {
  enviados.push(JSON.parse(route.request().postData() || '{}'));
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{"inlineMessage":"ok"}' });
});

// o app so sincroniza com um formGuid real; injeta um de teste
await pg.addInitScript(() => {
  window.addEventListener('DOMContentLoaded', () => {
    if (window.PS26) window.PS26.formGuid = 'guid-de-teste-0000';
  });
});

secao('1) Carregamento');
await pg.goto(URL_APP, { waitUntil: 'networkidle' });
await pg.waitForTimeout(600);
(await pg.locator('#tExec.on').isVisible()) ? ok('abre na tela de escolha do executivo') : bad('nao abriu na tela do executivo');
const nBotoes = await pg.locator('#listaExec button').count();
nBotoes === 6 ? ok('os 6 executivos aparecem') : bad('esperava 6 executivos, apareceram ' + nBotoes);
errosConsole.length === 0 ? ok('nenhum erro no console') : bad('erros no console: ' + errosConsole.join(' | '));

secao('2) Identificacao do executivo');
await pg.locator('#listaExec button', { hasText: 'Larissa Cavalcante' }).click();
await pg.waitForTimeout(900);
const cab = await pg.locator('#hExec').textContent();
cab.includes('Larissa') ? ok('nome fixado no cabecalho: ' + cab) : bad('cabecalho errado: ' + cab);
const salvo = await pg.evaluate(() => localStorage.getItem('ps26.exec'));
salvo && salvo.includes('Larissa') ? ok('executivo persistido no aparelho') : bad('nao persistiu o executivo');
(await pg.locator('#tScan.on').isVisible()) ? ok('foi direto para a camera') : bad('nao foi para a camera');

secao('3) Camera');
await pg.waitForTimeout(1800);
const st = await pg.locator('#statusScan').textContent();
st.includes('Procurando') ? ok('camera iniciou e esta procurando QR') : bad('status da camera: ' + st.trim());

secao('4) Validacoes da ficha');
await pg.locator('#btnManual').click();
await pg.waitForTimeout(300);
let alerta = '';
pg.on('dialog', async d => { alerta = d.message(); await d.dismiss(); });
await pg.locator('#btnSalvar').click(); await pg.waitForTimeout(250);
alerta.includes('nome') ? ok('exige o nome') : bad('nao exigiu nome (alerta: ' + alerta + ')');
await pg.locator('#fNome').fill('Ana Paula Ribeiro');
alerta = ''; await pg.locator('#btnSalvar').click(); await pg.waitForTimeout(250);
alerta.includes('empresa') ? ok('exige a empresa') : bad('nao exigiu empresa (alerta: ' + alerta + ')');
await pg.locator('#fEmpresa').fill('Ribeiro Advogados');
alerta = ''; await pg.locator('#btnSalvar').click(); await pg.waitForTimeout(250);
alerta.includes('telefone') ? ok('exige e-mail ou telefone') : bad('aceitou lead sem contato (alerta: ' + alerta + ')');
await pg.locator('#fEmail').fill('ana@ribeiro');
alerta = ''; await pg.locator('#btnSalvar').click(); await pg.waitForTimeout(250);
alerta.includes('incompleto') ? ok('rejeita e-mail malformado') : bad('aceitou e-mail invalido (alerta: ' + alerta + ')');

secao('5) Captura completa');
await pg.locator('#fEmail').fill('ana@ribeiro.adv.br');
await pg.locator('#fCargo').fill('Sócia');
await pg.locator('#fTel').fill('11998877665');
await pg.locator('#cRamo button', { hasText: 'Escritório de Advocacia' }).click();
await pg.locator('#cFunc button', { hasText: '51-200' }).click();
await pg.locator('#cAssin button', { hasText: 'Sim' }).first().click();
await pg.waitForTimeout(200);
(await pg.locator('#wrapPlat').isVisible()) ? ok('campo "qual plataforma" aparece ao marcar Sim') : bad('campo da plataforma nao apareceu');
await pg.locator('#fPlat').fill('DocuSign');
await pg.locator('#cContr button', { hasText: '201-500' }).click();
await pg.locator('#fObs').fill('Reclamou do custo por envio. Retomar semana que vem.');
await pg.locator('#btnSalvar').click();
await pg.waitForTimeout(1200);
(await pg.locator('#tOk.on').isVisible()) ? ok('tela de confirmacao aparece') : bad('nao confirmou o salvamento');

secao('6) Envio ao HubSpot');
enviados.length === 1 ? ok('uma submissao enviada') : bad('submissoes enviadas: ' + enviados.length);
if (enviados.length) {
  const campos = {};
  enviados[0].fields.forEach(f => campos[f.name] = f.value);
  const esperado = {
    email: 'ana@ribeiro.adv.br', firstname: 'Ana', lastname: 'Paula Ribeiro',
    company: 'Ribeiro Advogados', jobtitle: 'Sócia', phone: '11998877665',
    ps26_captado_por: 'Larissa Cavalcante', ps26_contato_no_evento: 'Sim',
    ps26_origem_captura: 'Preenchimento manual', ps26_ramo: 'Escritório de Advocacia',
    ps26_funcionarios: '51-200', ps26_usa_assinatura: 'Sim',
    ps26_plataforma_atual: 'DocuSign', ps26_contratos_mes: '201-500',
    ps26_sem_email: 'Não',
  };
  let erros = [];
  for (const [k, v] of Object.entries(esperado)) if (campos[k] !== v) erros.push(k + '=' + JSON.stringify(campos[k]) + ' (esperado ' + JSON.stringify(v) + ')');
  erros.length ? bad('payload divergente: ' + erros.join('; ')) : ok('todos os ' + Object.keys(esperado).length + ' campos chegam corretos');
  campos.ps26_observacoes ? ok('observacoes do executivo vao junto') : bad('observacoes nao foram enviadas');
  campos.ps26_capturado_em ? ok('momento da captura registrado') : bad('sem momento de captura');
}

secao('7) Fila offline — a prova do evento');
await ctx.setOffline(true);
await pg.locator('#btnProximo').click(); await pg.waitForTimeout(400);
await pg.locator('#btnManual').click(); await pg.waitForTimeout(250);
await pg.locator('#fNome').fill('Carlos Souza');
await pg.locator('#fEmpresa').fill('Souza Contabilidade');
await pg.locator('#fTel').fill('11912345678');
await pg.locator('#btnSalvar').click();
await pg.waitForTimeout(900);
(await pg.locator('#tOk.on').isVisible()) ? ok('captura funciona SEM internet') : bad('perdeu a captura offline');
const badge = await pg.locator('#hFila').textContent();
badge.includes('fila') ? ok('contador mostra pendencia: "' + badge.trim() + '"') : bad('contador nao sinalizou fila: ' + badge);
enviados.length === 1 ? ok('nada foi enviado enquanto offline') : bad('tentou enviar offline');
const guardados = await pg.evaluate(() => JSON.parse(localStorage.getItem('ps26.fila') || '[]').length);
guardados === 2 ? ok('os 2 leads estao guardados no aparelho') : bad('leads guardados: ' + guardados);

secao('8) Sincronizacao ao voltar a internet');
await ctx.setOffline(false);
await pg.evaluate(() => window.dispatchEvent(new Event('online')));
await pg.waitForTimeout(1800);
enviados.length === 2 ? ok('lead pendente subiu sozinho ao voltar a rede') : bad('submissoes apos reconectar: ' + enviados.length);
if (enviados.length === 2) {
  const c = {}; enviados[1].fields.forEach(f => c[f.name] = f.value);
  c.ps26_sem_email === 'Sim' ? ok('lead sem e-mail marcado como tal') : bad('ps26_sem_email=' + c.ps26_sem_email);
  /@projuris-summit-2026\.invalid$/.test(c.email) ? ok('e-mail tecnico gerado: ' + c.email) : bad('e-mail gerado: ' + c.email);
  c.ps26_captado_por === 'Larissa Cavalcante' ? ok('executivo preservado na fila offline') : bad('executivo perdido: ' + c.ps26_captado_por);
}
const badge2 = await pg.locator('#hFila').textContent();
badge2.includes('enviados') ? ok('contador zera: "' + badge2.trim() + '"') : bad('contador apos sync: ' + badge2);

secao('9) Persistencia entre aberturas do app');
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1200);
const execDepois = await pg.locator('#hExec').textContent();
execDepois.includes('Larissa') ? ok('reabrir o app mantem o executivo') : bad('perdeu o executivo ao reabrir');
const filaDepois = await pg.evaluate(() => JSON.parse(localStorage.getItem('ps26.fila') || '[]').filter(l => l.enviado).length);
filaDepois === 2 ? ok('historico dos 2 leads preservado') : bad('historico apos reabrir: ' + filaDepois);

secao('10) Erros de console ao final');
const graves = errosConsole.filter(e => !/favicon|manifest|ServiceWorker|sw\.js/i.test(e));
graves.length === 0 ? ok('nenhum erro grave') : bad('erros: ' + graves.slice(0, 3).join(' | '));

console.log('\n' + '='.repeat(52));
console.log(passou + ' passaram, ' + falhas + ' falharam');
await navegador.close();
servidor.close();
process.exit(falhas ? 1 : 0);
