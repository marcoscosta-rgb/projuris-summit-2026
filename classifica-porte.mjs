/**
 * Classifica o porte da empresa em cada negócio do pipeline do evento.
 *
 * Por que existe: a distribuição dos leads do mailing prioriza empresas
 * maiores, e o time precisa enxergar o porte direto no pipeline para
 * priorizar o follow-up. O dado vem do número de funcionários da empresa
 * associada, que o HubSpot mantém enriquecido.
 *
 * Quando o contato não tem empresa associada no CRM, tentamos casar pelo
 * nome da empresa que a pessoa declarou na inscrição — é o caso de quem se
 * inscreveu com e-mail pessoal e por isso não foi associado automaticamente.
 *
 * Uso:  HUBSPOT_TOKEN=... node classifica-porte.mjs [--simular]
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }
const SIMULAR = process.argv.includes('--simular');

const BASE = 'https://api.hubapi.com';
const PIPELINE = '929744040';
const GRUPO = 'projuris_summit_2026';

const FAIXAS = [
  { ate: 50,    rotulo: '1-50' },
  { ate: 200,   rotulo: '51-200' },
  { ate: 1000,  rotulo: '201-1000' },
  { ate: 5000,  rotulo: '1001-5000' },
  { ate: Infinity, rotulo: '5000+' },
];
const faixaDe = n => FAIXAS.find(f => n <= f.ate).rotulo;

async function api(metodo, caminho, corpo, tentativa = 0) {
  const res = await fetch(BASE + caminho, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (res.status === 429 && tentativa < 5) {
    await new Promise(r => setTimeout(r, 2000 * (tentativa + 1)));
    return api(metodo, caminho, corpo, tentativa + 1);
  }
  const txt = await res.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: res.ok, status: res.status, json, txt };
}
const pedacos = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const normaliza = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(ltda|s\/a|sa|s a|eireli|me|epp|do brasil|brasil|group|grupo|inc|holding)\b/g, '')
  .replace(/[^a-z0-9]/g, '').trim();

/* ---------- garante a propriedade de porte no negócio ---------- */
const criar = await api('POST', '/crm/v3/properties/deals', {
  name: 'ps26_porte_empresa',
  label: 'PS26 · Porte da empresa',
  type: 'enumeration', fieldType: 'select',
  groupName: 'dealinformation',
  description: 'Faixa de funcionários da empresa do lead, usada para priorizar o follow-up.',
  options: [...FAIXAS.map((f, i) => ({ label: f.rotulo, value: f.rotulo, displayOrder: i })),
            { label: 'Não informado', value: 'Não informado', displayOrder: 9 }],
});
console.log(criar.ok ? 'Propriedade de porte criada.'
  : criar.status === 409 ? 'Propriedade de porte já existia.'
  : 'Falha ao criar propriedade: ' + criar.status + ' ' + criar.txt.slice(0, 200));

/* ---------- catálogo de empresas com porte conhecido ---------- */
let apos, empresas = [];
do {
  const r = await api('POST', '/crm/v3/objects/companies/search', {
    filterGroups: [{ filters: [{ propertyName: 'numberofemployees', operator: 'HAS_PROPERTY' }] }],
    properties: ['name', 'numberofemployees'], limit: 100, ...(apos ? { after: apos } : {}),
  });
  if (!r.ok) break;
  empresas.push(...(r.json.results || []));
  apos = r.json.paging?.next?.after;
} while (apos);
const porNome = new Map();
for (const e of empresas) {
  const k = normaliza(e.properties.name);
  const n = parseInt(e.properties.numberofemployees || '0', 10);
  if (!k || !n) continue;
  if (!porNome.has(k) || n > porNome.get(k)) porNome.set(k, n);
}
console.log('Empresas com porte conhecido no CRM: ' + porNome.size);

