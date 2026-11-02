'use strict';

// Testes da importação do histórico, sem acessar o Futebol 80. Uso: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ErroRobo } = require('./atualizar.js');
const { baixarPagina, executar, nomeDaCompeticao, temporadaDoJogo } = require('./importar-historico.js');

const AGORA = new Date('2026-11-02T20:00:00Z');
const CARIMBO = '2026-11-02T17:00:00-03:00';

function linhaDeJogo([numero, data, competicao, local, pro, contra, adversario, resultado]) {
  const celulas = [numero, data, competicao, local, 'Bahia', pro, 'x', contra, adversario, 'Fulano e Sicrano', resultado, ''];
  const tds = celulas.map((c) => `<td height=17 class=xl67 style='height:12.75pt'>${c === '' ? '&nbsp;' : c}</td>`);
  return `<tr height=17 style='mso-height-source:userset'>\n  ${tds.join('\n  ')}\n </tr>`;
}

// Monta uma página no formato da planilha exportada pelo Excel, com os totais no fim.
function montarPagina(jogos, ajuste = {}) {
  const contar = (r) => jogos.filter((j) => j[7] === r).length;
  const somar = (i) => jogos.reduce((s, j) => s + (Number(j[i]) || 0), 0);
  const totais = {
    jogos: jogos.length,
    v: contar('v'),
    e: contar('e'),
    d: contar('d'),
    pro: somar(4),
    contra: somar(5),
    ...ajuste,
  };
  return `<html><head><style>.xl67 {color:red}</style></head><body>
<table><tr><td>Bitmap</td></tr></table>
<table>
 <tr><td>Nº</td><td>Data</td><td>Competição</td><td>L</td><td>Equipe</td><td colspan=3>Placar</td><td>Adversário</td><td>Gols</td><td></td><td></td></tr>
 ${jogos.map(linhaDeJogo).join('\n')}
 <tr><td></td><td></td><td></td><td></td><td colspan=2>${totais.pro}</td><td>x</td><td colspan=2>${totais.contra}</td><td></td><td></td></tr>
 <tr><td colspan=4>Bahia</td><td colspan=2>${totais.jogos}</td><td colspan=3>Jogos</td><td>Bahia</td><td></td></tr>
 <tr><td colspan=2>${totais.v}</td><td colspan=3>Vitórias</td><td></td></tr>
 <tr><td colspan=4>01/jan/1931</td><td colspan=2>${totais.e}</td><td colspan=3>Empates</td><td>site</td><td></td></tr>
 <tr><td></td><td></td><td></td><td></td><td colspan=2>${totais.d}</td><td colspan=3>Derrotas</td><td></td><td></td></tr>
</table></body></html>`;
}

const EXEMPLO = [
  ['1', '01/mar/1931', 'Torneio Início-Baiano', 'N', '2', '0', 'Ypiranga-BA', 'v'],
  ['2', '01/mar/1931', 'Torneio Início-Baiano', 'N', '3', '0', 'Royal-BA', 'v'],
  ['3', '10/mai/1931', 'Baiano', 'C', '6', '2', 'São Cristóvão-BA', 'v'],
  ['4', '24/out/1931', 'Amistoso', 'F', '0', '2', 'Sel. Sergipe', 'd'],
  ['5', '26/dez/1943', 'Baiano', 'N', '', 'WO', 'Botafogo de Salvador-BA', 'd'],
  ['6', '23/out/1960', 'Baiano', 'F', 'WO', '', 'Fluminense de Feira-BA', 'v'],
  ['7', '29/mar/1960', 'Brasileiro-Taça Brasil', 'N', '3', '1', 'Santos-SP', 'v'],
  ['8', '19/fev/1989', 'Brasileiro-Copa União', 'F', '0', '0', 'Internacional-RS', 'e'],
];

function criarPastaDados(t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'bahia-historico-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  fs.mkdirSync(path.join(pasta, 'jogos'));
  fs.writeFileSync(path.join(pasta, 'indice.json'), '{"ultima_atualizacao":null,"temporadas":[]}\n');
  return pasta;
}

function lerDados(pasta, ...caminho) {
  return JSON.parse(fs.readFileSync(path.join(pasta, ...caminho), 'utf8'));
}

