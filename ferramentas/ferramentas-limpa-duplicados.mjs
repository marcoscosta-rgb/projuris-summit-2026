import fs from 'fs';
const TOKEN = fs.readFileSync('/Users/marcoscosta/projuris-summit-2026/.env', 'utf8')
  .match(/HUBSPOT_TOKEN=(.+)/)[1].trim();
const SIMULAR = process.argv.includes('--simular');
const PIPELINE = '929744040';

async function api(m, p, b) {
  const r = await fetch('https://api.hubapi.com' + p, {
    method: m, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, status: r.status, json: j, txt: t };
}

const GENERICOS = ['gmail.', 'hotmail.', 'yahoo.', 'outlook.', 'uol.', 'icloud.', 'terra.', 'bol.', 'live.', 'msn.'];
const ehGenerico = e => GENERICOS.some(g => (e || '').toLowerCase().includes('@') && e.toLowerCase().split('@')[1].startsWith(g.replace('.', '')));

const dup = JSON.parse(fs.readFileSync(
  '/private/tmp/claude-501/-Users-marcoscosta/37ce9c6d-f5db-460a-b544-227617310b33/scratchpad/duplicados.json', 'utf8'));

/* Um domínio digitado errado (damilertruck) parece tão corporativo quanto o certo
   (daimlertruck). Contamos quantas vezes cada domínio aparece na base do evento:
   o que só existe uma vez, ao lado de um quase idêntico, é o erro de digitação. */
const freq = new Map();
{
  let after;
  do {
    const r = await api('POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [{ propertyName: 'ps26_origem_captura', operator: 'HAS_PROPERTY' }] }],
      properties: ['email'], limit: 100, ...(after ? { after } : {}),
    });
    for (const c of (r.json?.results || [])) {
      const d = (c.properties.email || '').toLowerCase().split('@')[1];
      if (d) freq.set(d, (freq.get(d) || 0) + 1);
    }
    after = r.json?.paging?.next?.after;
  } while (after);
}
const usoDoDominio = e => freq.get((e || '').toLowerCase().split('@')[1]) || 0;

console.log('Pessoas com inscrição em duplicidade: ' + dup.length + '\n');
let removidos = 0, mantidos = 0;

for (const grupo of dup) {
  if (grupo.captado) { console.log('  [pulado] ' + grupo.chave + ' — foi captado no evento, não mexo'); continue; }

  // o contato a MANTER é o de e-mail corporativo; empatou, fica o mais antigo
  const pares = grupo.ids.map((id, i) => ({ id, email: grupo.emails[i] }));
  pares.sort((a, b) => {
    const ga = ehGenerico(a.email) ? 1 : 0, gb = ehGenerico(b.email) ? 1 : 0;
    if (ga !== gb) return ga - gb;                       // corporativo antes de genérico
    const ua = usoDoDominio(a.email), ub = usoDoDominio(b.email);
    if (ua !== ub) return ub - ua;                       // domínio mais usado na base vence
    return String(a.id).length - String(b.id).length || String(a.id).localeCompare(String(b.id));
  });
  const manter = pares[0], descartar = pares.slice(1);

  for (const d of descartar) {
    const a = await api('GET', '/crm/v4/objects/contacts/' + d.id + '/associations/deals?limit=20');
    const ids = (a.json?.results || []).map(x => String(x.toObjectId));
    for (const dealId of ids) {
      const info = await api('GET', '/crm/v3/objects/deals/' + dealId + '?properties=pipeline,dealname,hubspot_owner_id');
      if (info.json?.properties?.pipeline !== PIPELINE) continue;
      if (info.json?.properties?.hubspot_owner_id) {
        console.log('  [mantido] ' + info.json.properties.dealname + ' — já tem dono, não removo');
        continue;
      }
      if (SIMULAR) { console.log('  [simulado] remover: ' + info.json.properties.dealname + ' (' + d.email + ')'); removidos++; continue; }
      const del = await api('DELETE', '/crm/v3/objects/deals/' + dealId);
      if (del.ok) { removidos++; console.log('  [removido] ' + info.json.properties.dealname + '  (duplicado de ' + d.email + ')'); }
      else console.log('  [ERRO] ' + dealId + ': ' + del.status);
    }
  }
  mantidos++;
  console.log('     mantido o de ' + manter.email + '  (domínio usado ' + usoDoDominio(manter.email) + 'x na base)\n');
}
console.log('='.repeat(50));
console.log('negócios duplicados removidos: ' + removidos + ' | pessoas normalizadas: ' + mantidos);
