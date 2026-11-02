'use strict';

// Testes do robô, sem acessar a API de verdade. Uso: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ErroRobo,
  acharMesmoJogo,
  converterJogos,
  executar,
  formatarInstante,
  juntarJogos,
  temJogoPorPerto,
  traduzirFase,
} = require('./atualizar.js');

const ID_BAHIA = 118;
const CHAVE = 'chave-falsa-do-teste';
const HORA_1 = new Date('2026-04-01T12:00:00-03:00');
const HORA_2 = new Date('2026-04-02T12:00:00-03:00');
const HORA_3 = new Date('2026-04-03T12:00:00-03:00');
const CARIMBO = '2026-04-01T12:00:00-03:00';

function jogoApi({
  id = 1001,
  data = '2026-04-12T16:00:00-03:00',
  situacao = 'FT',
  rodada = 'Regular Season - 3',
  liga = 'Serie A',
  pais = 'Brazil',
  casa = 2,
  fora = 1,
  penaltis = { home: null, away: null },
} = {}) {
  return {
    fixture: {
      id,
      date: data,
      venue: { id: 216, name: 'Arena Fonte Nova', city: 'Salvador, Bahia' },
      status: { short: situacao },
    },
    league: { id: 71, name: liga, country: pais, season: 2026, round: rodada },
    teams: { home: { id: ID_BAHIA, name: 'Bahia' }, away: { id: 121, name: 'Palmeiras' } },
    goals: { home: casa, away: fora },
    score: { penalty: penaltis },
  };
}

function converterUm(item) {
  const { jogos, avisos } = converterJogos([item], ID_BAHIA, CARIMBO);
  return { jogo: jogos[0], avisos };
}

function jogoHistorico() {
  return {
    id: 'f80-2026-01-10-bahia-jacuipense',
    data: '2026-01-10',
    hora: null,
    competicao: 'Campeonato Baiano',
    fase: null,
    mandante: 'Bahia',
    visitante: 'Jacuipense',
    gols_mandante: 3,
    gols_visitante: 0,
    penaltis: null,
    estadio: null,
    cidade: null,
    situacao: 'encerrado',
    fonte: 'futebol80',
    id_api: null,
    atualizado_em: '2026-02-01T10:00:00-03:00',
  };
}

// Pasta de dados temporária, igual à do repositório recém-criado.
function criarPastaDados(t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'bahia-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  fs.mkdirSync(path.join(pasta, 'jogos'));
  fs.writeFileSync(path.join(pasta, 'indice.json'), '{"ultima_atualizacao":null,"temporadas":[]}\n');
  return pasta;
}

function lerDados(pasta, ...caminho) {
  return JSON.parse(fs.readFileSync(path.join(pasta, ...caminho), 'utf8'));
}

function respostaTimes() {
  return {
    errors: [],
    response: [
      { team: { id: 9999, name: 'Bahia De Feira', country: 'Brazil', national: false } },
      { team: { id: ID_BAHIA, name: 'Bahia', country: 'Brazil', national: false } },
    ],
  };
}

// Troca o fetch por uma API de mentira. "respostas" diz o que cada endereço devolve.
function simularApi(t, respostas) {
  const chamadas = [];
  const simulado = t.mock.method(globalThis, 'fetch', async (url, opcoes) => {
    const endereco = new URL(url);
    chamadas.push({ endereco, chave: opcoes.headers['x-apisports-key'] });
    const { corpo, status = 200, cabecalhos } = respostas[endereco.pathname];
    return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), {
      status,
      headers: cabecalhos ?? {
        'x-ratelimit-requests-remaining': '97',
        'x-ratelimit-requests-limit': '100',
      },
    });
  });
  return { chamadas, trocar: (novas) => Object.assign(respostas, novas), simulado };
}

function capturarRegistro(t) {
  const log = t.mock.method(console, 'log', () => {});
  return () => log.mock.calls.map(({ arguments: partes }) => partes.join(' ')).join('\n');
}

function executarEm(pasta, instante = HORA_1) {
  return executar({ pastaDados: pasta, chave: CHAVE, instante });
}

