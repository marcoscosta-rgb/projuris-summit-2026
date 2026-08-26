/**
 * Cria as automações nativas do HubSpot que transformam cada lead captado
 * em negócio no pipeline do evento, no ato — sem depender de script externo.
 *
 * Uma automação por responsável, em vez de uma só com ramificações: mais
 * simples de auditar e de desligar individualmente se algo precisar mudar
 * no meio do evento.
 *
 * Quem capta nem sempre é quem trabalha: o que Marcos e Amanda captarem
 * nasce no nome da Marcella. O campo ps26_captado_por preserva quem captou.
 *
 * Uso:  HUBSPOT_TOKEN=... node cria-automacoes.mjs
 *       HUBSPOT_TOKEN=... node cria-automacoes.mjs --remover
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }
const REMOVER = process.argv.includes('--remover');

const BASE = 'https://api.hubapi.com';
const PIPELINE = '929744040';
const ETAPA = '1426174312';            // "Lead captado no evento"
const OBJ_CONTATO = '0-1';
const OBJ_NEGOCIO = '0-3';
const ACAO_CRIAR_REGISTRO = '0-14';
const ASSOC_NEGOCIO_CONTATO = 3;
const PREFIXO = 'PS26 · Negócio para ';

const GRUPOS = [
  { dono: 90351877, nome: 'Marcella Figueiredo',
    captadores: ['Marcos Costa', 'Amanda Costa', 'Marcella Figueiredo'] },
  { dono: 88335699, nome: 'Simone de Alencar Rodrigues',
    captadores: ['Simone de Alencar Rodrigues'] },
  { dono: 95065899, nome: 'Leonardo Santos',
    captadores: ['Leonardo Santos'] },
  { dono: 79360795, nome: 'Larissa Cavalcante',
    captadores: ['Larissa Cavalcante'] },
];

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

const estatico = v => ({ staticValue: String(v), type: 'STATIC_VALUE' });

function montaFlow(g) {
  return {
    name: PREFIXO + g.nome,
    type: 'CONTACT_FLOW',
    objectTypeId: OBJ_CONTATO,
    isEnabled: true,
    flowType: 'WORKFLOW',
    startActionId: '1',
    nextAvailableActionId: '2',
    enrollmentCriteria: {
      type: 'LIST_BASED',
      shouldReEnroll: false,               // um negócio por lead, nunca dois
      unEnrollObjectsNotMeetingCriteria: false,
      reEnrollmentTriggersFilterBranches: [],
      listFilterBranch: {
        filterBranchType: 'OR', filterBranchOperator: 'OR', filters: [],
        filterBranches: [{
          filterBranchType: 'AND', filterBranchOperator: 'AND', filterBranches: [],
          filters: [{
            property: 'ps26_captado_por',
            filterType: 'PROPERTY',
            operation: {
              operator: 'IS_ANY_OF',
              operationType: 'ENUMERATION',
              includeObjectsWithNoValueSet: false,
              values: g.captadores,
            },
          }],
        }],
      },
    },
    customProperties: {},
    dataSources: [],
    suppressionListIds: [],
    blockedDates: [],
    timeWindows: [],
    canEnrollFromSalesforce: false,
    actions: [{
      actionId: '1',
      type: 'SINGLE_CONNECTION',
      actionTypeVersion: 0,
      actionTypeId: ACAO_CRIAR_REGISTRO,
      fields: {
        object_type_id: OBJ_NEGOCIO,
        use_explicit_associations: 'true',
        associations: [{
          target: { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC_NEGOCIO_CONTATO },
          value: { type: 'ENROLLED_OBJECT' },
        }],
        properties: [
          { targetProperty: 'dealname',
            value: estatico('{{ _0_1.firstname }} {{ _0_1.lastname }} — {{ _0_1.company }}') },
          { targetProperty: 'pipeline', value: estatico(PIPELINE) },
          { targetProperty: 'dealstage', value: estatico(ETAPA) },
          { targetProperty: 'hubspot_owner_id', value: estatico(g.dono) },
        ],
      },
    }],
  };
}

/* ---------- estado atual ---------- */
let apos, todos = [];
do {
  const r = await api('GET', '/automation/v4/flows?limit=100' + (apos ? '&after=' + apos : ''));
  if (!r.ok) { console.error('Não consegui listar as automações: ' + r.status + ' ' + r.txt.slice(0, 200)); process.exit(1); }
  todos.push(...(r.json.results || []));
  apos = r.json.paging?.next?.after;
} while (apos);
const existentes = todos.filter(f => (f.name || '').startsWith(PREFIXO));
console.log('Automações do evento já existentes: ' + existentes.length);

if (REMOVER) {
  for (const f of existentes) {
    const r = await api('DELETE', '/automation/v4/flows/' + f.id);
    console.log((r.ok ? '  [removida] ' : '  [ERRO ' + r.status + '] ') + f.name);
  }
  process.exit(0);
}

/* ---------- cria o que falta ---------- */
let criadas = 0, puladas = 0, erros = 0;
for (const g of GRUPOS) {
  const nome = PREFIXO + g.nome;
  const ja = existentes.find(f => f.name === nome);
  if (ja) { puladas++; console.log('  [já existia] ' + nome + '  (id ' + ja.id + ')'); continue; }

  const r = await api('POST', '/automation/v4/flows', montaFlow(g));
  if (r.ok) {
    criadas++;
    console.log('  [criada] ' + nome + '  (id ' + r.json.id + ')');
    console.log('           dispara para: ' + g.captadores.join(', '));
  } else {
    erros++;
    console.log('  [ERRO] ' + nome + ': ' + r.status + ' ' + r.txt.slice(0, 300));
  }
}

console.log('\n' + '='.repeat(52));
console.log('criadas: ' + criadas + ' | já existiam: ' + puladas + ' | erros: ' + erros);
if (erros) process.exit(1);
