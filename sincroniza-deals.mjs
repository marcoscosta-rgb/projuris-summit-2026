/**
 * Mantém o pipeline do Projuris Summit 2026 em dia.
 *
 * Faz três coisas, nesta ordem, e nunca duplica negócio:
 *
 *  1. CRIA  — todo lead do evento que ainda não tem negócio no pipeline ganha um,
 *             associado ao contato e à empresa. Quem veio só do mailing nasce
 *             SEM DONO, à espera de ser reivindicado.
 *  2. VINCULA — quando um executivo capta alguém pelo formulário, o negócio que
 *             já existia recebe o dono, em vez de um segundo negócio ser criado.
 *             Marcos e Amanda captam, mas quem trabalha é a Marcella.
 *  3. DISTRIBUI (só com --distribuir) — reparte os negócios que sobraram sem dono
 *             igualmente entre Marcella, Simone, Leonardo e Larissa.
 *
 * As automações nativas do HubSpot foram desligadas de propósito: elas criavam
 * um negócio novo a cada captação, o que duplicaria quem já veio do mailing.
 *
 * Uso:  HUBSPOT_TOKEN=... node sincroniza-deals.mjs [--simular] [--distribuir]
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }
const SIMULAR = process.argv.includes('--simular');
const DISTRIBUIR = process.argv.includes('--distribuir');

const BASE = 'https://api.hubapi.com';
const PIPELINE = '929744040';
const ASSOC_DEAL_CONTATO = 3;
const ASSOC_DEAL_EMPRESA = 5;

/* quem capta nem sempre é quem trabalha */
const DONO_DO_NEGOCIO = {
  'Marcos Costa': 90351877,                  // -> Marcella
  'Amanda Costa': 90351877,                  // -> Marcella
  'Marcella Figueiredo': 90351877,
  'Simone de Alencar Rodrigues': 88335699,
  'Leonardo Santos': 95065899,
  'Larissa Cavalcante': 79360795,
};
/* rodízio da distribuição final */
const EQUIPE = [
  { id: 90351877, nome: 'Marcella Figueiredo' },
  { id: 88335699, nome: 'Simone de Alencar Rodrigues' },
  { id: 95065899, nome: 'Leonardo Santos' },
  { id: 79360795, nome: 'Larissa Cavalcante' },
];
const NOME_DONO = Object.fromEntries(EQUIPE.map(e => [e.id, e.nome]));

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

/* ---------- etapa inicial ---------- */
const pl = await api('GET', '/crm/v3/pipelines/deals/' + PIPELINE);
if (!pl.ok) { console.error('Pipeline não encontrado.'); process.exit(1); }
const etapa = pl.json.stages.slice().sort((a, b) => a.displayOrder - b.displayOrder)[0];
console.log('Pipeline: ' + pl.json.label + ' · etapa inicial: ' + etapa.label);

/* ---------- todos os leads do evento ---------- */
const PROPS = ['email', 'firstname', 'lastname', 'company', 'phone', 'ps26_captado_por', 'ps26_origem_captura'];
let apos, contatos = [];
do {
  const r = await api('POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [
      { propertyName: 'ps26_origem_captura', operator: 'HAS_PROPERTY' },
      { propertyName: 'ps26_registro_duplicado', operator: 'NOT_HAS_PROPERTY' },   // 2º cadastro da mesma pessoa
    ] }],
    properties: PROPS, limit: 100, ...(apos ? { after: apos } : {}),
  });
  if (!r.ok) { console.error('Busca falhou: ' + r.status + ' ' + r.txt.slice(0, 200)); process.exit(1); }
  contatos.push(...(r.json.results || []));
  apos = r.json.paging?.next?.after;
} while (apos);
const captados = contatos.filter(c => c.properties.ps26_captado_por).length;
console.log('Leads do evento: ' + contatos.length + '  (captados pelo time: ' + captados + ')');
if (!contatos.length) process.exit(0);