test('conversão: monta o jogo no formato combinado', () => {
  const { jogo, avisos } = converterUm(jogoApi());
  assert.deepEqual(jogo, {
    id: 'api-1001',
    data: '2026-04-12',
    hora: '16:00',
    competicao: 'Campeonato Brasileiro Série A',
    fase: '3ª rodada',
    mandante: 'Bahia',
    visitante: 'Palmeiras',
    gols_mandante: 2,
    gols_visitante: 1,
    penaltis: null,
    estadio: 'Arena Fonte Nova',
    cidade: 'Salvador',
    situacao: 'encerrado',
    fonte: 'api-football',
    id_api: 1001,
    atualizado_em: CARIMBO,
  });
  assert.deepEqual(avisos, []);
});

test('conversão: leva o horário para o fuso de Salvador, mesmo virando o dia', () => {
  const { jogo } = converterUm(jogoApi({ data: '2026-04-13T01:30:00+00:00' }));
  assert.equal(jogo.data, '2026-04-12');
  assert.equal(jogo.hora, '22:30');
});

test('conversão: horário a definir fica vazio', () => {
  const { jogo } = converterUm(jogoApi({ situacao: 'TBD', casa: null, fora: null, data: '2026-05-01T00:00:00-03:00' }));
  assert.equal(jogo.data, '2026-05-01');
  assert.equal(jogo.hora, null);
  assert.equal(jogo.situacao, 'agendado');
  assert.equal(jogo.gols_mandante, null);
  assert.equal(jogo.gols_visitante, null);
});

test('conversão: guarda a disputa de pênaltis', () => {
  const { jogo } = converterUm(jogoApi({ situacao: 'PEN', casa: 1, fora: 1, penaltis: { home: 4, away: 3 } }));
  assert.deepEqual(jogo.penaltis, { mandante: 4, visitante: 3 });
  assert.equal(jogo.situacao, 'encerrado');
});

test('conversão: cada código da API vira a situação certa', () => {
  const esperado = {
    NS: 'agendado',
    '1H': 'ao_vivo',
    HT: 'ao_vivo',
    '2H': 'ao_vivo',
    FT: 'encerrado',
    AET: 'encerrado',
    PST: 'adiado',
    SUSP: 'adiado',
    CANC: 'cancelado',
    ABD: 'cancelado',
  };
  for (const [codigo, situacao] of Object.entries(esperado)) {
    assert.equal(converterUm(jogoApi({ situacao: codigo })).jogo.situacao, situacao, codigo);
  }
});

test('conversão: situação desconhecida não entra e gera aviso', () => {
  const { jogos, avisos } = converterJogos([jogoApi({ situacao: 'XYZ' })], ID_BAHIA, CARIMBO);
  assert.deepEqual(jogos, []);
  assert.match(avisos[0], /situação desconhecida "XYZ"/);
});

test('conversão: competições em português', () => {
  const casos = [
    ['Copa Do Brasil', 'Brazil', 'Copa do Brasil'],
    ['Copa do Nordeste', 'Brazil', 'Copa do Nordeste'],
    ['Baiano - 1', 'Brazil', 'Campeonato Baiano'],
    ['CONMEBOL Sudamericana', 'World', 'Copa Sul-Americana'],
  ];
  for (const [liga, pais, nome] of casos) {
    assert.equal(converterUm(jogoApi({ liga, pais })).jogo.competicao, nome);
  }
});

test('conversão: não confunde a Série A do Brasil com a de outro país', () => {
  const { jogo, avisos } = converterUm(jogoApi({ liga: 'Serie A', pais: 'Italy' }));
  assert.equal(jogo.competicao, 'Serie A');
  assert.match(avisos[0], /Competição sem tradução/);
});

test('conversão: fases em português', () => {
  const casos = {
    'Regular Season - 12': '12ª rodada',
    'Group Stage - 2': 'Fase de grupos, 2ª rodada',
    'Group B - 4': 'Grupo B, 4ª rodada',
    '3rd Round': '3ª fase',
    '1st Phase - 5': '1ª fase, 5ª rodada',
    '2nd Qualifying Round': '2ª fase preliminar',
    'Round of 16': 'Oitavas de final',
    'Quarter-finals': 'Quartas de final',
    'Semi-finals': 'Semifinal',
    Final: 'Final',
  };
  for (const [rodada, fase] of Object.entries(casos)) {
    const avisos = new Set();
    assert.equal(traduzirFase(rodada, avisos), fase);
    assert.equal(avisos.size, 0, rodada);
  }
});

