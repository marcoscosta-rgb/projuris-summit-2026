/**
 * Cria um negócio no pipeline "Projuris Summit 2026" para cada lead captado,
 * já atribuído ao executivo que fez a captação.
 *
 * É seguro rodar quantas vezes quiser: um contato que já tem negócio no pipeline
 * do evento é ignorado. Rode durante o evento para alimentar o pipeline em tempo
 * quase real, e de novo depois de carregar o mailing da organização.
 *
 * Uso:  HUBSPOT_TOKEN=... node sincroniza-deals.mjs
 *       HUBSPOT_TOKEN=... node sincroniza-deals.mjs --simular   (não grava nada)
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }
const SIMULAR = process.argv.includes('--simular');

const BASE = 'https://api.hubapi.com';
const PIPELINE = '929744040';
const ETAPA_INICIAL = null; // resolvida em tempo de execução (primeira etapa)
const ASSOC_DEAL_PARA_CONTATO = 3; // tipo padrão do HubSpot

const DONOS = {
  'Marcos Costa': 92039545,
  'Simone de Alencar Rodrigues': 88335699,
  'Amanda Costa': 77518012,
  'Leonardo Santos': 95065899,
  'Larissa Cavalcante': 79360795,
  'Marcella Figueiredo': 90351877,
};

async function api(metodo, caminho, corpo) {
  const res = await fetch(BASE + caminho, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await res.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: res.ok, status: res.status, json, txt };
}

/* etapa inicial do pipeline */
const pl = await api('GET', '/crm/v3/pipelines/deals/' + PIPELINE);
if (!pl.ok) { console.error('Pipeline não encontrado: ' + pl.status + ' ' + pl.txt.slice(0, 200)); process.exit(1); }
const primeira = pl.json.stages.sort((a, b) => a.displayOrder - b.displayOrder)[0];
console.log('Pipeline: ' + pl.json.label + ' | etapa inicial: ' + primeira.label);

/* contatos captados no evento */
const PROPS = ['email', 'firstname', 'lastname', 'company', 'jobtitle', 'phone',
  'ps26_captado_por', 'ps26_origem_captura', 'ps26_codigo_cracha', 'ps26_ramo',
  'ps26_funcionarios', 'ps26_usa_assinatura', 'ps26_contratos_mes', 'ps26_sem_email'];

let depois = undefined, contatos = [];
do {
  const r = await api('POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'ps26_origem_captura', operator: 'HAS_PROPERTY' }] }],
    properties: PROPS, limit: 100, ...(depois ? { after: depois } : {}),
  });
  if (!r.ok) { console.error('Busca falhou: ' + r.status + ' ' + r.txt.slice(0, 200)); process.exit(1); }
  contatos.push(...(r.json.results || []));
  depois = r.json.paging?.next?.after;
} while (depois);

console.log('Leads do evento encontrados: ' + contatos.length);
if (!contatos.length) { console.log('Nada a fazer.'); process.exit(0); }

let criados = 0, pulados = 0, erros = 0;

for (const c of contatos) {
  const p = c.properties;
  const nome = [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email;

  // já tem negócio neste pipeline?
  const assoc = await api('GET', '/crm/v4/objects/contacts/' + c.id + '/associations/deals?limit=100');
  let jaTem = false;
  for (const d of (assoc.json?.results || [])) {
    const deal = await api('GET', '/crm/v3/objects/deals/' + d.toObjectId + '?properties=pipeline');
    if (deal.json?.properties?.pipeline === PIPELINE) { jaTem = true; break; }
  }
  if (jaTem) { pulados++; continue; }

  const dono = DONOS[p.ps26_captado_por];
  const rotuloEmpresa = p.company ? ' — ' + p.company : '';
  const props = {
    dealname: nome + rotuloEmpresa,
    pipeline: PIPELINE,
    dealstage: primeira.id,
    ...(dono ? { hubspot_owner_id: String(dono) } : {}),
  };

  if (SIMULAR) {
    console.log('  [simulado] ' + props.dealname + '  -> ' + (p.ps26_captado_por || 'sem dono'));
    criados++; continue;
  }

  const r = await api('POST', '/crm/v3/objects/deals', {
    properties: props,
    associations: [{
      to: { id: c.id },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC_DEAL_PARA_CONTATO }],
    }],
  });
  if (r.ok) { criados++; console.log('  [criado] ' + props.dealname + '  -> ' + (p.ps26_captado_por || 'SEM DONO')); }
  else { erros++; console.log('  [ERRO] ' + props.dealname + ': ' + r.status + ' ' + r.txt.slice(0, 160)); }
}

console.log('\n' + '='.repeat(46));
console.log((SIMULAR ? 'simulados: ' : 'negócios criados: ') + criados +
            ' | já existiam: ' + pulados + ' | erros: ' + erros);
