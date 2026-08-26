# Captação de Leads — Projuris Summit 2026 (D4Sign)

Ativação da D4Sign no Projuris Summit 2026 — 27/08/2026, Cubo Itaú, São Paulo.

**Leitor de crachá:** https://marcoscosta-rgb.github.io/projuris-summit-2026/app/
**Formulário reserva:** https://marcoscosta-rgb.github.io/projuris-summit-2026/form/

## Como funciona
O executivo escolhe o próprio nome uma vez; o app grava isso no aparelho e carimba
todo lead captado ali. A leitura do QR do crachá preenche o que conseguir, o
executivo completa o resto em segundos, e o lead sobe para o HubSpot como contato
com 17 campos. Um segundo passo transforma cada contato em negócio no pipeline do
evento, já atribuído a quem captou.

Todo lead é gravado no celular **antes** de qualquer tentativa de envio, e a fila
sobe sozinha quando a conexão volta. Num evento lotado o sinal cai — nenhuma
captação se perde por isso.

## Estrutura
- `app/` — o leitor (interface, leitura de QR, fila offline, envio)
- `form/` — página com o formulário HubSpot embutido, usada como reserva
- `setup-hubspot.mjs` — cria pipeline, campos e formulário (idempotente)
- `sincroniza-deals.mjs` — gera os negócios no pipeline a partir dos contatos
- `importa-backup.mjs` — importa a cópia de segurança direto pela API do CRM
- `testes/` — parser de QR, validação estática, navegador, cor e produção

## No HubSpot
- Pipeline `929744040` — "Projuris Summit 2026", 8 etapas
- Formulário `7516a8ea-ce4d-4ac7-8084-39322536b259`
- 13 campos no grupo "Projuris Summit 2026" (prefixo `ps26_`)

## Duas armadilhas descobertas testando
Ambas fazem o HubSpot responder **HTTP 200 e descartar a submissão em silêncio** —
nada no retorno indica o problema:

1. **`context.pageUri` de domínio desconhecido.** O HubSpot valida essa URL contra
   os domínios da conta. O app envia um endereço do domínio da D4Sign, não o da
   hospedagem.
2. **`notifyRecipients` vazio** num formulário criado por API. É preciso ao menos
   um destinatário.

Uma terceira: o formulário **exige e-mail** e recusa endereços fabricados. Lead que
veio só com telefone entra pela cópia de segurança, que cria o contato sem e-mail
em vez de sujar a base com um endereço inventado.

## Rodando
```
HUBSPOT_TOKEN=... node setup-hubspot.mjs        # configuração inicial
HUBSPOT_TOKEN=... node sincroniza-deals.mjs     # durante e depois do evento
HUBSPOT_TOKEN=... node importa-backup.mjs leads.json
node testes/navegador.mjs                       # 34 verificações
node testes/producao.mjs                        # 15 verificações na URL real
```
O token fica em `.env`, fora do controle de versão.
