/**
 * Importa o mailing de inscritos que a organização entrega após o evento.
 *
 * Cuidados que o script toma:
 *  - NÃO sobrescreve quem já foi captado presencialmente. Quem o time abordou
 *    mantém o executivo que captou e a marca de contato no evento; do mailing
 *    só entram os campos que ainda estiverem vazios.
 *  - Descarta a organização do evento e as marcas dela (Projuris, Starian e
 *    afins) e a própria equipe da D4Sign — não são leads.
 *  - Descarta duplicidades do arquivo, mantendo o registro mais completo.
 *  - Não define ps26_captado_por, então as automações do HubSpot NÃO criam
 *    negócio para esses contatos: quem esteve no evento sem falar com a gente
 *    não vira oportunidade automaticamente.
 *
 * Uso:  HUBSPOT_TOKEN=... node importa-mailing.mjs arquivo.csv [--simular]
 */

import fs from 'fs';

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }
const arquivo = process.argv[2];
if (!arquivo || !fs.existsSync(arquivo)) { console.error('Informe o arquivo CSV.'); process.exit(1); }
const SIMULAR = process.argv.includes('--simular');

const BASE = 'https://api.hubapi.com';

/* domínios e nomes da organização do evento e da nossa própria casa */
const FORA = [
  'projuris', 'starian', 'supramonte', 'norisk', 'no risk', 'oystr',
  'deeplegal', 'deep legal', 'lexdesign', 'd4sign', 'zucchetti', 'softplan',
];

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

/* ---------- leitura do CSV (campos entre aspas, com vírgulas dentro) ---------- */
function lerCSV(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const bruto = fs.readFileSync(arquivo, 'utf8');
const linhas = lerCSV(bruto);
const iCab = linhas.findIndex(l => (l[0] || '').trim().toLowerCase() === 'nome');
if (iCab < 0) { console.error('Cabeçalho não encontrado no CSV.'); process.exit(1); }
const dados = linhas.slice(iCab + 1).filter(l => (l[2] || '').includes('@'));
console.log('Linhas com e-mail no arquivo: ' + dados.length);

/* ---------- normalização, filtro e dedupe ---------- */
const RAMO = {
  'departamento jurídico': 'Departamento Jurídico',
  'escritório de advocacia': 'Escritório de Advocacia',
};
const limpa = s => (s || '').trim().replace(/\s+/g, ' ');
const tel = s => { const d = (s || '').replace(/\D/g, ''); return d.length >= 10 && d.length <= 13 ? d : ''; };

const porEmail = new Map();
let descartadosOrg = 0;
for (const l of dados) {
  const email = limpa(l[2]).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) continue;
  const empresa = limpa(l[5]);
  const alvo = (email + ' ' + empresa).toLowerCase();
  if (FORA.some(f => alvo.includes(f))) { descartadosOrg++; continue; }

  const reg = {
    email,
    firstname: limpa(l[0]),
    lastname: limpa(l[1]),
    phone: tel(l[3]),
    ramo: RAMO[limpa(l[4]).toLowerCase()] || '',
    company: empresa,
    jobtitle: limpa(l[6]),
    cidade: limpa(l[7]),
  };
  const ja = porEmail.get(email);
  const peso = r => Object.values(r).filter(Boolean).length;
  if (!ja || peso(reg) > peso(ja)) porEmail.set(email, reg);
}
const unicos = [...porEmail.values()];
console.log('Descartados (organização do evento e equipe D4Sign): ' + descartadosOrg);
console.log('Duplicidades removidas: ' + (dados.length - descartadosOrg - unicos.length));
console.log('Contatos únicos a tratar: ' + unicos.length);

/* ---------- quem já existe no CRM e quem já foi captado no evento ---------- */
const existentes = new Map();   // email -> { id, captadoPor }
for (const bloco of pedacos(unicos.map(u => u.email), 100)) {
  const r = await api('POST', '/crm/v3/objects/contacts/batch/read', {
    idProperty: 'email',
    properties: ['email', 'ps26_captado_por', 'ps26_contato_no_evento', 'phone', 'company', 'jobtitle'],
    inputs: bloco.map(email => ({ id: email })),
  });
  if (r.ok || r.status === 207) {
    for (const c of (r.json.results || [])) {
      existentes.set((c.properties.email || '').toLowerCase(), {
        id: c.id,
        captadoPor: c.properties.ps26_captado_por || '',
        phone: c.properties.phone || '',
        company: c.properties.company || '',
        jobtitle: c.properties.jobtitle || '',
      });
    }
  }
}
const captadosNoEvento = [...existentes.values()].filter(e => e.captadoPor).length;
console.log('\nJá existiam no CRM: ' + existentes.size);
console.log('Desses, captados presencialmente pelo time: ' + captadosNoEvento + '  (serão preservados)');

