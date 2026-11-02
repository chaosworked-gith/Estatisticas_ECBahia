'use strict';

// Junta os jogos encerrados de todas as temporadas em dados/historia.json, para o site mostrar
// toda a história sem baixar 95 arquivos. Guarda só os jogos: as contas continuam no site.
// Roda sozinho antes de cada publicação no Firebase (veja firebase.json).

const fs = require('node:fs');
const path = require('node:path');

const { PASTA_DADOS, lerJson } = require('./atualizar.js');

const COLUNAS = ['temporada', 'data', 'competicao', 'mandante', 'visitante', 'gols_mandante', 'gols_visitante'];

function gerarHistoria(pastaDados = PASTA_DADOS) {
  const pastaJogos = path.join(pastaDados, 'jogos');
  const arquivos = fs.readdirSync(pastaJogos).filter((nome) => /^\d{4}\.json$/.test(nome)).sort();

  const jogos = [];
  for (const nome of arquivos) {
    const temporada = Number(nome.slice(0, 4));
    for (const jogo of lerJson(path.join(pastaJogos, nome), { jogos: [] }).jogos) {
      if (jogo.situacao !== 'encerrado') continue;
      jogos.push(COLUNAS.map((coluna) => (coluna === 'temporada' ? temporada : jogo[coluna] ?? null)));
    }
  }

  const arquivo = path.join(pastaDados, 'historia.json');
  const dados = { colunas: COLUNAS, jogos };
  const atual = lerJson(arquivo, null);
  if (atual !== null && JSON.stringify(atual) === JSON.stringify(dados)) {
    return { jogos: jogos.length, temporadas: arquivos.length, mudou: false };
  }

  // Um jogo por linha: fica bem menor que o JSON indentado e ainda dá para ler a diferença no Git.
  const linhas = jogos.map((jogo) => JSON.stringify(jogo)).join(',\n');
  fs.writeFileSync(arquivo, `{"colunas":${JSON.stringify(COLUNAS)},"jogos":[\n${linhas}\n]}\n`);
  return { jogos: jogos.length, temporadas: arquivos.length, mudou: true };
}

if (require.main === module) {
  const { jogos, temporadas, mudou } = gerarHistoria();
  console.log(`História: ${jogos} jogos encerrados em ${temporadas} temporadas. ${mudou ? 'Arquivo gravado.' : 'Nada mudou.'}`);
}

module.exports = { COLUNAS, gerarHistoria };