/* ---------- negócios do pipeline e seus contatos ---------- */
let apos2, negocios = [];
do {
  const r = await api('POST', '/crm/v3/objects/deals/search', {
    filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: PIPELINE }] }],
    properties: ['dealname', 'ps26_porte_empresa'], limit: 100, ...(apos2 ? { after: apos2 } : {}),
  });
  if (!r.ok) { console.error('Busca de negócios falhou: ' + r.status); process.exit(1); }
  negocios.push(...(r.json.results || []));
  apos2 = r.json.paging?.next?.after;
} while (apos2);
console.log('Negócios no pipeline: ' + negocios.length);

const contatoDoNegocio = new Map();
for (const bloco of pedacos(negocios.map(d => d.id), 100)) {
  const r = await api('POST', '/crm/v4/associations/deals/contacts/batch/read', { inputs: bloco.map(id => ({ id })) });
  for (const l of (r.json?.results || [])) {
    const p = (l.to || [])[0];
    if (p) contatoDoNegocio.set(String(l.from.id), String(p.toObjectId));
  }
}
const empresaDoNegocio = new Map();
for (const bloco of pedacos([...new Set(contatoDoNegocio.values())], 100)) {
  const r = await api('POST', '/crm/v4/associations/contacts/companies/batch/read', { inputs: bloco.map(id => ({ id })) });
  for (const l of (r.json?.results || [])) {
    const p = (l.to || [])[0];
    if (p) empresaDoNegocio.set(String(l.from.id), String(p.toObjectId));
  }
}
const dadosContato = new Map();
for (const bloco of pedacos([...new Set(contatoDoNegocio.values())], 100)) {
  const r = await api('POST', '/crm/v3/objects/contacts/batch/read',
    { properties: ['company'], inputs: bloco.map(id => ({ id })) });
  for (const c of (r.json?.results || [])) dadosContato.set(String(c.id), c.properties.company || '');
}
const funcDaEmpresa = new Map();
for (const bloco of pedacos([...new Set(empresaDoNegocio.values())], 100)) {
  const r = await api('POST', '/crm/v3/objects/companies/batch/read',
    { properties: ['numberofemployees', 'name'], inputs: bloco.map(id => ({ id })) });
  for (const c of (r.json?.results || [])) {
    funcDaEmpresa.set(String(c.id), parseInt(c.properties.numberofemployees || '0', 10));
  }
}

/* ---------- decide o porte de cada negócio ---------- */
let porAssociacao = 0, porNomeDeclarado = 0, semDado = 0;
const atualizacoes = [];
for (const d of negocios) {
  const contatoId = contatoDoNegocio.get(String(d.id));
  let func = 0, via = '';
  if (contatoId) {
    const empId = empresaDoNegocio.get(contatoId);
    if (empId && funcDaEmpresa.get(empId) > 0) { func = funcDaEmpresa.get(empId); via = 'associação'; }
    if (!func) {
      const k = normaliza(dadosContato.get(contatoId));
      if (k && porNome.has(k)) { func = porNome.get(k); via = 'nome declarado'; }
    }
  }
  const rotulo = func > 0 ? faixaDe(func) : 'Não informado';
  if (via === 'associação') porAssociacao++;
  else if (via === 'nome declarado') porNomeDeclarado++;
  else semDado++;
  if (d.properties.ps26_porte_empresa !== rotulo) {
    atualizacoes.push({ id: d.id, properties: { ps26_porte_empresa: rotulo } });
  }
}
console.log('\nORIGEM DO DADO');
console.log('  pela empresa associada: ' + porAssociacao);
console.log('  pelo nome declarado:    ' + porNomeDeclarado);
console.log('  sem dado de porte:      ' + semDado);
console.log('\nA atualizar: ' + atualizacoes.length);

if (SIMULAR) process.exit(0);

let feitos = 0, erros = 0;
for (const bloco of pedacos(atualizacoes, 100)) {
  const r = await api('POST', '/crm/v3/objects/deals/batch/update', { inputs: bloco });
  if (r.ok || r.status === 207) feitos += (r.json.results || []).length;
  else { erros += bloco.length; console.log('  [ERRO] ' + r.status + ' ' + r.txt.slice(0, 160)); }
  process.stdout.write('  atualizados: ' + feitos + '   \r');
}
console.log('\natualizados: ' + feitos + (erros ? ' | erros: ' + erros : ''));
