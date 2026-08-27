import fs from 'fs';
const TOKEN = fs.readFileSync('/Users/marcoscosta/projuris-summit-2026/.env', 'utf8')
  .match(/HUBSPOT_TOKEN=(.+)/)[1].trim();

async function api(m, p, b) {
  const r = await fetch('https://api.hubapi.com' + p, {
    method: m, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, status: r.status, json: j, txt: t };
}

// todos os contatos do evento
let after, contatos = [];
do {
  const r = await api('POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'ps26_origem_captura', operator: 'HAS_PROPERTY' }] }],
    properties: ['email', 'firstname', 'lastname', 'company', 'phone', 'ps26_captado_por'],
    limit: 100, ...(after ? { after } : {}),
  });
  contatos.push(...(r.json.results || []));
  after = r.json.paging?.next?.after;
} while (after);
console.log('contatos do evento: ' + contatos.length);

// mesma pessoa = mesmo nome completo + mesma empresa (normalizados)
const chave = c => {
  const p = c.properties;
  const nome = ((p.firstname || '') + ' ' + (p.lastname || '')).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const emp = (p.company || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  return nome + '|' + emp;
};
const grupos = new Map();
for (const c of contatos) {
  if (!c.properties.firstname) continue;
  const k = chave(c);
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(c);
}
const dup = [...grupos.entries()].filter(([, v]) => v.length > 1);
console.log('pessoas inscritas mais de uma vez: ' + dup.length + '\n');
for (const [, v] of dup) {
  const p = v[0].properties;
  const captado = v.find(x => x.properties.ps26_captado_por);
  console.log(`  ${p.firstname} ${p.lastname || ''} · ${p.company || '-'}` +
    (captado ? '   [CAPTADO por ' + captado.properties.ps26_captado_por + ']' : ''));
  v.forEach(x => console.log(`      id ${x.id}  ${x.properties.email}`));
}
fs.writeFileSync('/private/tmp/claude-501/-Users-marcoscosta/37ce9c6d-f5db-460a-b544-227617310b33/scratchpad/duplicados.json',
  JSON.stringify(dup.map(([k, v]) => ({ chave: k, ids: v.map(x => x.id), emails: v.map(x => x.properties.email),
    captado: v.some(x => x.properties.ps26_captado_por) })), null, 1));
console.log('\nlista salva em duplicados.json');
