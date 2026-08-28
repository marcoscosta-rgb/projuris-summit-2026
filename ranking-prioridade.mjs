/**
 * Ordena os negócios sem dono por potencial e entrega os N melhores.
 *
 * "Maior porte" sozinho classifica mal: uma multinacional representada por um
 * estagiário vale menos que uma empresa média representada pelo diretor
 * jurídico, que decide a compra. O score combina:
 *
 *   PORTE      quantos funcionários a empresa tem (peso maior)
 *   RECEITA    faturamento anual, quando o HubSpot tem o dado
 *   DECISÃO    senioridade do contato — quem assina contrato vale mais
 *   PERFIL     departamento jurídico tende a ter volume maior de contratos
 *              que escritório pequeno, que é o nosso caso de uso
 *
 * Uso:  HUBSPOT_TOKEN=... node ranking-prioridade.mjs [--top 200] [--atribuir <ownerId>] [--simular]
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const TOP = parseInt(arg('--top') || '200', 10);
const ATRIBUIR = arg('--atribuir');
const SIMULAR = process.argv.includes('--simular');

const BASE = 'https://api.hubapi.com';
const PIPELINE = '929744040';

async function api(m, p, b, t = 0) {
  const r = await fetch(BASE + p, { method: m,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined });
  if (r.status === 429 && t < 5) { await new Promise(x => setTimeout(x, 2000 * (t + 1))); return api(m, p, b, t + 1); }
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: r.ok, status: r.status, json: j, txt };
}
const pedacos = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const semAcento = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- pesos ---------- */
function pontosPorte(func) {
  if (!func) return 0;
  if (func >= 5000) return 50;
  if (func >= 1000) return 40;
  if (func >= 500)  return 33;
  if (func >= 200)  return 27;
  if (func >= 50)   return 15;
  return 5;
}
function pontosReceita(rec) {
  if (!rec) return 0;
  if (rec >= 1e9) return 20;
  if (rec >= 1e8) return 14;
  if (rec >= 1e7) return 8;
  return 3;
}
/* quem decide a compra de assinatura eletrônica pesa mais que quem só opera */
const CARGOS = [
  { re: /\b(ceo|cio|cto|cfo|coo|presidente|vice.?presidente|\bvp\b|diretor|diretora|head|s[oó]cio|s[oó]cia|fundador|proprietari)/, pts: 25 },
  { re: /\b(gerente|gerencia|manager|superintendente|coordenador|coordenadora)/, pts: 16 },
  { re: /\b(especialista|supervisor|supervisora|controller|consultor|consultora|advogad[oa] s[eê]nior|business partner)/, pts: 9 },
  { re: /\b(analista|advogad|assessor|paralegal|legal ops|legal counsel|counsel)/, pts: 5 },
  { re: /\b(estagi[aá]ri|assistente|auxiliar|aprendiz|jovem aprendiz|trainee|intern)\b/, pts: -12 },
];
function pontosCargo(cargo) {
  const c = semAcento(cargo);
  if (!c) return 0;
  for (const r of CARGOS) if (r.re.test(c)) return r.pts;
  return 0;
}
function pontosPerfil(ramo) {
  const r = semAcento(ramo);
  if (r.includes('departamento')) return 10;    // volume interno de contratos
  if (r.includes('escritorio')) return 5;
  return 0;
}