function silenciar(t) {
  const log = t.mock.method(console, 'log', () => {});
  return () => log.mock.calls.map(({ arguments: partes }) => partes.join(' ')).join('\n');
}

function jogoDaApi(mudancas = {}) {
  return {
    id: 'api-555',
    data: '1931-05-10',
    hora: '16:00',
    competicao: 'Campeonato Baiano',
    fase: '1ª rodada',
    mandante: 'Bahia',
    visitante: 'São Cristóvão',
    gols_mandante: 6,
    gols_visitante: 2,
    penaltis: null,
    estadio: 'Fonte Nova',
    cidade: 'Salvador',
    situacao: 'encerrado',
    fonte: 'api-football',
    id_api: 555,
    atualizado_em: '2020-01-01T10:00:00-03:00',
    ...mudancas,
  };
}

test('jogo em casa: Bahia é o mandante, no formato combinado', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  const jogo = lerDados(pasta, 'jogos', '1931.json').jogos.find((j) => j.data === '1931-05-10');
  assert.deepEqual(jogo, {
    id: 'f80-1931-05-10-sao-cristovao-ba',
    data: '1931-05-10',
    hora: null,
    competicao: 'Campeonato Baiano',
    fase: null,
    mandante: 'Bahia',
    visitante: 'São Cristóvão-BA',
    gols_mandante: 6,
    gols_visitante: 2,
    penaltis: null,
    estadio: null,
    cidade: null,
    situacao: 'encerrado',
    fonte: 'futebol80',
    id_api: null,
    atualizado_em: CARIMBO,
  });
});

test('jogo fora: o adversário vira mandante e o placar é invertido', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  const jogo = lerDados(pasta, 'jogos', '1931.json').jogos.find((j) => j.data === '1931-10-24');
  assert.equal(jogo.mandante, 'Sel. Sergipe');
  assert.equal(jogo.visitante, 'Bahia');
  assert.equal(jogo.gols_mandante, 2);
  assert.equal(jogo.gols_visitante, 0);
});

test('campo neutro: o Bahia fica como mandante, na ordem da página', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  const jogo = lerDados(pasta, 'jogos', '1931.json').jogos[0];
  assert.equal(jogo.mandante, 'Bahia');
  assert.equal(jogo.visitante, 'Ypiranga-BA');
});

test('dois jogos no mesmo dia ficam nos dois, na ordem da página', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  const { jogos } = lerDados(pasta, 'jogos', '1931.json');
  assert.deepEqual(jogos.slice(0, 2).map((j) => j.visitante), ['Ypiranga-BA', 'Royal-BA']);
});

test('W.O. fica sem placar, encerrado', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  const [jogo] = lerDados(pasta, 'jogos', '1943.json').jogos;
  assert.equal(jogo.gols_mandante, null);
  assert.equal(jogo.gols_visitante, null);
  assert.equal(jogo.situacao, 'encerrado');
});

test('campeonato que terminou no ano seguinte fica no arquivo da edição', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  assert.equal(lerDados(pasta, 'jogos', '1959.json').jogos[0].visitante, 'Santos-SP');
  assert.equal(lerDados(pasta, 'jogos', '1988.json').jogos[0].data, '1989-02-19');
  assert.equal(fs.existsSync(path.join(pasta, 'jogos', '1989.json')), false);
});

test('temporada: cortes dos campeonatos que atravessaram o ano', () => {
  const casos = [
    ['Brasileiro-Nacional', '1974-02-10', 1973],
    ['Brasileiro-Nacional', '1974-03-09', 1974],
    ['Brasileiro-Copa Brasil', '1978-02-22', 1977],
    ['Brasileiro-Copa Brasil', '1978-03-26', 1978],
    ['Brasileiro-Copa Brasil', '1987-02-12', 1986],
    ['Brasileiro', '2021-02-25', 2020],
    ['Brasileiro', '2021-05-29', 2021],
    // Outra competição, no mesmo período, fica no ano da data.
    ['Baiano', '2021-02-25', 2021],
    ['Amistoso', '1960-03-29', 1960],
  ];
  for (const [competicao, data, temporada] of casos) {
    assert.equal(temporadaDoJogo({ competicao, data }), temporada, `${competicao} ${data}`);
  }
});

