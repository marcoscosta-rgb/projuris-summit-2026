/**
 * Configura o HubSpot para a ativação do Projuris Summit 2026.
 *
 * Cria, de forma idempotente (rodar duas vezes não duplica nada):
 *   1. grupo de propriedades do evento, no contato
 *   2. propriedades de qualificação e rastreio
 *   3. pipeline de negócios dedicado, com as etapas da cadência
 *   4. formulário de captação (usado pelo leitor de QR e como fallback)
 *
 * Uso:  HUBSPOT_TOKEN=pat-na1-... node setup-hubspot.mjs
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Falta HUBSPOT_TOKEN no ambiente.'); process.exit(1); }

const BASE = 'https://api.hubapi.com';
const GRUPO = 'projuris_summit_2026';

const EXECUTIVOS = [
  'Marcos Costa', 'Simone de Alencar Rodrigues', 'Amanda Costa',
  'Leonardo Santos', 'Larissa Cavalcante', 'Marcella Figueiredo',
];
const RAMOS = ['Escritório de Advocacia', 'Departamento Jurídico', 'Contabilidade',
  'Financeiro / Banco', 'Saúde', 'Educação', 'Varejo / E-commerce', 'Indústria',
  'Tecnologia', 'Imobiliário', 'Serviços', 'Setor Público', 'Outro'];
const FUNCIONARIOS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
const CONTRATOS = ['Até 50', '51-200', '201-500', '501-1000', '1000-5000', '5000+'];

const opts = arr => arr.map((v, i) => ({ label: v, value: v, displayOrder: i, hidden: false }));

async function api(metodo, caminho, corpo) {
  const res = await fetch(BASE + caminho, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* resposta nao-JSON */ }
  return { ok: res.ok, status: res.status, json, txt };
}

const log = { feito: [], pulado: [], erro: [] };
const marca = (tipo, msg) => { log[tipo].push(msg); console.log(
  ({ feito: '  [criado] ', pulado: '  [ja existia] ', erro: '  [ERRO] ' })[tipo] + msg); };

/* ---------------- 1. grupo de propriedades ---------------- */
async function grupo() {
  console.log('\n1) Grupo de propriedades');
  const r = await api('POST', '/crm/v3/properties/contacts/groups', {
    name: GRUPO, label: 'Projuris Summit 2026', displayOrder: -1,
  });
  if (r.ok) marca('feito', 'grupo "Projuris Summit 2026"');
  else if (r.status === 409) marca('pulado', 'grupo "Projuris Summit 2026"');
  else marca('erro', 'grupo: ' + r.status + ' ' + r.txt.slice(0, 200));
}

/* ---------------- 2. propriedades ---------------- */
const PROPS = [
  { name: 'ps26_captado_por', label: 'PS26 · Captado por (executivo)', type: 'enumeration',
    fieldType: 'select', options: opts(EXECUTIVOS),
    description: 'Executivo da D4Sign que fez a captação do lead no Projuris Summit 2026.' },
  { name: 'ps26_contato_no_evento', label: 'PS26 · Houve contato no evento?', type: 'enumeration',
    fieldType: 'select', options: opts(['Sim', 'Não']),
    description: 'Separa quem foi abordado presencialmente de quem veio do mailing pós-evento.' },
  { name: 'ps26_origem_captura', label: 'PS26 · Origem da captura', type: 'enumeration',
    fieldType: 'select',
    options: opts(['Leitor de QR Code', 'Preenchimento manual', 'Formulário', 'Mailing pós-evento']),
    description: 'Por qual caminho o lead entrou.' },
  { name: 'ps26_codigo_cracha', label: 'PS26 · Código do crachá', type: 'string', fieldType: 'text',
    description: 'Código lido do QR do crachá. Chave para cruzar com o mailing da organização.' },
  { name: 'ps26_qr_bruto', label: 'PS26 · Conteúdo bruto do QR', type: 'string', fieldType: 'text',
    description: 'Conteúdo exato lido do QR, guardado para auditoria e reprocessamento.' },
  { name: 'ps26_ramo', label: 'PS26 · Ramo da empresa', type: 'enumeration', fieldType: 'select',
    options: opts(RAMOS) },
  { name: 'ps26_funcionarios', label: 'PS26 · Número de funcionários', type: 'enumeration',
    fieldType: 'select', options: opts(FUNCIONARIOS) },
  { name: 'ps26_usa_assinatura', label: 'PS26 · Já usa assinatura eletrônica?', type: 'enumeration',
    fieldType: 'select', options: opts(['Sim', 'Não', 'Não sei']) },
  { name: 'ps26_plataforma_atual', label: 'PS26 · Qual plataforma usa', type: 'string',
    fieldType: 'text', description: 'Concorrente em uso, quando houver.' },
  { name: 'ps26_contratos_mes', label: 'PS26 · Contratos enviados por mês', type: 'enumeration',
    fieldType: 'select', options: opts(CONTRATOS) },
  { name: 'ps26_observacoes', label: 'PS26 · Observações do executivo', type: 'string',
    fieldType: 'textarea', description: 'O que foi conversado, dor mencionada, próximo passo.' },
  { name: 'ps26_capturado_em', label: 'PS26 · Momento da captura', type: 'string', fieldType: 'text' },
  { name: 'ps26_sem_email', label: 'PS26 · Lead sem e-mail real', type: 'enumeration',
    fieldType: 'select', options: opts(['Sim', 'Não']),
    description: 'Sim = e-mail é um marcador técnico; o contato precisa ser completado depois.' },
];