/* ---------- negócios já existentes, em lote ---------- */
const dealDoContato = new Map();     // contatoId -> dealId (no pipeline do evento)
const idsDeals = new Set();
const assoc = new Map();
for (const bloco of pedacos(contatos.map(c => c.id), 100)) {
  const r = await api('POST', '/crm/v4/associations/contacts/deals/batch/read', { inputs: bloco.map(id => ({ id })) });
  if (!r.ok) { console.error('Leitura de associações falhou: ' + r.status); process.exit(1); }
  for (const l of (r.json.results || [])) {
    const ids = (l.to || []).map(t => String(t.toObjectId));
    assoc.set(String(l.from.id), ids);
    ids.forEach(d => idsDeals.add(d));
  }
}
const dealInfo = new Map();          // dealId -> { pipeline, owner }
for (const bloco of pedacos([...idsDeals], 100)) {
  const r = await api('POST', '/crm/v3/objects/deals/batch/read',
    { properties: ['pipeline', 'hubspot_owner_id'], inputs: bloco.map(id => ({ id })) });
  if (!r.ok) continue;
  for (const d of (r.json.results || [])) {
    dealInfo.set(String(d.id), { pipeline: d.properties?.pipeline, owner: d.properties?.hubspot_owner_id || '' });
  }
}
for (const [contatoId, ids] of assoc) {
  const doEvento = ids.find(d => dealInfo.get(d)?.pipeline === PIPELINE);
  if (doEvento) dealDoContato.set(contatoId, doEvento);
}

/* ---------- 1) criar os que faltam, sem dono ---------- */
const semNegocio = contatos.filter(c => !dealDoContato.has(String(c.id)));
console.log('\n1) Criar negócio · faltando: ' + semNegocio.length);

const empresaDoContato = new Map();
for (const bloco of pedacos(semNegocio.map(c => c.id), 100)) {
  const r = await api('POST', '/crm/v4/associations/contacts/companies/batch/read', { inputs: bloco.map(id => ({ id })) });
  if (!r.ok) continue;
  for (const l of (r.json.results || [])) {
    const primeira = (l.to || [])[0];
    if (primeira) empresaDoContato.set(String(l.from.id), String(primeira.toObjectId));
  }
}

let criados = 0, erros = 0;
for (const bloco of pedacos(semNegocio, 100)) {
  const inputs = bloco.map(c => {
    const p = c.properties;
    const nome = [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || 'Lead sem nome';
    const dono = DONO_DO_NEGOCIO[p.ps26_captado_por];   // só quem foi captado nasce com dono
    const empresaId = empresaDoContato.get(String(c.id));
    const a = [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC_DEAL_CONTATO }] }];
    if (empresaId) a.push({ to: { id: empresaId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC_DEAL_EMPRESA }] });
    return {
      properties: {
        dealname: nome + (p.company ? ' — ' + p.company : ''),
        pipeline: PIPELINE, dealstage: etapa.id,
        ...(dono ? { hubspot_owner_id: String(dono) } : {}),
      },
      associations: a,
    };
  });
  if (SIMULAR) { criados += inputs.length; continue; }
  const r = await api('POST', '/crm/v3/objects/deals/batch/create', { inputs });
  if (r.ok || r.status === 207) {
    criados += (r.json.results || []).length;
    (r.json.errors || []).forEach(() => erros++);
  } else { erros += inputs.length; console.log('  [ERRO lote] ' + r.status + ' ' + r.txt.slice(0, 200)); }
  process.stdout.write('   criados: ' + criados + '   \r');
}
console.log('   criados: ' + criados + (erros ? ' | erros: ' + erros : ''));

/* ---------- 2) vincular dono a quem foi captado depois ---------- */
const paraVincular = [];
for (const c of contatos) {
  const cap = c.properties.ps26_captado_por;
  if (!cap) continue;
  const dealId = dealDoContato.get(String(c.id));
  if (!dealId) continue;                       // acabou de ser criado já com dono
  const dono = DONO_DO_NEGOCIO[cap];
  if (!dono) continue;
  const atual = dealInfo.get(dealId)?.owner || '';
  if (String(atual) === String(dono)) continue;
  paraVincular.push({ id: dealId, properties: { hubspot_owner_id: String(dono) }, _cap: cap, _dono: dono });
}
console.log('\n2) Vincular dono a quem foi captado · ' + paraVincular.length);
let vinculados = 0;
for (const bloco of pedacos(paraVincular, 100)) {
  if (SIMULAR) {
    bloco.forEach(b => console.log('   [simulado] negócio ' + b.id + ' · captado por ' + b._cap + ' -> ' + NOME_DONO[b._dono]));
    vinculados += bloco.length; continue;
  }
  const r = await api('POST', '/crm/v3/objects/deals/batch/update',
    { inputs: bloco.map(b => ({ id: b.id, properties: b.properties })) });
  if (r.ok || r.status === 207) vinculados += (r.json.results || []).length;
  else { erros += bloco.length; console.log('  [ERRO] ' + r.status + ' ' + r.txt.slice(0, 160)); }
}
console.log('   vinculados: ' + vinculados);