test('conversão: acentua nome de time e sempre chama o Bahia de Bahia', () => {
  const item = jogoApi();
  item.teams.home = { id: ID_BAHIA, name: 'EC Bahia' };
  item.teams.away = { id: 135, name: 'Vitoria' };
  const { jogo } = converterUm(item);
  assert.equal(jogo.mandante, 'Bahia');
  assert.equal(jogo.visitante, 'Vitória');
});

test('junção: jogo remarcado corrige data e horário sem duplicar', () => {
  const [original] = converterJogos([jogoApi({ situacao: 'NS', casa: null, fora: null })], ID_BAHIA, CARIMBO).jogos;
  const [remarcado] = converterJogos(
    [jogoApi({ situacao: 'NS', casa: null, fora: null, data: '2026-04-19T18:30:00-03:00' })],
    ID_BAHIA,
    '2026-04-05T09:00:00-03:00',
  ).jogos;

  const { jogos, resumo } = juntarJogos([original], [remarcado]);

  assert.equal(jogos.length, 1);
  assert.equal(jogos[0].id, 'api-1001');
  assert.equal(jogos[0].data, '2026-04-19');
  assert.equal(jogos[0].hora, '18:30');
  assert.equal(jogos[0].atualizado_em, '2026-04-05T09:00:00-03:00');
  assert.equal(resumo.remarcados.length, 1);
  assert.equal(resumo.novos, 0);
});

test('junção: jogo igual mantém a data de atualização antiga', () => {
  const [antigo] = converterJogos([jogoApi()], ID_BAHIA, '2026-01-01T00:00:00-03:00').jogos;
  const [igual] = converterJogos([jogoApi()], ID_BAHIA, CARIMBO).jogos;
  const { jogos, resumo } = juntarJogos([antigo], [igual]);
  assert.equal(jogos[0].atualizado_em, '2026-01-01T00:00:00-03:00');
  assert.equal(resumo.semMudanca, 1);
  assert.equal(resumo.alterados, 0);
});

test('junção: placar novo atualiza o jogo sem contar como remarcado', () => {
  const [antes] = converterJogos([jogoApi({ situacao: '1H', casa: 0, fora: 0 })], ID_BAHIA, '2026-01-01T00:00:00-03:00').jogos;
  const [depois] = converterJogos([jogoApi({ situacao: 'FT', casa: 2, fora: 1 })], ID_BAHIA, CARIMBO).jogos;
  const { jogos, resumo } = juntarJogos([antes], [depois]);
  assert.equal(jogos[0].gols_mandante, 2);
  assert.equal(jogos[0].situacao, 'encerrado');
  assert.equal(resumo.alterados, 1);
  assert.equal(resumo.remarcados.length, 0);
});

test('junção: não mexe em jogo histórico nem em jogo que não veio na resposta', () => {
  const historico = jogoHistorico();
  const [sumiu] = converterJogos([jogoApi({ id: 2002, data: '2026-03-01T16:00:00-03:00' })], ID_BAHIA, CARIMBO).jogos;
  const [novo] = converterJogos([jogoApi({ id: 3003 })], ID_BAHIA, CARIMBO).jogos;

  const { jogos, resumo } = juntarJogos([historico, sumiu], [novo]);

  assert.deepEqual(jogos.map((jogo) => jogo.id), [historico.id, 'api-2002', 'api-3003']);
  assert.deepEqual(jogos[0], historico);
  assert.deepEqual(jogos[1], sumiu);
  assert.equal(resumo.novos, 1);
  assert.equal(resumo.ausentes, 1);
});

test('junção: deixa os jogos em ordem de data', () => {
  const novos = converterJogos(
    [jogoApi({ id: 2, data: '2026-05-01T16:00:00-03:00' }), jogoApi({ id: 1, data: '2026-02-01T16:00:00-03:00' })],
    ID_BAHIA,
    CARIMBO,
  ).jogos;
  assert.deepEqual(juntarJogos([], novos).jogos.map((jogo) => jogo.id_api), [1, 2]);
});

test('horário de registro usa o fuso de Salvador', () => {
  assert.equal(formatarInstante(new Date('2026-11-02T20:17:05Z')), '2026-11-02T17:17:05-03:00');
});