/* ---------- monta as operações ---------- */
const criar = [], atualizar = [];
for (const u of unicos) {
  const ja = existentes.get(u.email);
  const base = {
    firstname: u.firstname, lastname: u.lastname,
    ...(u.phone ? { phone: u.phone } : {}),
    ...(u.company ? { company: u.company } : {}),
    ...(u.jobtitle ? { jobtitle: u.jobtitle } : {}),
    ...(u.ramo ? { ps26_ramo: u.ramo } : {}),
  };
  if (!ja) {
    criar.push({ properties: { email: u.email, ...base,
      ps26_origem_captura: 'Mailing pós-evento',
      ps26_contato_no_evento: 'Não' } });
  } else if (ja.captadoPor) {
    // captado presencialmente: só completa buracos, nunca sobrescreve a captação
    const faltando = {};
    if (!ja.phone && u.phone) faltando.phone = u.phone;
    if (!ja.company && u.company) faltando.company = u.company;
    if (!ja.jobtitle && u.jobtitle) faltando.jobtitle = u.jobtitle;
    if (Object.keys(faltando).length) atualizar.push({ id: ja.id, properties: faltando });
  } else {
    atualizar.push({ id: ja.id, properties: { ...base,
      ps26_origem_captura: 'Mailing pós-evento',
      ps26_contato_no_evento: 'Não' } });
  }
}
console.log('\nA criar: ' + criar.length + '  |  a atualizar: ' + atualizar.length);

if (SIMULAR) {
  console.log('\nAmostra do que seria criado:');
  criar.slice(0, 5).forEach(c => console.log('  ' + c.properties.email + '  ·  ' +
    (c.properties.company || '-') + '  ·  ' + (c.properties.jobtitle || '-')));
  const semTel = criar.filter(c => !c.properties.phone).length;
  const semRamo = criar.filter(c => !c.properties.ps26_ramo).length;
  console.log('\nQualidade: sem telefone ' + semTel + ' · sem ramo ' + semRamo);
  process.exit(0);
}

/* ---------- grava ---------- */
let nCriados = 0, nAtualizados = 0, nErros = 0;
/* Um único contato já existente derruba o lote inteiro (HTTP 409). Quando isso
   acontece, reprocessamos o lote em partes menores e, no limite, um a um —
   assim um conflito isolado não leva junto 99 contatos bons. */
async function criaEmLote(bloco, profundidade = 0) {
  const r = await api('POST', '/crm/v3/objects/contacts/batch/create', { inputs: bloco });
  if (r.ok || r.status === 207) {
    nCriados += (r.json.results || []).length;
    (r.json.errors || []).forEach(() => nErros++);
    return;
  }
  if (r.status === 409 && bloco.length > 1) {
    const meio = Math.ceil(bloco.length / 2);
    await criaEmLote(bloco.slice(0, meio), profundidade + 1);
    await criaEmLote(bloco.slice(meio), profundidade + 1);
    return;
  }
  if (r.status === 409 && bloco.length === 1) {
    // já existe: atualiza em vez de criar, sem perder o dado
    const m = r.txt.match(/Existing ID:\s*(\d+)/);
    if (m) {
      const props = { ...bloco[0].properties };
      delete props.email;
      const u = await api('PATCH', '/crm/v3/objects/contacts/' + m[1], { properties: props });
      if (u.ok) { nAtualizados++; return; }
    }
    nErros++; return;
  }
  nErros += bloco.length;
  console.log('  [ERRO lote criar] ' + r.status + ' ' + r.txt.slice(0, 160));
}
for (const bloco of pedacos(criar, 100)) {
  await criaEmLote(bloco);
  process.stdout.write('  criados: ' + nCriados + ' | atualizados: ' + nAtualizados + '   \r');
}
for (const bloco of pedacos(atualizar, 100)) {
  const r = await api('POST', '/crm/v3/objects/contacts/batch/update', { inputs: bloco });
  if (r.ok || r.status === 207) {
    nAtualizados += (r.json.results || []).length;
    (r.json.errors || []).forEach(() => nErros++);
  } else { nErros += bloco.length; console.log('  [ERRO lote atualizar] ' + r.status + ' ' + r.txt.slice(0, 200)); }
  process.stdout.write('  atualizados: ' + nAtualizados + '\r');
}

console.log('\n' + '='.repeat(52));
console.log('criados: ' + nCriados + ' | atualizados: ' + nAtualizados + ' | erros: ' + nErros);
console.log('Captações presenciais preservadas: ' + captadosNoEvento);
