/**
 * Marca os contatos que são o registro secundário de uma mesma pessoa.
 *
 * Sete pessoas se inscreveram duas vezes no evento, com e-mail corporativo e
 * pessoal. Viraram dois contatos e dois negócios. Removemos os negócios
 * repetidos, mas os contatos continuam lá — e sem uma marca, a sincronização
 * criaria o negócio de novo a cada execução.
 *
 * Não usamos a mesclagem do HubSpot porque ela é irreversível. Marcar é
 * reversível: basta limpar o campo para o contato voltar ao fluxo normal.
 *
 * Uso:  HUBSPOT_TOKEN=... node marca-duplicados.mjs [--simular]
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }
const SIMULAR = process.argv.includes('--simular');
const BASE = 'https://api.hubapi.com';

/* secundários identificados: o principal fica com o e-mail corporativo,
   ou com o domínio efetivamente usado pela empresa na base */
const SECUNDARIOS = [
  { id: '244704228192', email: 'emyoshikawa@yahoo.com',            principal: 'eyoshikawa@systra.com' },
  { id: '244704228214', email: 'daniela.grange@hotmail.com',       principal: 'daniela.grangeiro@neohype.co' },
  { id: '244704228247', email: 'danielleemy@gmail.com',            principal: 'dleme@systra.com' },
  { id: '244706794571', email: 'geovannatamasco@gmail.com.br',     principal: 'geovanna.silva@grupocesari.com.br' },
  { id: '244710869762', email: 'lucasvdetomi@gmail.com',           principal: 'lucas.detomi@sada.com.br' },
  { id: '244710869783', email: 'maximoh@uol.com.br',               principal: 'mxythd@gmail.com' },
  { id: '244701862468', email: 'viviane.vieira@damilertruck.com',  principal: 'viviane.vieira@daimlertruck.com' },
];

async function api(m, p, b) {
  const r = await fetch(BASE + p, {
    method: m, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, status: r.status, json: j, txt: t };
}

const criar = await api('POST', '/crm/v3/properties/contacts', {
  name: 'ps26_registro_duplicado',
  label: 'PS26 · Registro duplicado',
  type: 'enumeration', fieldType: 'select',
  groupName: 'projuris_summit_2026',
  description: 'Marca o segundo cadastro de uma pessoa que se inscreveu duas vezes. Fica fora do pipeline.',
  options: [{ label: 'Sim', value: 'Sim', displayOrder: 0 }, { label: 'Não', value: 'Não', displayOrder: 1 }],
});
console.log(criar.ok ? 'Propriedade criada.'
  : criar.status === 409 ? 'Propriedade já existia.'
  : 'Falha: ' + criar.status + ' ' + criar.txt.slice(0, 160));

if (SIMULAR) {
  SECUNDARIOS.forEach(s => console.log('  [simulado] marcar ' + s.email + '  (principal: ' + s.principal + ')'));
  process.exit(0);
}

const r = await api('POST', '/crm/v3/objects/contacts/batch/update', {
  inputs: SECUNDARIOS.map(s => ({ id: s.id, properties: { ps26_registro_duplicado: 'Sim' } })),
});
if (r.ok || r.status === 207) {
  console.log('marcados: ' + (r.json.results || []).length);
  SECUNDARIOS.forEach(s => console.log('  ' + s.email + '  ->  principal: ' + s.principal));
} else {
  console.log('ERRO: ' + r.status + ' ' + r.txt.slice(0, 200));
  process.exit(1);
}