test('robô: primeira execução descobre o Bahia, guarda o id e grava os jogos', async (t) => {
  const pasta = criarPastaDados(t);
  const registro = capturarRegistro(t);
  const { chamadas } = simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [jogoApi()] } },
  });

  await executarEm(pasta);

  assert.deepEqual(lerDados(pasta, 'config.json'), { id_bahia: ID_BAHIA, nome_api: 'Bahia' });
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[0].endereco.pathname, '/teams');

  const jogos = chamadas[1].endereco;
  assert.equal(jogos.pathname, '/fixtures');
  assert.equal(jogos.searchParams.get('team'), '118');
  assert.equal(jogos.searchParams.get('season'), '2026');
  assert.match(jogos.search, /timezone=America\/Bahia/);
  assert.equal(chamadas[1].chave, CHAVE);

  assert.equal(lerDados(pasta, 'jogos', '2026.json').temporada, 2026);
  assert.equal(lerDados(pasta, 'jogos', '2026.json').jogos.length, 1);
  assert.deepEqual(lerDados(pasta, 'indice.json'), {
    ultima_atualizacao: formatarInstante(HORA_1),
    temporadas: [2026],
  });
  assert.match(registro(), /Consultas restantes hoje: 97 de 100\./);
});

test('robô: sem mudança, usa uma consulta só e não grava nada', async (t) => {
  const pasta = criarPastaDados(t);
  const registro = capturarRegistro(t);
  const { chamadas } = simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [jogoApi()] } },
  });

  await executarEm(pasta, HORA_1);
  const arquivos = ['indice.json', path.join('jogos', '2026.json')].map((nome) => path.join(pasta, nome));
  const antes = arquivos.map((arquivo) => [fs.readFileSync(arquivo, 'utf8'), fs.statSync(arquivo).mtimeMs]);
  chamadas.length = 0;

  const resultado = await executarEm(pasta, HORA_2);

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].endereco.pathname, '/fixtures');
  assert.equal(resultado.jogosMudaram, false);
  assert.equal(resultado.indiceMudou, false);
  assert.deepEqual(arquivos.map((arquivo) => [fs.readFileSync(arquivo, 'utf8'), fs.statSync(arquivo).mtimeMs]), antes);
  assert.match(registro(), /Nada mudou\. Nenhum arquivo foi gravado\./);
});

test('robô: jogo remarcado é corrigido no arquivo, sem duplicar', async (t) => {
  const pasta = criarPastaDados(t);
  const registro = capturarRegistro(t);
  const api = simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [jogoApi({ situacao: 'NS', casa: null, fora: null })] } },
  });
  await executarEm(pasta, HORA_1);

  api.trocar({
    '/fixtures': {
      corpo: {
        errors: [],
        response: [jogoApi({ situacao: 'NS', casa: null, fora: null, data: '2026-04-19T18:30:00-03:00' })],
      },
    },
  });
  await executarEm(pasta, HORA_3);

  const { jogos } = lerDados(pasta, 'jogos', '2026.json');
  assert.equal(jogos.length, 1);
  assert.equal(jogos[0].data, '2026-04-19');
  assert.equal(jogos[0].hora, '18:30');
  assert.equal(jogos[0].atualizado_em, formatarInstante(HORA_3));
  assert.equal(lerDados(pasta, 'indice.json').ultima_atualizacao, formatarInstante(HORA_3));
  assert.match(registro(), /Remarcado: Bahia x Palmeiras, de 12\/04\/2026 16:00 para 19\/04\/2026 18:30\./);
});

test('robô: preserva o jogo histórico que já está no arquivo', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [jogoApi()] } },
  });
  fs.writeFileSync(
    path.join(pasta, 'jogos', '2026.json'),
    JSON.stringify({ temporada: 2026, jogos: [jogoHistorico()] }),
  );

  await executarEm(pasta);

  const { jogos } = lerDados(pasta, 'jogos', '2026.json');
  assert.equal(jogos.length, 2);
  assert.deepEqual(jogos[0], jogoHistorico());
});

test('robô: temporada fora do plano dá mensagem clara e não grava jogos', async (t) => {
  const pasta = criarPastaDados(t);
  const registro = capturarRegistro(t);
  simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': {
      corpo: {
        errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' },
        results: 0,
        response: [],
      },
    },
  });

  await assert.rejects(executarEm(pasta), (erro) => {
    assert.ok(erro instanceof ErroRobo);
    assert.match(erro.message, /A temporada 2026 não está liberada no seu plano/);
    assert.match(erro.message, /try from 2022 to 2024/);
    return true;
  });

  assert.equal(fs.existsSync(path.join(pasta, 'jogos', '2026.json')), false);
  assert.deepEqual(lerDados(pasta, 'indice.json'), { ultima_atualizacao: null, temporadas: [] });
  // O id descoberto fica guardado, para não gastar essa consulta de novo.
  assert.equal(lerDados(pasta, 'config.json').id_bahia, ID_BAHIA);
  assert.match(registro(), /Consultas restantes hoje: 97 de 100\./);
});