test('nomes das competições', () => {
  const casos = {
    Baiano: 'Campeonato Baiano',
    Brasileiro: 'Campeonato Brasileiro Série A',
    'Brasileiro-Série B': 'Campeonato Brasileiro Série B',
    'Brasileiro-Taça de Ouro': 'Campeonato Brasileiro (Taça de Ouro)',
    'Brasileiro-2ª Divisão-Taça de Prata': 'Campeonato Brasileiro (2ª Divisão, Taça de Prata)',
    'Sul-Americana': 'Copa Sul-Americana',
    'Copa do Nordeste': 'Copa do Nordeste',
    'Torneio-BA': 'Torneio-BA',
  };
  for (const [original, nome] of Object.entries(casos)) assert.equal(nomeDaCompeticao(original), nome);
});

test('atualiza o índice com as temporadas, da mais nova para a mais antiga', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  assert.deepEqual(lerDados(pasta, 'indice.json'), {
    ultima_atualizacao: CARIMBO,
    temporadas: [1988, 1960, 1959, 1943, 1931],
  });
});

test('mostra a contagem por década', async (t) => {
  const pasta = criarPastaDados(t);
  const registro = silenciar(t);
  const { porDecada } = await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  assert.deepEqual(porDecada, { 1930: 4, 1940: 1, 1950: 1, 1960: 1, 1980: 1 });
  assert.match(registro(), /1930-1939: 4/);
});

test('rodar de novo não duplica nem regrava nada', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });
  const arquivo = path.join(pasta, 'jogos', '1931.json');
  const antes = fs.readFileSync(arquivo, 'utf8');
  const indiceAntes = fs.readFileSync(path.join(pasta, 'indice.json'), 'utf8');

  const resultado = await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: new Date('2027-01-01T00:00:00Z') });

  assert.equal(resultado.novos, 0);
  assert.equal(resultado.iguais, EXEMPLO.length);
  assert.equal(resultado.algoMudou, false);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), antes);
  assert.equal(fs.readFileSync(path.join(pasta, 'indice.json'), 'utf8'), indiceAntes);
});

test('rodar de novo mantém o que outras fontes completaram', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });
  const arquivo = path.join(pasta, 'jogos', '1931.json');
  const dados = lerDados(pasta, 'jogos', '1931.json');
  Object.assign(dados.jogos[2], { estadio: 'Campo da Graça', cidade: 'Salvador', fase: '1º Turno', hora: '15:30' });
  fs.writeFileSync(arquivo, JSON.stringify(dados));

  const resultado = await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  assert.equal(resultado.alterados, 0);
  const jogo = lerDados(pasta, 'jogos', '1931.json').jogos[2];
  assert.equal(jogo.estadio, 'Campo da Graça');
  assert.equal(jogo.cidade, 'Salvador');
  assert.equal(jogo.fase, '1º Turno');
  assert.equal(jogo.hora, '15:30');
});

test('não apaga nem sobrescreve jogo que veio da API', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  const daApi = jogoDaApi();
  const outroDaApi = jogoDaApi({ id: 'api-556', id_api: 556, data: '1931-12-25', visitante: 'Outro' });
  fs.writeFileSync(path.join(pasta, 'jogos', '1931.json'), JSON.stringify({ temporada: 1931, jogos: [daApi, outroDaApi] }));

  const resultado = await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });

  const { jogos } = lerDados(pasta, 'jogos', '1931.json');
  assert.deepEqual(jogos.find((j) => j.id_api === 555), daApi);
  assert.deepEqual(jogos.find((j) => j.id_api === 556), outroDaApi);
  // O jogo de 10/05 já estava na API: a versão do Futebol 80 não entra.
  assert.equal(jogos.filter((j) => j.data === '1931-05-10').length, 1);
  assert.equal(resultado.ignorados, 1);
  // Os outros três de 1931 entram normalmente.
  assert.equal(jogos.filter((j) => j.fonte === 'futebol80').length, 3);
});

test('não apaga jogo do histórico que saiu da página', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO.slice(1)), instante: AGORA });

  assert.equal(lerDados(pasta, 'jogos', '1931.json').jogos.length, 4);
});

