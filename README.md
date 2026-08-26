# Captação de Leads — Projuris Summit 2026 (D4Sign)

Ferramenta de captação de leads para a ativação da D4Sign no Projuris Summit 2026
(27/08/2026, Cubo Itaú, São Paulo).

## O que é
Web app instalável no celular (PWA) que lê o QR Code do crachá do participante,
qualifica o lead em poucos toques e envia para um pipeline dedicado no HubSpot,
carimbando qual executivo fez a captação.

## Por que funciona sem internet
Todo lead é gravado no próprio celular antes de qualquer tentativa de envio.
A fila sobe sozinha quando a conexão volta. Num evento lotado, o sinal cai —
e nenhuma captação se perde por causa disso.

## Estrutura
- `app/index.html` — aplicação (interface + leitura + fila + envio)
- `app/config.js` — portal HubSpot, GUID do formulário e listas de qualificação
- `app/jsqr.js` — decodificador de QR embutido (funciona offline)
- `app/sw.js` — service worker: cacheia tudo para uso offline
- `app/manifest.json` — permite "adicionar à tela de início"