test('robô: chave recusada usa a resposta real da API e não mostra a chave', async (t) => {
  const pasta = criarPastaDados(t);
  const registro = capturarRegistro(t);
  simularApi(t, {
    '/teams': {
      status: 403,
      cabecalhos: {},
      corpo:
        '{"get": "","parameters": [],"errors": {"token": "Missing application key, Check our documentation on how to add your API key in headers.","error": "4xHe"},"results": 0,"paging": {"current": 1,"total": 1},"response": []}',
    },
  });

  await assert.rejects(executarEm(pasta), (erro) => {
    assert.match(erro.message, /A chave foi recusada/);
    assert.doesNotMatch(erro.message, /4xHe/);
    assert.ok(!erro.message.includes(CHAVE));
    return true;
  });

  assert.match(registro(), /Consultas restantes hoje: a API não informou\./);
  assert.ok(!registro().includes(CHAVE));
  assert.equal(fs.existsSync(path.join(pasta, 'config.json')), false);
});

test('robô: limite do dia dá mensagem clara', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  simularApi(t, {
    '/teams': {
      corpo: { errors: { requests: 'You have reached the request limit for the day.' }, response: [] },
    },
  });
  await assert.rejects(executarEm(pasta), /O limite de consultas do dia acabou/);
});

test('robô: resposta que não é JSON não derruba com erro confuso', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  simularApi(t, { '/teams': { status: 502, corpo: '<html>Bad Gateway</html>' } });
  await assert.rejects(executarEm(pasta), /respondeu de um jeito inesperado \(código 502\)/);
});

test('robô: falha de rede dá mensagem clara', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  });
  await assert.rejects(executarEm(pasta), /Não foi possível falar com a API \(ENOTFOUND\)/);
});

test('robô: sem chave, ou com chave inválida, nem chega a consultar a API', async (t) => {
  const pasta = criarPastaDados(t);
  const { chamadas } = simularApi(t, {});
  await assert.rejects(executar({ pastaDados: pasta, chave: '' }), /API_FOOTBALL_KEY não foi definida/);
  await assert.rejects(executar({ pastaDados: pasta, chave: 'abc\ndef' }), (erro) => {
    assert.match(erro.message, /caracteres inválidos/);
    assert.doesNotMatch(erro.message, /abc/);
    return true;
  });
  assert.equal(chamadas.length, 0);
});

test('robô: não acha um único Bahia e para sem guardar nada', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  simularApi(t, {
    '/teams': { corpo: { errors: [], response: [{ team: { id: 9999, name: 'Bahia De Feira', country: 'Brazil' } }] } },
  });
  await assert.rejects(executarEm(pasta), /Esperava achar um único Bahia na API e achei 0/);
  assert.equal(fs.existsSync(path.join(pasta, 'config.json')), false);
});

test('robô: arquivo de jogos corrompido não é sobrescrito', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [jogoApi()] } },
  });
  const arquivo = path.join(pasta, 'jogos', '2026.json');
  fs.writeFileSync(arquivo, '{ isto não é json');

  await assert.rejects(executarEm(pasta), /2026\.json não é um JSON válido/);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), '{ isto não é json');
});

test('robô: temporada sem jogos não cria arquivo vazio', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [] } },
  });
  await executarEm(pasta);
  assert.equal(fs.existsSync(path.join(pasta, 'jogos', '2026.json')), false);
  assert.deepEqual(lerDados(pasta, 'indice.json'), { ultima_atualizacao: null, temporadas: [] });
});

test('robô: TEMPORADA escolhe outro ano e recusa valor inválido', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  const { chamadas } = simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [jogoApi()] } },
  });
  t.after(() => delete process.env.TEMPORADA);

  process.env.TEMPORADA = '2024';
  await executarEm(pasta);
  assert.equal(chamadas[1].endereco.searchParams.get('season'), '2024');
  assert.equal(lerDados(pasta, 'jogos', '2024.json').temporada, 2024);

  process.env.TEMPORADA = 'abc';
  await assert.rejects(executarEm(pasta), /A temporada "abc" não é válida/);
});

