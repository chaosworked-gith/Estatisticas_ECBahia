'use strict';

// Testes do arquivo que reúne toda a história. Uso: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { COLUNAS, gerarHistoria } = require('./gerar-historia.js');

function jogo(mudancas = {}) {
  return {
    id: 'x',
    data: '1988-02-01',
    hora: null,
    competicao: 'Campeonato Baiano',
    fase: null,
    mandante: 'Bahia',
    visitante: 'Ypiranga-BA',
    gols_mandante: 2,
    gols_visitante: 0,
    penaltis: null,
    estadio: null,
    cidade: null,
    situacao: 'encerrado',
    fonte: 'futebol80',
    id_api: null,
    atualizado_em: '2026-01-01T00:00:00-03:00',
    ...mudancas,
  };
}

function criarPasta(t, temporadas) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'bahia-historia-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  fs.mkdirSync(path.join(pasta, 'jogos'));
  for (const [ano, jogos] of Object.entries(temporadas)) {
    fs.writeFileSync(path.join(pasta, 'jogos', `${ano}.json`), JSON.stringify({ temporada: Number(ano), jogos }));
  }
  return pasta;
}

const ler = (pasta) => JSON.parse(fs.readFileSync(path.join(pasta, 'historia.json'), 'utf8'));

test('reúne os jogos de todas as temporadas, com a temporada do arquivo', (t) => {
  const pasta = criarPasta(t, {
    1988: [jogo(), jogo({ data: '1989-02-19', mandante: 'Internacional-RS', visitante: 'Bahia', gols_mandante: 0 })],
    1931: [jogo({ data: '1931-03-01' })],
  });
  const resultado = gerarHistoria(pasta);
  assert.deepEqual(resultado, { jogos: 3, temporadas: 2, mudou: true });

  const { colunas, jogos } = ler(pasta);
  assert.deepEqual(colunas, COLUNAS);
  assert.deepEqual(jogos[0], [1931, '1931-03-01', 'Campeonato Baiano', 'Bahia', 'Ypiranga-BA', 2, 0]);
  // O jogo de 1989 fica na temporada 1988, como no arquivo.
  assert.deepEqual(jogos[2], [1988, '1989-02-19', 'Campeonato Baiano', 'Internacional-RS', 'Bahia', 0, 0]);
});

test('só entra jogo encerrado', (t) => {
  const pasta = criarPasta(t, {
    2026: [jogo(), jogo({ situacao: 'agendado' }), jogo({ situacao: 'ao_vivo' }), jogo({ situacao: 'adiado' }), jogo({ situacao: 'cancelado' })],
  });
  assert.equal(gerarHistoria(pasta).jogos, 1);
});

test('W.O. entra sem placar, para o site poder avisar que ficou fora da conta', (t) => {
  const pasta = criarPasta(t, { 1943: [jogo({ gols_mandante: null, gols_visitante: null })] });
  gerarHistoria(pasta);
  assert.deepEqual(ler(pasta).jogos[0].slice(-2), [null, null]);
});

test('não guarda nenhum número calculado', (t) => {
  const pasta = criarPasta(t, { 1988: [jogo()] });
  gerarHistoria(pasta);
  assert.deepEqual(Object.keys(ler(pasta)), ['colunas', 'jogos']);
});

test('sem mudança nos jogos, não regrava o arquivo', (t) => {
  const pasta = criarPasta(t, { 1988: [jogo()] });
  gerarHistoria(pasta);
  const arquivo = path.join(pasta, 'historia.json');
  const antes = fs.statSync(arquivo).mtimeMs;
  const resultado = gerarHistoria(pasta);
  assert.equal(resultado.mudou, false);
  assert.equal(fs.statSync(arquivo).mtimeMs, antes);
});

test('mudou um jogo, o arquivo é atualizado', (t) => {
  const pasta = criarPasta(t, { 1988: [jogo()] });
  gerarHistoria(pasta);
  fs.writeFileSync(path.join(pasta, 'jogos', '1988.json'), JSON.stringify({ temporada: 1988, jogos: [jogo({ gols_mandante: 5 })] }));
  assert.equal(gerarHistoria(pasta).mudou, true);
  assert.equal(ler(pasta).jogos[0][5], 5);
});

test('ignora arquivos que não são de temporada', (t) => {
  const pasta = criarPasta(t, { 1988: [jogo()] });
  fs.writeFileSync(path.join(pasta, 'jogos', 'anotacoes.json'), '{ isto não é json');
  assert.equal(gerarHistoria(pasta).temporadas, 1);
});
