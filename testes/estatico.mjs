import fs from 'fs';
import vm from 'vm';

const P = '/Users/marcoscosta/projuris-summit-2026/app/index.html';
const html = fs.readFileSync(P, 'utf8');

let falhas = 0;
const ok = m => console.log('  OK  ' + m);
const bad = m => { console.log('  FALHA  ' + m); falhas++; };

// ---- 1) sintaxe do JS inline ----
const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('1) Sintaxe do JavaScript');
console.log('   blocos inline encontrados: ' + blocos.length);
blocos.forEach((b, i) => {
  try { new vm.Script(b); ok('bloco ' + (i + 1) + ' compila (' + b.length + ' chars)'); }
  catch (e) { bad('bloco ' + (i + 1) + ': ' + e.message); }
});

// ---- 2) todo id usado pelo JS existe no HTML ----
console.log('\n2) Referencias de DOM');
const idsHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const usados = new Set([...html.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map(m => m[1]));
const faltando = [...usados].filter(i => !idsHtml.has(i));
console.log('   ids no HTML: ' + idsHtml.size + ' | ids usados pelo JS: ' + usados.size);
if (faltando.length) bad('ids inexistentes: ' + faltando.join(', '));
else ok('todo id usado pelo JS existe no HTML');

// ---- 3) telas declaradas x telas navegaveis ----
console.log('\n3) Telas');
const telasHtml = [...html.matchAll(/class="tela[^"]*" id="(\w+)"/g)].map(m => m[1]);
const mt = html.match(/\['tExec','tScan','tFicha','tOk','tFila'\]/);
console.log('   telas no HTML: ' + telasHtml.join(', '));
if (!mt) bad('lista de telas do roteador nao encontrada');
else {
  const roteador = ['tExec', 'tScan', 'tFicha', 'tOk', 'tFila'];
  const semRota = telasHtml.filter(t => !roteador.includes(t));
  const semTela = roteador.filter(t => !telasHtml.includes(t));
  if (semRota.length) bad('telas sem rota: ' + semRota.join(', '));
  else if (semTela.length) bad('rotas sem tela: ' + semTela.join(', '));
  else ok('as ' + roteador.length + ' telas batem com o roteador');
}

// ---- 4) campos do formulario que serao enviados ao HubSpot ----
console.log('\n4) Campos enviados ao HubSpot');
const campos = [...html.matchAll(/add\('([a-z0-9_]+)'/g)].map(m => m[1]);
const unicos = [...new Set(campos)];
console.log('   ' + unicos.length + ' campos: ' + unicos.join(', '));
const nativos = ['email', 'firstname', 'lastname', 'company', 'jobtitle', 'phone'];
const custom = unicos.filter(c => !nativos.includes(c));
if (custom.every(c => c.startsWith('ps26_'))) ok('todos os campos customizados usam o prefixo ps26_');
else bad('campos customizados fora do padrao: ' + custom.filter(c => !c.startsWith('ps26_')).join(', '));
fs.writeFileSync('/private/tmp/claude-501/-Users-marcoscosta/37ce9c6d-f5db-460a-b544-227617310b33/scratchpad/campos.json',
  JSON.stringify({ nativos: unicos.filter(c => nativos.includes(c)), custom }, null, 2));

// ---- 5) assets referenciados existem ----
console.log('\n5) Arquivos referenciados');
const dir = '/Users/marcoscosta/projuris-summit-2026/app/';
const refs = [...html.matchAll(/(?:src|href)="(?!https?:|data:)([^"]+)"/g)].map(m => m[1]);
[...new Set(refs)].forEach(r => {
  fs.existsSync(dir + r) ? ok(r + ' existe') : bad(r + ' NAO existe');
});

// ---- 6) o service worker cacheia tudo que o app usa ----
console.log('\n6) Cobertura offline (service worker)');
const sw = fs.readFileSync(dir + 'sw.js', 'utf8');
const cacheados = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
const precisa = [...new Set(refs)];
const naoCacheado = precisa.filter(r => !cacheados.includes(r));
console.log('   no cache: ' + cacheados.join(', '));
if (naoCacheado.length) bad('usado mas nao cacheado: ' + naoCacheado.join(', '));
else ok('todo arquivo usado pelo app esta no cache offline');

console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'TUDO PASSOU'));
process.exit(falhas ? 1 : 0);