test('junção: jogo do histórico no mesmo dia é trocado pela versão da API, sem duplicar', () => {
  const historico = { ...jogoHistorico(), data: '2026-04-12', visitante: 'Palmeiras-SP' };
  const [daApi] = converterJogos([jogoApi()], ID_BAHIA, CARIMBO).jogos;

  const { jogos, resumo } = juntarJogos([historico], [daApi]);

  assert.equal(jogos.length, 1);
  assert.equal(jogos[0].fonte, 'api-football');
  assert.equal(jogos[0].id_api, 1001);
  assert.equal(resumo.substituidos, 1);
  assert.equal(resumo.novos, 0);
});

test('mesmo jogo: com dois jogos no dia, o adversário decide, sem a sigla do estado', () => {
  const comum = { ...jogoHistorico(), data: '2024-01-17' };
  const amistoso = { ...comum, id: 'a', visitante: 'Blackburn Rovers-ENG' };
  const baiano = { ...comum, id: 'b', visitante: 'Jequié-BA' };

  assert.equal(acharMesmoJogo([amistoso, baiano], { data: '2024-01-17', mandante: 'Bahia', visitante: 'Jequié' }).id, 'b');
  assert.equal(acharMesmoJogo([amistoso, baiano], { data: '2024-01-17', mandante: 'Jequié', visitante: 'Bahia' }).id, 'b');
  assert.equal(acharMesmoJogo([amistoso, baiano], { data: '2024-01-17', mandante: 'Bahia', visitante: 'Outro' }), undefined);
  assert.equal(acharMesmoJogo([amistoso], { data: '2024-01-17', mandante: 'Bahia', visitante: 'Outro' }).id, 'a');
  assert.equal(acharMesmoJogo([amistoso], { data: '2024-01-18', mandante: 'Bahia', visitante: 'Outro' }), undefined);
});

function jogoMarcado(mudancas = {}) {
  return { data: '2026-11-08', hora: '16:00', situacao: 'agendado', ...mudancas };
}

function emSalvador(horario) {
  return new Date(`2026-11-08T${horario}:00-03:00`);
}

test('jogo por perto: de 30 minutos antes até 3 horas depois do horário marcado', () => {
  const casos = {
    '15:29': false,
    '15:30': true,
    '16:00': true,
    '19:00': true,
    '19:01': false,
  };
  for (const [horario, esperado] of Object.entries(casos)) {
    assert.equal(temJogoPorPerto([jogoMarcado()], emSalvador(horario)), esperado, horario);
  }
});

test('jogo por perto: ao vivo vale por até 5 horas, para jogo que atrasou', () => {
  const aoVivo = jogoMarcado({ situacao: 'ao_vivo' });
  assert.equal(temJogoPorPerto([aoVivo], emSalvador('20:30')), true);
  assert.equal(temJogoPorPerto([aoVivo], emSalvador('21:01')), false);
});

test('jogo por perto: encerrado, adiado, cancelado ou sem horário não contam', () => {
  const agora = emSalvador('16:30');
  for (const situacao of ['encerrado', 'adiado', 'cancelado']) {
    assert.equal(temJogoPorPerto([jogoMarcado({ situacao })], agora), false, situacao);
  }
  assert.equal(temJogoPorPerto([jogoMarcado({ hora: null })], agora), false);
  assert.equal(temJogoPorPerto([], agora), false);
});

// Passa pelo dia inteiro nos horários do workflow: minuto 17 sempre, 2, 32 e 47 só com jogo por perto.
function consultasNoDia(situacaoNoHorario) {
  let total = 0;
  for (let hora = 0; hora < 24; hora += 1) {
    for (const minuto of [2, 17, 32, 47]) {
      const horario = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
      const jogos = situacaoNoHorario(horario);
      if (minuto === 17 || temJogoPorPerto(jogos, emSalvador(horario))) total += 1;
    }
  }
  return total;
}

test('consumo: 24 consultas em dia sem jogo', () => {
  assert.equal(consultasNoDia(() => []), 24);
});

test('consumo: 35 no máximo em dia de jogo normal', () => {
  assert.equal(consultasNoDia(() => [jogoMarcado()]), 35);
});

test('consumo: 33 quando o jogo acaba em cerca de 2 horas', () => {
  // A execução das 18:02 consulta e vê o jogo encerrado. Depois disso, não há mais consultas extras.
  const situacao = (horario) => [jogoMarcado({ situacao: horario > '18:02' ? 'encerrado' : horario >= '16:00' ? 'ao_vivo' : 'agendado' })];
  assert.equal(consultasNoDia(situacao), 33);
});