test('corrige jogo do histórico se o Futebol 80 mudar o placar', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA });
  const corrigido = EXEMPLO.map((j) => (j[0] === '3' ? [...j.slice(0, 4), '7', ...j.slice(5)] : j));

  const resultado = await executar({ pastaDados: pasta, html: montarPagina(corrigido), instante: AGORA });

  assert.equal(resultado.alterados, 1);
  const jogo = lerDados(pasta, 'jogos', '1931.json').jogos.find((j) => j.data === '1931-05-10');
  assert.equal(jogo.gols_mandante, 7);
});

for (const [campo, nome] of [['jogos', 'jogos'], ['v', 'vitórias'], ['e', 'empates'], ['d', 'derrotas'], ['pro', 'gols pró'], ['contra', 'gols contra']]) {
  test(`total de ${nome} diferente do da página cancela tudo`, async (t) => {
    const pasta = criarPastaDados(t);
    silenciar(t);
    await assert.rejects(
      executar({ pastaDados: pasta, html: montarPagina(EXEMPLO, { [campo]: 999 }), instante: AGORA }),
      (erro) => erro instanceof ErroRobo && erro.message.includes(`em ${nome}`) && erro.message.includes('Nada foi gravado'),
    );
    assert.deepEqual(fs.readdirSync(path.join(pasta, 'jogos')), []);
  });
}

test('página sem totais cancela tudo', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  const html = montarPagina(EXEMPLO).replace('Vitórias', 'Outra coisa');
  await assert.rejects(executar({ pastaDados: pasta, html, instante: AGORA }), /em vitórias/);
  assert.deepEqual(fs.readdirSync(path.join(pasta, 'jogos')), []);
});

test('placar que não combina com o resultado cancela tudo', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  const errado = [['1', '10/mai/1931', 'Baiano', 'C', '0', '2', 'Ypiranga-BA', 'v']];
  await assert.rejects(executar({ pastaDados: pasta, html: montarPagina(errado), instante: AGORA }), /não combina com o resultado/);
  assert.deepEqual(fs.readdirSync(path.join(pasta, 'jogos')), []);
});

test('linha fora do padrão cancela tudo, sem gravar pela metade', async (t) => {
  const casos = [
    [['1', '99/xxx/1931', 'Baiano', 'C', '1', '0', 'Ypiranga-BA', 'v'], /data "99\/xxx\/1931"/],
    [['1', '10/mai/1931', 'Baiano', 'Z', '1', '0', 'Ypiranga-BA', 'v'], /linha fora do padrão/],
    [['1', '10/mai/1931', 'Baiano', 'C', '?', '0', 'Ypiranga-BA', 'v'], /placar "\? x 0"/],
  ];
  silenciar(t);
  for (const [linha, mensagem] of casos) {
    const pasta = criarPastaDados(t);
    await assert.rejects(executar({ pastaDados: pasta, html: montarPagina([...EXEMPLO, linha]), instante: AGORA }), mensagem);
    assert.deepEqual(fs.readdirSync(path.join(pasta, 'jogos')), []);
  }
});

test('página sem nenhum jogo cancela tudo', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  await assert.rejects(executar({ pastaDados: pasta, html: '<html><table></table></html>', instante: AGORA }), /Nenhum jogo encontrado/);
});

test('arquivo de temporada corrompido não é sobrescrito', async (t) => {
  const pasta = criarPastaDados(t);
  silenciar(t);
  const arquivo = path.join(pasta, 'jogos', '1931.json');
  fs.writeFileSync(arquivo, '{ isto não é json');
  await assert.rejects(executar({ pastaDados: pasta, html: montarPagina(EXEMPLO), instante: AGORA }), /1931\.json não é um JSON válido/);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), '{ isto não é json');
});

test('download: entende os acentos da página, que não usa UTF-8', async (t) => {
  const bytes = Buffer.from('<td>São Cristóvão</td>', 'latin1');
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes, { status: 200 }));
  assert.equal(await baixarPagina(), '<td>São Cristóvão</td>');
});

test('download: erro do site e falha de rede dão mensagem clara', async (t) => {
  const simulado = t.mock.method(globalThis, 'fetch', async () => new Response('erro', { status: 503 }));
  await assert.rejects(baixarPagina(), /respondeu com o código 503/);

  simulado.mock.mockImplementation(async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  });
  await assert.rejects(baixarPagina(), /Não foi possível baixar a página do Futebol 80 \(ENOTFOUND\)/);
});