async function propriedades() {
  console.log('\n2) Propriedades de contato (' + PROPS.length + ')');
  for (const p of PROPS) {
    const r = await api('POST', '/crm/v3/properties/contacts',
      { ...p, groupName: GRUPO, hasUniqueValue: false, hidden: false, formField: true });
    if (r.ok) marca('feito', p.name);
    else if (r.status === 409) marca('pulado', p.name);
    else marca('erro', p.name + ': ' + r.status + ' ' + r.txt.slice(0, 160));
  }
}

/* ---------------- 3. pipeline ---------------- */
const ETAPAS = [
  { label: 'Lead captado no evento', probability: '0.05' },
  { label: 'Tentativa de contato', probability: '0.10' },
  { label: 'Contato estabelecido (SAL)', probability: '0.25' },
  { label: 'Reunião agendada', probability: '0.40' },
  { label: 'Proposta comercial (SQL)', probability: '0.60' },
  { label: 'GANHO', probability: '1.0', won: true },
  { label: 'PERDIDO', probability: '0.0', won: false },
  { label: 'Desqualificado', probability: '0.0', won: false },
];

async function pipeline() {
  console.log('\n3) Pipeline de negócios');
  const atual = await api('GET', '/crm/v3/pipelines/deals');
  if (!atual.ok) { marca('erro', 'não consegui listar pipelines: ' + atual.status + ' ' + atual.txt.slice(0, 200)); return null; }
  const existe = (atual.json.results || []).find(p => p.label === 'Projuris Summit 2026');
  if (existe) {
    marca('pulado', 'pipeline "Projuris Summit 2026" (id ' + existe.id + ')');
    return existe;
  }
  const r = await api('POST', '/crm/v3/pipelines/deals', {
    label: 'Projuris Summit 2026',
    displayOrder: 0,
    stages: ETAPAS.map((e, i) => ({
      label: e.label, displayOrder: i,
      metadata: { isClosed: (e.won !== undefined) ? 'true' : 'false', probability: e.probability },
    })),
  });
  if (r.ok) { marca('feito', 'pipeline "Projuris Summit 2026" (id ' + r.json.id + ')'); return r.json; }
  marca('erro', 'pipeline: ' + r.status + ' ' + r.txt.slice(0, 300));
  return null;
}

/* ---------------- 4. formulário ---------------- */
function campo(name, label, required = false, extra = {}) {
  return {
    objectTypeId: '0-1', name, label, required, hidden: false,
    fieldType: extra.fieldType || 'single_line_text',
    ...(extra.options ? {
      options: extra.options.map((o, i) => ({ label: o, value: o, description: '', displayOrder: i })),
    } : {}),
    ...(extra.placeholder ? { placeholder: extra.placeholder } : {}),
  };
}
function grupoCampos(campos) { return { groupType: 'default_group', richTextType: 'text', fields: campos }; }