test('consumo: 41 se o jogo ficar preso como ao vivo', () => {
  assert.equal(consultasNoDia((horario) => [jogoMarcado({ situacao: horario >= '16:00' ? 'ao_vivo' : 'agendado' })]), 41);
});

test('consumo: mesmo com jogo por perto o dia inteiro, o máximo é 96', () => {
  assert.equal(consultasNoDia((horario) => [jogoMarcado({ hora: horario })]), 96);
});

test('robô: horário extra sem jogo por perto não gasta consulta nem grava nada', async (t) => {
  const pasta = criarPastaDados(t);
  const registro = capturarRegistro(t);
  const { chamadas } = simularApi(t, {});
  t.after(() => delete process.env.SO_PERTO_DO_JOGO);
  fs.writeFileSync(
    path.join(pasta, 'jogos', '2026.json'),
    JSON.stringify({ temporada: 2026, jogos: [jogoMarcado({ id: 'x', id_api: 1 })] }),
  );

  process.env.SO_PERTO_DO_JOGO = 'true';
  const resultado = await executar({ pastaDados: pasta, chave: CHAVE, instante: emSalvador('10:02') });

  assert.equal(chamadas.length, 0);
  assert.equal(resultado.jogosMudaram, false);
  assert.match(registro(), /Sem jogo do Bahia por perto\. Nenhuma consulta foi feita\./);
});

test('robô: horário extra com jogo por perto consulta a API', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  const { chamadas } = simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [jogoApi()] } },
  });
  t.after(() => delete process.env.SO_PERTO_DO_JOGO);
  fs.writeFileSync(
    path.join(pasta, 'jogos', '2026.json'),
    JSON.stringify({ temporada: 2026, jogos: [jogoMarcado({ id: 'x', id_api: 1 })] }),
  );

  process.env.SO_PERTO_DO_JOGO = 'true';
  await executar({ pastaDados: pasta, chave: CHAVE, instante: emSalvador('16:02') });

  assert.ok(chamadas.some(({ endereco }) => endereco.pathname === '/fixtures'));
});

test('robô: sem o aviso de horário extra, consulta mesmo sem jogo por perto', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  const { chamadas } = simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [jogoApi()] } },
  });
  t.after(() => delete process.env.SO_PERTO_DO_JOGO);

  process.env.SO_PERTO_DO_JOGO = 'false';
  await executar({ pastaDados: pasta, chave: CHAVE, instante: emSalvador('10:17') });

  assert.ok(chamadas.some(({ endereco }) => endereco.pathname === '/fixtures'));
});

test('robô: execução agendada sem chave avisa e termina sem erro; manual continua dando erro', async (t) => {
  const pasta = criarPastaDados(t);
  const registro = capturarRegistro(t);
  const { chamadas } = simularApi(t, {});
  t.after(() => delete process.env.GITHUB_EVENT_NAME);

  process.env.GITHUB_EVENT_NAME = 'schedule';
  await executar({ pastaDados: pasta, chave: '' });
  assert.match(registro(), /a chave ainda não está nos Secrets/);
  assert.equal(chamadas.length, 0);

  process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
  await assert.rejects(executar({ pastaDados: pasta, chave: '' }), /API_FOOTBALL_KEY não foi definida/);
});

test('robô: arquivo sem lista de jogos para antes de gastar consulta', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  const { chamadas } = simularApi(t, {});
  fs.writeFileSync(path.join(pasta, 'jogos', '2026.json'), '{"temporada":2026}');

  await assert.rejects(executarEm(pasta), /não tem a lista de jogos/);
  assert.equal(chamadas.length, 0);
});

test('robô: TEMPORADA vazia usa o ano atual, como no agendamento do workflow', async (t) => {
  const pasta = criarPastaDados(t);
  capturarRegistro(t);
  const { chamadas } = simularApi(t, {
    '/teams': { corpo: respostaTimes() },
    '/fixtures': { corpo: { errors: [], response: [jogoApi()] } },
  });
  t.after(() => delete process.env.TEMPORADA);

  process.env.TEMPORADA = '';
  await executarEm(pasta);
  assert.equal(chamadas[1].endereco.searchParams.get('season'), '2026');
});