/* ---------- negócios sem dono ---------- */
let apos, negocios = [];
do {
  const r = await api('POST', '/crm/v3/objects/deals/search', {
    filterGroups: [{ filters: [
      { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE },
      { propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' },
    ] }],
    properties: ['dealname', 'ps26_porte_empresa'], limit: 100, ...(apos ? { after: apos } : {}),
  });
  if (!r.ok) { console.error('Busca falhou: ' + r.status + ' ' + r.txt.slice(0, 200)); process.exit(1); }
  negocios.push(...(r.json.results || []));
  apos = r.json.paging?.next?.after;
} while (apos);
console.log('Negócios sem dono no pipeline: ' + negocios.length);

/* ---------- contato e empresa de cada negócio ---------- */
const contatoDo = new Map();
for (const b of pedacos(negocios.map(d => d.id), 100)) {
  const r = await api('POST', '/crm/v4/associations/deals/contacts/batch/read', { inputs: b.map(id => ({ id })) });
  for (const l of (r.json?.results || [])) {
    const p = (l.to || [])[0]; if (p) contatoDo.set(String(l.from.id), String(p.toObjectId));
  }
}
const contato = new Map();
for (const b of pedacos([...new Set(contatoDo.values())], 100)) {
  const r = await api('POST', '/crm/v3/objects/contacts/batch/read', {
    properties: ['firstname', 'lastname', 'email', 'company', 'jobtitle', 'ps26_ramo'],
    inputs: b.map(id => ({ id })) });
  for (const c of (r.json?.results || [])) contato.set(String(c.id), c.properties);
}
const empresaDo = new Map();
for (const b of pedacos([...new Set(contatoDo.values())], 100)) {
  const r = await api('POST', '/crm/v4/associations/contacts/companies/batch/read', { inputs: b.map(id => ({ id })) });
  for (const l of (r.json?.results || [])) {
    const p = (l.to || [])[0]; if (p) empresaDo.set(String(l.from.id), String(p.toObjectId));
  }
}
const empresa = new Map();
for (const b of pedacos([...new Set(empresaDo.values())], 100)) {
  const r = await api('POST', '/crm/v3/objects/companies/batch/read', {
    properties: ['name', 'numberofemployees', 'annualrevenue', 'industry'], inputs: b.map(id => ({ id })) });
  for (const c of (r.json?.results || [])) empresa.set(String(c.id), c.properties);
}

/* ---------- pontuação ---------- */
const ranking = negocios.map(d => {
  const cId = contatoDo.get(String(d.id));
  const c = cId ? contato.get(cId) || {} : {};
  const eId = cId ? empresaDo.get(cId) : null;
  const e = eId ? empresa.get(eId) || {} : {};
  const func = parseInt(e.numberofemployees || '0', 10);
  const rec = parseFloat(e.annualrevenue || '0');
  const pPorte = pontosPorte(func);
  const pRec = pontosReceita(rec);
  const pCargo = pontosCargo(c.jobtitle);
  const pPerfil = pontosPerfil(c.ps26_ramo);
  return {
    id: d.id, nome: d.properties.dealname,
    empresa: e.name || c.company || '-', func, rec,
    cargo: c.jobtitle || '-', email: c.email || '',
    score: pPorte + pRec + pCargo + pPerfil,
    detalhe: `porte ${pPorte} + receita ${pRec} + cargo ${pCargo} + perfil ${pPerfil}`,
  };
}).sort((a, b) => b.score - a.score || (b.func - a.func) || String(a.id).localeCompare(String(b.id)));

const top = ranking.slice(0, TOP);
console.log('\nOS ' + TOP + ' PRIORITÁRIOS · score de ' + top[top.length - 1].score + ' a ' + top[0].score);
console.log('\n  #   score  funcion.  empresa                              cargo');
top.slice(0, 25).forEach((r, i) => {
  console.log('  ' + String(i + 1).padStart(3) + '  ' + String(r.score).padStart(5) + '  ' +
    String(r.func || '-').padStart(8) + '  ' + (r.empresa || '-').slice(0, 34).padEnd(36) +
    (r.cargo || '-').slice(0, 28));
});
console.log('  … (' + (TOP - 25) + ' restantes)');

const faixa = { '5000+': 0, '1000-4999': 0, '200-999': 0, '50-199': 0, '<50': 0, 'sem dado': 0 };
top.forEach(r => {
  if (!r.func) faixa['sem dado']++;
  else if (r.func >= 5000) faixa['5000+']++;
  else if (r.func >= 1000) faixa['1000-4999']++;
  else if (r.func >= 200) faixa['200-999']++;
  else if (r.func >= 50) faixa['50-199']++;
  else faixa['<50']++;
});
console.log('\nCOMPOSIÇÃO DA SELEÇÃO');
for (const [f, q] of Object.entries(faixa)) console.log('  ' + f.padEnd(12) + q);
const comDecisor = top.filter(r => pontosCargo(r.cargo) >= 16).length;
console.log('  com decisor (diretoria/gerência): ' + comDecisor + ' de ' + TOP);

if (!ATRIBUIR) {
  console.log('\nNada foi alterado. Use --atribuir <ownerId> para vincular a seleção.');
  process.exit(0);
}
if (SIMULAR) { console.log('\n[simulado] ' + top.length + ' negócios iriam para o owner ' + ATRIBUIR); process.exit(0); }

let feitos = 0, erros = 0;
for (const b of pedacos(top, 100)) {
  const r = await api('POST', '/crm/v3/objects/deals/batch/update',
    { inputs: b.map(x => ({ id: x.id, properties: { hubspot_owner_id: String(ATRIBUIR) } })) });
  if (r.ok || r.status === 207) feitos += (r.json.results || []).length;
  else { erros += b.length; console.log('  [ERRO] ' + r.status + ' ' + r.txt.slice(0, 160)); }
  process.stdout.write('  atribuídos: ' + feitos + '   \r');
}
console.log('\natribuídos: ' + feitos + (erros ? ' | erros: ' + erros : ''));
