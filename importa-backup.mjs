/**
 * Importa a cópia de segurança exportada pelo leitor de QR direto no CRM.
 *
 * Este caminho NÃO passa pelo formulário: cria o contato e o negócio pela API do
 * CRM, com o token. Serve como garantia caso alguma submissão tenha sido
 * descartada silenciosamente pela proteção anti-spam do HubSpot.
 *
 * É seguro rodar o mesmo arquivo várias vezes: contato existente é atualizado,
 * não duplicado, e quem já tem negócio no pipeline do evento é ignorado.
 *
 * Uso:  HUBSPOT_TOKEN=... node importa-backup.mjs leads-summit-marcos.json
 *       HUBSPOT_TOKEN=... node importa-backup.mjs arquivo.json --simular
 */

import fs from 'fs';

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }

const arquivo = process.argv[2];
if (!arquivo || !fs.existsSync(arquivo)) {
  console.error('Informe o arquivo JSON exportado pelo app. Ex.: node importa-backup.mjs leads.json');
  process.exit(1);
}
const SIMULAR = process.argv.includes('--simular');

const BASE = 'https://api.hubapi.com';
const PIPELINE = '929744040';
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

const pacote = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const leads = Array.isArray(pacote) ? pacote : (pacote.leads || []);
console.log('Arquivo: ' + arquivo);
console.log('Executivo: ' + (pacote.executivo || '(vários)') + ' | leads no arquivo: ' + leads.length);
if (!leads.length) process.exit(0);

const pl = await api('GET', '/crm/v3/pipelines/deals/' + PIPELINE);
if (!pl.ok) { console.error('Pipeline não encontrado.'); process.exit(1); }
const etapa = pl.json.stages.sort((a, b) => a.displayOrder - b.displayOrder)[0];

let criados = 0, atualizados = 0, comNegocio = 0, erros = 0;

for (const l of leads) {
  const partes = (l.nome || '').trim().split(/\s+/);
  // A API do CRM não exige e-mail. Quando o lead veio só com telefone, criamos o
  // contato sem e-mail em vez de inventar um endereço — endereços fabricados são
  // rejeitados pelo HubSpot e sujariam a base.
  const props = {
    ...(l.email ? { email: l.email } : {}),
    firstname: partes[0] || '',
    lastname: partes.slice(1).join(' ') || partes[0] || '',
    company: l.empresa || '',
    jobtitle: l.cargo || '',
    phone: l.telefone || '',
    ps26_captado_por: l.execNome || '',
    ps26_contato_no_evento: 'Sim',
    ps26_origem_captura: l.origem === 'qrcode' ? 'Leitor de QR Code' : 'Preenchimento manual',
    ps26_codigo_cracha: l.codigo || '',
    ps26_qr_bruto: l.bruto || '',
    ps26_ramo: l.ramo || '',
    ps26_funcionarios: l.funcionarios || '',
    ps26_usa_assinatura: l.assinatura || '',
    ps26_plataforma_atual: l.plataforma || '',
    ps26_contratos_mes: l.contratos || '',
    ps26_observacoes: l.obs || '',
    ps26_capturado_em: l.ts || '',
    ps26_sem_email: l.email ? 'Não' : 'Sim',
  };
  for (const k of Object.keys(props)) if (props[k] === '') delete props[k];

  if (SIMULAR) {
    console.log('  [simulado] ' + props.email + ' — ' + (props.company || '') + ' -> ' + (props.ps26_captado_por || 'sem dono'));
    criados++; continue;
  }

  // contato: cria, e se já existir, atualiza
  let contatoId = null;
  const c = await api('POST', '/crm/v3/objects/contacts', { properties: props });
  if (c.ok) { contatoId = c.json.id; criados++; console.log('  [criado] ' + (props.email || props.phone || l.nome)); }
  else if (c.status === 409) {
    const m = c.txt.match(/Existing ID:\s*(\d+)/);
    if (m) {
      contatoId = m[1];
      const u = await api('PATCH', '/crm/v3/objects/contacts/' + contatoId, { properties: props });
      if (u.ok) { atualizados++; console.log('  [atualizado] ' + (props.email || props.phone || l.nome)); }
      else { erros++; console.log('  [ERRO update] ' + props.email + ': ' + u.status + ' ' + u.txt.slice(0, 120)); continue; }
    } else { erros++; console.log('  [ERRO 409 sem id] ' + props.email); continue; }
  } else { erros++; console.log('  [ERRO] ' + props.email + ': ' + c.status + ' ' + c.txt.slice(0, 160)); continue; }

  // negócio no pipeline, se ainda não houver
  const assoc = await api('GET', '/crm/v4/objects/contacts/' + contatoId + '/associations/deals?limit=100');
  let jaTem = false;
  for (const d of (assoc.json?.results || [])) {
    const deal = await api('GET', '/crm/v3/objects/deals/' + d.toObjectId + '?properties=pipeline');
    if (deal.json?.properties?.pipeline === PIPELINE) { jaTem = true; break; }
  }
  if (jaTem) continue;

  const dono = DONOS[l.execNome];
  const r = await api('POST', '/crm/v3/objects/deals', {
    properties: {
      dealname: (l.nome || props.email) + (l.empresa ? ' — ' + l.empresa : ''),
      pipeline: PIPELINE, dealstage: etapa.id,
      ...(dono ? { hubspot_owner_id: String(dono) } : {}),
    },
    associations: [{ to: { id: contatoId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }],
  });
  if (r.ok) comNegocio++;
  else { erros++; console.log('  [ERRO negocio] ' + props.email + ': ' + r.status + ' ' + r.txt.slice(0, 140)); }
}

console.log('\n' + '='.repeat(52));
console.log('contatos criados: ' + criados + ' | atualizados: ' + atualizados +
            ' | negócios criados: ' + comNegocio + ' | erros: ' + erros);
