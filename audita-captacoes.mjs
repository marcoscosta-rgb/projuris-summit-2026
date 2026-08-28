/**
 * Confere se toda captação feita no app chegou íntegra ao pipeline.
 *
 * Verifica, um a um, os contatos marcados com um executivo:
 *   - existe negócio no pipeline do evento?
 *   - o negócio está no nome de quem deve trabalhar o lead?
 *   - contato e empresa estão associados ao negócio?
 *   - há negócio duplicado para a mesma pessoa?
 *   - o lead tem forma de contato (e-mail ou telefone)?
 *
 * Uso:  HUBSPOT_TOKEN=... node audita-captacoes.mjs
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }
const BASE = 'https://api.hubapi.com';
const PIPELINE = '929744040';

const DONO_ESPERADO = {
  'Marcos Costa': 90351877, 'Amanda Costa': 90351877, 'Marcella Figueiredo': 90351877,
  'Simone de Alencar Rodrigues': 88335699, 'Leonardo Santos': 95065899, 'Larissa Cavalcante': 79360795,
};
const NOME_DONO = { 90351877: 'Marcella', 88335699: 'Simone', 95065899: 'Leonardo', 79360795: 'Larissa' };

async function api(m, p, b) {
  const r = await fetch(BASE + p, { method: m,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, status: r.status, json: j, txt: t };
}
const pedacos = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/* ---------- todos os captados ---------- */
let apos, captados = [];
do {
  const r = await api('POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'ps26_captado_por', operator: 'HAS_PROPERTY' }] }],
    properties: ['email', 'phone', 'firstname', 'lastname', 'company', 'jobtitle',
                 'ps26_captado_por', 'ps26_origem_captura', 'ps26_capturado_em', 'createdate'],
    sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
    limit: 100, ...(apos ? { after: apos } : {}),
  });
  if (!r.ok) { console.error('Busca falhou: ' + r.status); process.exit(1); }
  captados.push(...(r.json.results || []));
  apos = r.json.paging?.next?.after;
} while (apos);
console.log('CAPTAÇÕES REGISTRADAS: ' + captados.length + '\n');

/* ---------- negócios de cada um ---------- */
const negociosDo = new Map();
const idsDeals = new Set();
for (const bloco of pedacos(captados.map(c => c.id), 100)) {
  const r = await api('POST', '/crm/v4/associations/contacts/deals/batch/read', { inputs: bloco.map(id => ({ id })) });
  for (const l of (r.json?.results || [])) {
    const ids = (l.to || []).map(t => String(t.toObjectId));
    negociosDo.set(String(l.from.id), ids);
    ids.forEach(d => idsDeals.add(d));
  }
}
const deal = new Map();
for (const bloco of pedacos([...idsDeals], 100)) {
  const r = await api('POST', '/crm/v3/objects/deals/batch/read',
    { properties: ['pipeline', 'hubspot_owner_id', 'dealname'], inputs: bloco.map(id => ({ id })) });
  for (const d of (r.json?.results || [])) deal.set(String(d.id), d.properties);
}
/* empresa associada ao negócio */
const empresaDoDeal = new Map();
for (const bloco of pedacos([...idsDeals], 100)) {
  const r = await api('POST', '/crm/v4/associations/deals/companies/batch/read', { inputs: bloco.map(id => ({ id })) });
  for (const l of (r.json?.results || [])) empresaDoDeal.set(String(l.from.id), (l.to || []).length);
}

/* ---------- auditoria ---------- */
const semNegocio = [], donoErrado = [], semDono = [], duplicados = [], semEmpresa = [], semContato = [];
const porExec = {};
for (const c of captados) {
  const p = c.properties;
  const exec = p.ps26_captado_por;
  porExec[exec] = (porExec[exec] || 0) + 1;
  const nome = [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email;

  if (!p.email && !p.phone) semContato.push(nome + ' (' + (p.company || '-') + ') · por ' + exec);

  const doEvento = (negociosDo.get(String(c.id)) || []).filter(d => deal.get(d)?.pipeline === PIPELINE);
  if (!doEvento.length) { semNegocio.push(nome + ' · por ' + exec); continue; }
  if (doEvento.length > 1) duplicados.push(nome + ' · ' + doEvento.length + ' negócios');

  const d = deal.get(doEvento[0]);
  const esperado = DONO_ESPERADO[exec];
  if (!d.hubspot_owner_id) semDono.push(nome + ' · por ' + exec);
  else if (esperado && String(d.hubspot_owner_id) !== String(esperado)) {
    donoErrado.push(nome + ' · captado por ' + exec + ' · está com ' +
      (NOME_DONO[d.hubspot_owner_id] || d.hubspot_owner_id) + ', deveria ser ' + NOME_DONO[esperado]);
  }
  if (!empresaDoDeal.get(doEvento[0])) semEmpresa.push(nome + ' (' + (p.company || 'sem empresa') + ')');
}

console.log('POR EXECUTIVO');
for (const [e, q] of Object.entries(porExec).sort((a, b) => b[1] - a[1])) console.log('  ' + e.padEnd(30) + q);

const bloco = (titulo, lista, critico = true) => {
  console.log('\n' + (lista.length ? (critico ? '✗ ' : '! ') : '✓ ') + titulo + ': ' + lista.length);
  lista.slice(0, 12).forEach(x => console.log('    ' + x));
  if (lista.length > 12) console.log('    … e mais ' + (lista.length - 12));
};
console.log('\n' + '='.repeat(58));
bloco('Captações SEM negócio no pipeline', semNegocio);
bloco('Negócios com dono ERRADO', donoErrado);
bloco('Negócios SEM dono', semDono);
bloco('Pessoas com negócio DUPLICADO', duplicados);
bloco('Leads sem e-mail nem telefone', semContato);
bloco('Negócios sem empresa associada', semEmpresa, false);

const problemas = semNegocio.length + donoErrado.length + semDono.length + duplicados.length + semContato.length;
console.log('\n' + '='.repeat(58));
console.log(problemas === 0
  ? 'Todas as ' + captados.length + ' captações estão íntegras no pipeline.'
  : problemas + ' problema(s) crítico(s) encontrados.');
process.exit(problemas ? 1 : 0);
