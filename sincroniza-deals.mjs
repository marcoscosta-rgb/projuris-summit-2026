/**
 * Cria um negócio no pipeline "Projuris Summit 2026" para cada lead captado,
 * já atribuído ao executivo que fez a captação, e associa contato e empresa.
 *
 * O formulário do HubSpot cria apenas o CONTATO — negócio não é criado por ele.
 * Este script fecha essa lacuna e roda sozinho a cada 5 minutos pelo GitHub
 * Actions durante o evento (.github/workflows/sincroniza.yml).
 *
 * Trabalha em lote: uma chamada resolve 100 contatos, em vez de uma por contato.
 * Rodar de novo não duplica nada — quem já tem negócio no pipeline é ignorado.
 *
 * Uso:  HUBSPOT_TOKEN=... node sincroniza-deals.mjs
 *       HUBSPOT_TOKEN=... node sincroniza-deals.mjs --simular
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }
const SIMULAR = process.argv.includes('--simular');

const BASE = 'https://api.hubapi.com';
const PIPELINE = '929744040';
const ASSOC_DEAL_CONTATO = 3;   // negócio -> contato
const ASSOC_DEAL_EMPRESA = 5;   // negócio -> empresa

const DONOS = {
  'Marcos Costa': 92039545,
  'Simone de Alencar Rodrigues': 88335699,
  'Amanda Costa': 77518012,
  'Leonardo Santos': 95065899,
  'Larissa Cavalcante': 79360795,
  'Marcella Figueiredo': 90351877,
};

async function api(metodo, caminho, corpo, tentativa = 0) {
  const res = await fetch(BASE + caminho, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  // limite de requisições: espera e tenta de novo
  if (res.status === 429 && tentativa < 4) {
    await new Promise(r => setTimeout(r, 2000 * (tentativa + 1)));
    return api(metodo, caminho, corpo, tentativa + 1);
  }
  const txt = await res.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: res.ok, status: res.status, json, txt };
}

const pedacos = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/* ---------- etapa inicial do pipeline ---------- */
const pl = await api('GET', '/crm/v3/pipelines/deals/' + PIPELINE);
if (!pl.ok) { console.error('Pipeline não encontrado: ' + pl.status + ' ' + pl.txt.slice(0, 200)); process.exit(1); }
const etapa = pl.json.stages.slice().sort((a, b) => a.displayOrder - b.displayOrder)[0];
console.log('Pipeline: ' + pl.json.label + ' · etapa inicial: ' + etapa.label);

/* ---------- todos os leads marcados com o evento ---------- */
const PROPS = ['email', 'firstname', 'lastname', 'company', 'phone', 'ps26_captado_por', 'ps26_origem_captura'];
let apos, contatos = [];
do {
  const r = await api('POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'ps26_captado_por', operator: 'HAS_PROPERTY' }] }],
    properties: PROPS, limit: 100, ...(apos ? { after: apos } : {}),
  });
  if (!r.ok) { console.error('Busca falhou: ' + r.status + ' ' + r.txt.slice(0, 200)); process.exit(1); }
  contatos.push(...(r.json.results || []));
  apos = r.json.paging?.next?.after;
} while (apos);

console.log('Leads do evento: ' + contatos.length);
if (!contatos.length) { console.log('Nada a fazer.'); process.exit(0); }

/* ---------- quem já tem negócio: leitura em lote ---------- */
const jaTemNegocio = new Set();
const idsDeals = new Set();
const assocPorContato = new Map();

for (const bloco of pedacos(contatos.map(c => c.id), 100)) {
  const r = await api('POST', '/crm/v4/associations/contacts/deals/batch/read',
    { inputs: bloco.map(id => ({ id })) });
  if (!r.ok) { console.error('Leitura de associações falhou: ' + r.status + ' ' + r.txt.slice(0, 200)); process.exit(1); }
  for (const linha of (r.json.results || [])) {
    const ids = (linha.to || []).map(t => t.toObjectId);
    assocPorContato.set(String(linha.from.id), ids);
    ids.forEach(d => idsDeals.add(String(d)));
  }
}

/* ---------- quais desses negócios estão no pipeline do evento ---------- */
const dealsNoPipeline = new Set();
for (const bloco of pedacos([...idsDeals], 100)) {
  const r = await api('POST', '/crm/v3/objects/deals/batch/read',
    { properties: ['pipeline'], inputs: bloco.map(id => ({ id })) });
  if (!r.ok) continue;
  for (const d of (r.json.results || [])) {
    if (d.properties?.pipeline === PIPELINE) dealsNoPipeline.add(String(d.id));
  }
}
for (const [contatoId, ids] of assocPorContato) {
  if (ids.some(d => dealsNoPipeline.has(String(d)))) jaTemNegocio.add(contatoId);
}

const pendentes = contatos.filter(c => !jaTemNegocio.has(String(c.id)));
console.log('Já tinham negócio: ' + jaTemNegocio.size + ' · a criar: ' + pendentes.length);
if (!pendentes.length) { console.log('Pipeline já está em dia.'); process.exit(0); }

/* ---------- empresa de cada lead, para associar ao negócio ---------- */
const empresaPorContato = new Map();
for (const bloco of pedacos(pendentes.map(c => c.id), 100)) {
  const r = await api('POST', '/crm/v4/associations/contacts/companies/batch/read',
    { inputs: bloco.map(id => ({ id })) });
  if (!r.ok) continue;
  for (const linha of (r.json.results || [])) {
    const primeira = (linha.to || [])[0];
    if (primeira) empresaPorContato.set(String(linha.from.id), String(primeira.toObjectId));
  }
}

/* ---------- criação dos negócios, em lote ---------- */
let criados = 0, erros = 0;
for (const bloco of pedacos(pendentes, 100)) {
  const entradas = bloco.map(c => {
    const p = c.properties;
    const nome = [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || 'Lead sem nome';
    const dono = DONOS[p.ps26_captado_por];
    const empresaId = empresaPorContato.get(String(c.id));
    const assoc = [{ to: { id: c.id },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC_DEAL_CONTATO }] }];
    if (empresaId) {
      assoc.push({ to: { id: empresaId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC_DEAL_EMPRESA }] });
    }
    return {
      properties: {
        dealname: nome + (p.company ? ' — ' + p.company : ''),
        pipeline: PIPELINE,
        dealstage: etapa.id,
        ...(dono ? { hubspot_owner_id: String(dono) } : {}),
      },
      associations: assoc,
    };
  });

  if (SIMULAR) {
    entradas.forEach(e => console.log('  [simulado] ' + e.properties.dealname +
      ' -> ' + (e.properties.hubspot_owner_id || 'sem dono') +
      (e.associations.length > 1 ? ' (+empresa)' : '')));
    criados += entradas.length;
    continue;
  }

  const r = await api('POST', '/crm/v3/objects/deals/batch/create', { inputs: entradas });
  if (r.ok || r.status === 207) {
    const n = (r.json.results || []).length;
    criados += n;
    (r.json.results || []).forEach(d => console.log('  [criado] ' + d.properties.dealname));
    const falhou = (r.json.errors || []);
    falhou.forEach(e => { erros++; console.log('  [ERRO] ' + JSON.stringify(e).slice(0, 180)); });
  } else {
    erros += entradas.length;
    console.log('  [ERRO no lote] ' + r.status + ' ' + r.txt.slice(0, 240));
  }
}

console.log('\n' + '='.repeat(50));
console.log((SIMULAR ? 'simulados: ' : 'negócios criados: ') + criados + ' | erros: ' + erros);
if (erros) process.exit(1);