/* ---------- 3) distribuir os órfãos, só quando pedido ---------- */
if (!DISTRIBUIR) {
  const orfaos = [...dealDoContato.values()].filter(d => !(dealInfo.get(d)?.owner)).length
    + semNegocio.filter(c => !c.properties.ps26_captado_por).length;
  console.log('\n3) Distribuição: não solicitada.');
  console.log('   negócios sem dono aguardando: ~' + orfaos);
  console.log('   rode com --distribuir quando quiser repartir entre a equipe.');
  process.exit(erros ? 1 : 0);
}

console.log('\n3) Distribuir os negócios sem dono');
let apos2, todosDeals = [];
do {
  const r = await api('POST', '/crm/v3/objects/deals/search', {
    filterGroups: [{ filters: [
      { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE },
      { propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' },
    ] }],
    properties: ['dealname', 'ps26_porte_empresa'], limit: 100, ...(apos2 ? { after: apos2 } : {}),
  });
  if (!r.ok) { console.error('   busca falhou: ' + r.status + ' ' + r.txt.slice(0, 160)); break; }
  todosDeals.push(...(r.json.results || []));
  apos2 = r.json.paging?.next?.after;
} while (apos2);

console.log('   sem dono: ' + todosDeals.length);
if (!todosDeals.length) process.exit(erros ? 1 : 0);

/* Empresas maiores primeiro, e o rodízio começa pela Marcella.
   Assim as maiores contas são repartidas de cima para baixo, na ordem
   Marcella → Simone → Leonardo → Larissa, e ninguém fica só com as pontas. */
const PESO = { '5000+': 5, '1001-5000': 4, '201-1000': 3, '51-200': 2, '1-50': 1, 'Não informado': 0 };
todosDeals.sort((a, b) => {
  const pa = PESO[a.properties.ps26_porte_empresa] ?? 0;
  const pb = PESO[b.properties.ps26_porte_empresa] ?? 0;
  if (pa !== pb) return pb - pa;
  return String(a.id).localeCompare(String(b.id));   // estável entre execuções
});

const conta = {}, porFaixa = {};
const lotes = todosDeals.map((d, i) => {
  const membro = EQUIPE[i % EQUIPE.length];
  const faixa = d.properties.ps26_porte_empresa || 'Não informado';
  conta[membro.nome] = (conta[membro.nome] || 0) + 1;
  porFaixa[faixa] = porFaixa[faixa] || {};
  porFaixa[faixa][membro.nome] = (porFaixa[faixa][membro.nome] || 0) + 1;
  return { id: d.id, properties: { hubspot_owner_id: String(membro.id) } };
});
console.log('   total por pessoa: ' + Object.entries(conta).map(([n, q]) => n.split(' ')[0] + ' ' + q).join(' · '));
console.log('\n   como as faixas ficam repartidas:');
for (const f of ['5000+', '1001-5000', '201-1000', '51-200', '1-50', 'Não informado']) {
  if (!porFaixa[f]) continue;
  const linha = EQUIPE.map(e => e.nome.split(' ')[0] + ' ' + (porFaixa[f][e.nome] || 0)).join(' · ');
  console.log('     ' + f.padEnd(14) + linha);
}

let distribuidos = 0;
if (!SIMULAR) {
  for (const bloco of pedacos(lotes, 100)) {
    const r = await api('POST', '/crm/v3/objects/deals/batch/update', { inputs: bloco });
    if (r.ok || r.status === 207) distribuidos += (r.json.results || []).length;
    else { erros += bloco.length; console.log('   [ERRO] ' + r.status + ' ' + r.txt.slice(0, 160)); }
    process.stdout.write('   distribuídos: ' + distribuidos + '   \r');
  }
} else distribuidos = lotes.length;
console.log('   distribuídos: ' + distribuidos);

console.log('\n' + '='.repeat(52));
console.log('criados: ' + criados + ' | vinculados: ' + vinculados + ' | distribuídos: ' + distribuidos + ' | erros: ' + erros);
if (erros) process.exit(1);
