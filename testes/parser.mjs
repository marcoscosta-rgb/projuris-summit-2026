import fs from 'fs';
const html = fs.readFileSync('/Users/marcoscosta/projuris-summit-2026/app/index.html','utf8');

// extrai a funcao parseQR REAL do arquivo, contando chaves
const ini = html.indexOf('function parseQR(txt){');
if (ini < 0) throw new Error('parseQR nao encontrada');
const fimMarca = html.indexOf('/* ---------- camera ---------- */', ini);
if (fimMarca < 0) throw new Error('marcador de fim nao encontrado');
const src = html.slice(ini, fimMarca);
const parseQR = new Function(src + '; return parseQR;')();

const casos = [
  { nome:'Sympla real (crachá do Marcos)', in:'UT9UBBGC7L',
    esp:{ formato:'codigo', codigo:'UT9UBBGC7L' } },
  { nome:'vCard completo',
    in:'BEGIN:VCARD\nVERSION:3.0\nFN:Ana Paula Ribeiro\nORG:Ribeiro Advogados;Juridico\nTITLE:Sócia\nEMAIL:ana@ribeiro.adv.br\nTEL;CELL:+5511998877665\nEND:VCARD',
    esp:{ formato:'vcard', nome:'Ana Paula Ribeiro', empresa:'Ribeiro Advogados',
          cargo:'Sócia', email:'ana@ribeiro.adv.br', telefone:'+5511998877665' } },
  { nome:'vCard só com N (sem FN)',
    in:'BEGIN:VCARD\nN:Souza;Carlos;;;\nEMAIL:carlos@x.com\nEND:VCARD',
    esp:{ nome:'Carlos Souza', email:'carlos@x.com' } },
  { nome:'MECARD', in:'MECARD:N:Silva,Joao;TEL:11999998888;EMAIL:joao@silva.com;ORG:Silva Ltda;;',
    esp:{ formato:'mecard', nome:'Joao Silva', telefone:'11999998888', email:'joao@silva.com', empresa:'Silva Ltda' } },
  { nome:'JSON', in:'{"nome":"Marina Alves","empresa":"Alves Corp","cargo":"Diretora","email":"m@alves.com","codigo":"ABC123"}',
    esp:{ formato:'json', nome:'Marina Alves', empresa:'Alves Corp', cargo:'Diretora', email:'m@alves.com', codigo:'ABC123' } },
  { nome:'URL com querystring', in:'https://evento.com/p?nome=Pedro+Lima&empresa=Lima+SA&email=p@lima.com',
    esp:{ formato:'url', nome:'Pedro Lima', empresa:'Lima SA', email:'p@lima.com' } },
  { nome:'URL só com id no path', in:'https://sympla.com.br/checkin/XYZ789',
    esp:{ formato:'url', codigo:'XYZ789' } },
  { nome:'Delimitado por ;', in:'Rafael Costa;Costa Advogados;rafael@costa.com;11988887777',
    esp:{ formato:'delimitado', nome:'Rafael Costa', empresa:'Costa Advogados',
          email:'rafael@costa.com', telefone:'11988887777' } },
  { nome:'Texto solto multilinha', in:'Juliana Menezes\nMenezes Consultoria\njuliana@menezes.com.br',
    esp:{ formato:'texto', nome:'Juliana Menezes', empresa:'Menezes Consultoria', email:'juliana@menezes.com.br' } },
  { nome:'Vazio', in:'', esp:{ formato:'desconhecido' } },
];

let ok = 0, falhas = [];
for (const c of casos){
  const r = parseQR(c.in);
  const erros = [];
  for (const [k,v] of Object.entries(c.esp)){
    if (r[k] !== v) erros.push(`${k}: esperado ${JSON.stringify(v)}, veio ${JSON.stringify(r[k])}`);
  }
  if (erros.length){ falhas.push({ nome:c.nome, erros }); console.log(`✗ ${c.nome}`); erros.forEach(e=>console.log('    '+e)); }
  else { ok++; console.log(`✓ ${c.nome}`); }
}
console.log(`\n${ok}/${casos.length} passaram`);
if (falhas.length) process.exit(1);