async function formulario() {
  console.log('\n4) Formulário de captação');
  const lista = await api('GET', '/marketing/v3/forms?limit=100');
  if (lista.ok) {
    const existe = (lista.json.results || []).find(f => f.name === 'Captação — Projuris Summit 2026');
    if (existe) { marca('pulado', 'formulário (guid ' + existe.id + ')'); return existe; }
  }
  const agora = new Date().toISOString();
  const body = {
    formType: 'hubspot',
    name: 'Captação — Projuris Summit 2026',
    archived: false,
    createdAt: agora,
    updatedAt: agora,
    fieldGroups: [
      grupoCampos([
        campo('ps26_captado_por', 'Quem está captando (executivo D4Sign)', true,
          { fieldType: 'dropdown', options: EXECUTIVOS }),
      ]),
      grupoCampos([
        campo('firstname', 'Nome', true),
        campo('lastname', 'Sobrenome', false),
      ]),
      grupoCampos([campo('email', 'E-mail', true, { placeholder: 'para retomar o contato depois' })]),
      grupoCampos([campo('phone', 'Telefone / WhatsApp', false, { fieldType: 'phone' })]),
      grupoCampos([campo('company', 'Empresa', true)]),
      grupoCampos([campo('jobtitle', 'Cargo', false)]),
      grupoCampos([campo('ps26_ramo', 'Ramo da empresa', false, { fieldType: 'dropdown', options: RAMOS })]),
      grupoCampos([campo('ps26_funcionarios', 'Número de funcionários', false,
        { fieldType: 'dropdown', options: FUNCIONARIOS })]),
      grupoCampos([campo('ps26_usa_assinatura', 'Já usa plataforma de assinatura eletrônica?', false,
        { fieldType: 'dropdown', options: ['Sim', 'Não', 'Não sei'] })]),
      grupoCampos([campo('ps26_plataforma_atual', 'Se sim, qual plataforma?', false)]),
      grupoCampos([campo('ps26_contratos_mes', 'Contratos enviados por mês', false,
        { fieldType: 'dropdown', options: CONTRATOS })]),
      grupoCampos([campo('ps26_observacoes', 'Observações / dados extras', false,
        { fieldType: 'multi_line_text', placeholder: 'Dor mencionada, urgência, próximo passo…' })]),
      grupoCampos([campo('ps26_contato_no_evento', 'Houve contato no evento?', false,
        { fieldType: 'dropdown', options: ['Sim', 'Não'] })]),
      grupoCampos([campo('ps26_origem_captura', 'Origem da captura', false,
        { fieldType: 'dropdown', options: ['Leitor de QR Code', 'Preenchimento manual', 'Formulário', 'Mailing pós-evento'] })]),
      grupoCampos([campo('ps26_codigo_cracha', 'Código do crachá', false)]),
      grupoCampos([campo('ps26_qr_bruto', 'Conteúdo bruto do QR', false)]),
      grupoCampos([campo('ps26_capturado_em', 'Momento da captura', false)]),
      grupoCampos([campo('ps26_sem_email', 'Lead sem e-mail real', false,
        { fieldType: 'dropdown', options: ['Sim', 'Não'] })]),
    ],
    configuration: {
      language: 'pt-br',
      cloneable: true,
      editable: true,
      archivable: true,
      recaptchaEnabled: false,
      notifyContactOwner: false,
      // ATENÇÃO: com notifyRecipients vazio o HubSpot aceita as submissões (HTTP 200)
      // mas não as processa — nenhum contato é criado e nada indica o problema.
      // Descoberto testando; manter ao menos um destinatário.
      notifyRecipients: ['92039545'],
      createNewContactForNewEmail: true,
      prePopulateKnownValues: false,
      allowLinkToResetKnownValues: true,
      embedType: 'V3',
      postSubmitAction: {
        type: 'thank_you',
        value: '<h2 style="text-align:center">Lead registrado</h2>' +
               '<p style="text-align:center">Pode seguir para o próximo.</p>',
      },
    },
    displayOptions: {
      renderRawHtml: false,
      theme: 'round',
      submitButtonText: 'Salvar lead',
      cssClass: 'hs-form stacked',
      style: { backgroundWidth: '100%', labelTextSize: '14px', submitAlignment: 'left' },
    },
    legalConsentOptions: { type: 'none' },
  };
  const r = await api('POST', '/marketing/v3/forms', body);
  if (r.ok) { marca('feito', 'formulário (guid ' + r.json.id + ')'); return r.json; }
  marca('erro', 'formulário: ' + r.status + ' ' + r.txt.slice(0, 500));
  return null;
}

/* ---------------- execução ---------------- */
console.log('Configurando HubSpot — Projuris Summit 2026');
const me = await api('GET', '/oauth/v1/access-tokens/' + TOKEN).catch(() => null);
await grupo();
await propriedades();
const pl = await pipeline();
const fm = await formulario();

console.log('\n' + '='.repeat(52));
console.log('criados: ' + log.feito.length + ' | já existiam: ' + log.pulado.length + ' | erros: ' + log.erro.length);
if (pl) console.log('PIPELINE_ID=' + pl.id);
if (fm) console.log('FORM_GUID=' + fm.id);
if (log.erro.length) { console.log('\nErros:'); log.erro.forEach(e => console.log(' - ' + e)); process.exit(1); }
