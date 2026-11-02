'use strict';

// Testes de como as fontes são juntadas, sem acessar a internet. Uso: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  aplicarComplementos,
  executar,
  lerFichas,
  lerHoraDaWikipedia,
  lerJogosDaWikipedia,
} = require('./complementar-jogos.js');

const CARIMBO = '2026-11-02T18:00:00-03:00';

function jogo(mudancas = {}) {
  return {
    id: 'f80-1988-02-19-internacional-rs',
    data: '1988-02-19',
    hora: null,
    competicao: 'Campeonato Baiano',
    fase: null,
    mandante: 'Bahia',
    visitante: 'Internacional-RS',
    gols_mandante: 2,
    gols_visitante: 1,
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

function complemento(mudancas = {}) {
  return { data: '1988-02-19', adversario: 'Internacional', pro: 2, contra: 1, hora: '16:00', fase: 'Final', estadio: 'Fonte Nova', cidade: 'Salvador', ...mudancas };
}

function ficha(titulo, data, competicao, local) {
  const linha = (...celulas) => `<tr>${celulas.map((c) => `<td class=x>${c}</td>`).join('')}</tr>`;
  return [
    linha(...titulo),
    linha(data),
    linha(competicao),
    linha(`Local: ${local}`, 'Árbitro: Fulano (BA)'),
    linha('Renda: Cr$ 1,00', 'Público: 10'),
  ].join('\n');
}

test('fichas: lê data, placar, fase, estádio e cidade', () => {
  const [lida] = lerFichas(ficha(['Bahia 9 x 0 Leônico', '2.200'], '08/Fevereiro/1976', 'Campeonato Baiano - 1ª Fase - 1º Turno - 1ª Etapa', 'Fonte Nova (Salvador)'));
  assert.deepEqual(lida, { data: '1976-02-08', adversario: 'Leônico', pro: 9, contra: 0, hora: null, fase: '1ª Fase, 1º Turno, 1ª Etapa', estadio: 'Fonte Nova', cidade: 'Salvador' });
});

test('fichas: Bahia como visitante fica com o placar do lado certo', () => {
  const [lida] = lerFichas(ficha(['Vitória 0 x 3 Bahia', '5.061'], '18/Fevereiro/2018', 'Campeonato Baiano', 'Barradão (Salvador)'));
  assert.equal(lida.adversario, 'Vitória');
  assert.equal(lida.pro, 3);
  assert.equal(lida.contra, 0);
  assert.equal(lida.fase, null);
});

test('fichas: título depois de outra célula, mês com acento e nome da competição com erro', () => {
  const [lida] = lerFichas(ficha(['Jogo 31', 'Bahia 0 x 1 Leônico', '2.804'], '17/Março/1984', 'Campeoanto Baiano - 1º Turno', 'Fonte Nova (Salvador)'));
  assert.equal(lida.data, '1984-03-17');
  assert.equal(lida.adversario, 'Leônico');
  assert.equal(lida.fase, '1º Turno');
});

test('fichas: mês escrito errado, linha de prorrogação e cidade com o estado', () => {
  const [digitado] = lerFichas(ficha(['Bahia 2 x 1 Dom Bosco', '2.466'], '03/Outubo/1979', 'Campeonato Brasileiro - Copa Brasil - 1ª Fase', 'Fonte Nova (Salvador)'));
  assert.equal(digitado.data, '1979-10-03');

  const html = [
    '<tr><td>Guarani 0 x 0 Bahia</td><td>2.700</td></tr>',
    '<tr><td>(Na prorrogação: Guarani 1 x 0 Bahia)</td></tr>',
    '<tr><td>08/Junho/1982</td></tr>',
    '<tr><td>Torneio dos Campeões - Semifinais</td></tr>',
    '<tr><td>Local: Brinco de Ouro (Campinas-SP)</td></tr>',
  ].join('\n');
  const [lida] = lerFichas(html);
  assert.equal(lida.data, '1982-06-08');
  assert.equal(lida.estadio, 'Brinco de Ouro');
  assert.equal(lida.cidade, 'Campinas');
  assert.equal(lida.fase, 'Semifinais');
  // O placar que vale é o do tempo normal somado ao da prorrogação.
  assert.equal(lida.pro, 0);
  assert.equal(lida.contra, 1);
});

test('fichas: local sem cidade não inventa a cidade', () => {
  const [lida] = lerFichas(ficha(['Bahia 1 x 0 Botafogo', '1'], '27/Outubro/1968', 'Amistoso', 'Fonte Nova'));
  assert.equal(lida.estadio, 'Fonte Nova');
  assert.equal(lida.cidade, null);
});

test('fichas: jogo sem o Bahia ou com data inválida fica de fora', () => {
  assert.deepEqual(lerFichas(ficha(['Vitória 1 x 0 Ypiranga', '1'], '27/Outubro/1968', 'Amistoso', 'Barradão (Salvador)')), []);
  assert.deepEqual(lerFichas(ficha(['Bahia 1 x 0 Botafogo', '1'], 'data ruim', 'Amistoso', 'Fonte Nova (Salvador)')), []);
});

test('horário da Wikipédia: leva para Salvador, e sem fuso não aceita', () => {
  assert.equal(lerHoraDaWikipedia('16:00 ([[UTC-3]])'), '16:00');
  assert.equal(lerHoraDaWikipedia('{{UTZ|19:00|-3}}'), '19:00');
  assert.equal(lerHoraDaWikipedia('{{UTZ|20:00|-4}}'), '21:00');
  assert.equal(lerHoraDaWikipedia('{{UTZ|23:30|-4}}'), '00:30');
  assert.equal(lerHoraDaWikipedia('20:00'), null);
  assert.equal(lerHoraDaWikipedia('{{UTZ|--:--|-3}}'), null);
});

test('Wikipédia: lê a caixa de jogo, sem pegar nome de patrocínio', () => {
  const texto = `{{football box collapsible
|round= 3
|date= {{Start date|2025|2|5|df=y}}
|time= 19:00 ([[UTC-3]])
|team1= Bahia
|score= 1–1
|team2= [[Fluminense FC|Fluminense]]
|stadium= [[Arena Fonte Nova|Casa de Apostas (Arena Fonte Nova)]]
|location= [[Salvador, Bahia|Salvador]], Brazil
}}
{{football box collapsible
|round= 4
|date= 9 February
|time=
|team1= [[Remo]]
|score= 2-0
|team2= [[EC Bahia|Bahia]]
|stadium= Mangueirão
|location= Belém
}}
{{football box collapsible
|round= 5
|date= 1 March 2025
|team1= Bahia
|score= –
|team2= Santos
}}`;
  const jogos = lerJogosDaWikipedia(texto, 2025);
  assert.equal(jogos.length, 2);
  assert.deepEqual(jogos[0], { data: '2025-02-05', adversario: 'Fluminense', pro: 1, contra: 1, hora: '19:00', fase: '3ª rodada', estadio: 'Arena Fonte Nova', cidade: 'Salvador' });
  assert.equal(jogos[1].data, '2025-02-09');
  assert.equal(jogos[1].adversario, 'Remo');
  assert.equal(jogos[1].pro, 0);
  assert.equal(jogos[1].contra, 2);
});

test('Wikipédia: time com Bahia no nome não é o Bahia', () => {
  const texto = `{{football box collapsible
|date= 14 January 2026
|team1= Bahia de Feira
|score= 0–3
|team2= Bahia
|stadium= Arena Cajueiro
|location= Feira de Santana
}}`;
  const [lido] = lerJogosDaWikipedia(texto, 2026);
  assert.equal(lido.adversario, 'Bahia de Feira');
  assert.equal(lido.pro, 3);
});

test('junção: preenche os campos vazios e registra quando mudou', () => {
  const lista = [jogo()];
  const resumo = aplicarComplementos(lista, [complemento()], CARIMBO);
  assert.equal(resumo.jogos, 1);
  assert.equal(resumo.campos, 4);
  assert.equal(lista[0].estadio, 'Fonte Nova');
  assert.equal(lista[0].cidade, 'Salvador');
  assert.equal(lista[0].hora, '16:00');
  assert.equal(lista[0].fase, 'Final');
  assert.equal(lista[0].atualizado_em, CARIMBO);
});

test('junção: nunca muda placar, data, times ou competição', () => {
  const lista = [jogo()];
  const antes = structuredClone(lista[0]);
  aplicarComplementos(lista, [complemento()], CARIMBO);
  for (const campo of ['id', 'data', 'competicao', 'mandante', 'visitante', 'gols_mandante', 'gols_visitante', 'penaltis', 'situacao', 'fonte', 'id_api']) {
    assert.deepEqual(lista[0][campo], antes[campo], campo);
  }
});

test('junção: o que já está preenchido não é sobrescrito', () => {
  const lista = [jogo({ estadio: 'Pituaçu', fase: '1ª rodada' })];
  aplicarComplementos(lista, [complemento()], CARIMBO);
  assert.equal(lista[0].estadio, 'Pituaçu');
  assert.equal(lista[0].fase, '1ª rodada');
  assert.equal(lista[0].cidade, 'Salvador');
});

test('junção: a primeira fonte tem prioridade sobre a segunda', () => {
  const lista = [jogo()];
  aplicarComplementos(lista, [complemento({ estadio: 'Fonte Nova', hora: null })], CARIMBO);
  aplicarComplementos(lista, [complemento({ estadio: 'Arena Fonte Nova', hora: '21:30' })], CARIMBO);
  assert.equal(lista[0].estadio, 'Fonte Nova');
  assert.equal(lista[0].hora, '21:30');
});

test('junção: jogo completo não muda a data de atualização', () => {
  const lista = [jogo({ hora: '16:00', fase: 'Final', estadio: 'x', cidade: 'y' })];
  const resumo = aplicarComplementos(lista, [complemento()], CARIMBO);
  assert.equal(resumo.jaCompletos, 1);
  assert.equal(lista[0].atualizado_em, '2026-01-01T00:00:00-03:00');
});

test('junção: placar diferente não altera nada e vai para a lista de conferência', () => {
  const lista = [jogo()];
  const antes = structuredClone(lista[0]);
  const resumo = aplicarComplementos(lista, [complemento({ pro: 4, contra: 1 })], CARIMBO);
  assert.deepEqual(lista[0], antes);
  assert.equal(resumo.placarDiferente.length, 1);
  assert.equal(resumo.jogos, 0);
});

test('junção: W.O. sem placar não recebe dados de um placar qualquer', () => {
  const lista = [jogo({ gols_mandante: null, gols_visitante: null })];
  const resumo = aplicarComplementos(lista, [complemento()], CARIMBO);
  assert.equal(resumo.placarDiferente.length, 1);
  assert.equal(lista[0].estadio, null);
});

test('junção: dois jogos no mesmo dia são separados pelo adversário', () => {
  const lista = [
    jogo({ id: 'a', visitante: 'Ypiranga-BA', gols_mandante: 2, gols_visitante: 1 }),
    jogo({ id: 'b', visitante: 'Royal-BA', gols_mandante: 2, gols_visitante: 1 }),
  ];
  aplicarComplementos(lista, [complemento({ adversario: 'Royal' })], CARIMBO);
  assert.equal(lista[0].estadio, null);
  assert.equal(lista[1].estadio, 'Fonte Nova');
});

test('junção: dois jogos no dia sem adversário igual ficam sem par', () => {
  const lista = [jogo({ id: 'a', visitante: 'Ypiranga-BA' }), jogo({ id: 'b', visitante: 'Royal-BA' })];
  const resumo = aplicarComplementos(lista, [complemento({ adversario: 'Galícia' })], CARIMBO);
  assert.equal(resumo.semPar.length, 1);
  assert.ok(lista.every((j) => j.estadio === null));
});

test('junção: mesmo jogo com data próxima aproveita o local e mantém a data dos dados', () => {
  const lista = [jogo({ data: '2025-11-28', mandante: 'Juventude-RS', visitante: 'Bahia', gols_mandante: 1, gols_visitante: 1 })];
  const resumo = aplicarComplementos(lista, [complemento({ data: '2025-11-30', adversario: 'Juventude', pro: 1, contra: 1, estadio: 'Alfredo Jaconi', cidade: 'Caxias do Sul' })], CARIMBO);
  assert.equal(lista[0].data, '2025-11-28');
  assert.equal(lista[0].estadio, 'Alfredo Jaconi');
  assert.equal(resumo.dataDiferente.length, 1);
  assert.equal(resumo.semPar.length, 0);
});

test('junção: data próxima não vale com placar diferente, adversário diferente ou mais de 3 dias', () => {
  const base = () => [jogo({ data: '2025-11-28', mandante: 'Juventude-RS', visitante: 'Bahia', gols_mandante: 1, gols_visitante: 1 })];
  const casos = [
    { data: '2025-11-30', adversario: 'Juventude', pro: 2, contra: 1 },
    { data: '2025-11-30', adversario: 'Santos', pro: 1, contra: 1 },
    { data: '2025-12-02', adversario: 'Juventude', pro: 1, contra: 1 },
  ];
  for (const caso of casos) {
    const lista = base();
    const resumo = aplicarComplementos(lista, [complemento(caso)], CARIMBO);
    assert.equal(resumo.semPar.length, 1, JSON.stringify(caso));
    assert.equal(lista[0].estadio, null);
  }
});

function criarPastaDados(t, temporadas) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'bahia-complemento-'));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  fs.mkdirSync(path.join(pasta, 'jogos'));
  fs.writeFileSync(path.join(pasta, 'indice.json'), '{"ultima_atualizacao":null,"temporadas":[]}\n');
  for (const [ano, jogos] of Object.entries(temporadas)) {
    fs.writeFileSync(path.join(pasta, 'jogos', `${ano}.json`), JSON.stringify({ temporada: Number(ano), jogos }));
  }
  return pasta;
}

const ler = (pasta, nome) => JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8'));

test('execução: grava só as temporadas que mudaram, e a final de 1989 no arquivo de 1988', async (t) => {
  t.mock.method(console, 'log', () => {});
  const pasta = criarPastaDados(t, { 1988: [jogo({ data: '1989-02-19' })], 1990: [jogo({ data: '1990-01-01' })] });
  const antes1990 = fs.readFileSync(path.join(pasta, 'jogos', '1990.json'), 'utf8');

  const { gravados } = await executar({ pastaDados: pasta, fontes: [['Teste', [complemento({ data: '1989-02-19' })]]], instante: new Date('2026-11-02T21:00:00Z') });

  assert.equal(gravados, 1);
  assert.equal(ler(pasta, 'jogos/1988.json').jogos[0].estadio, 'Fonte Nova');
  assert.equal(fs.readFileSync(path.join(pasta, 'jogos', '1990.json'), 'utf8'), antes1990);
  assert.equal(ler(pasta, 'indice.json').ultima_atualizacao, '2026-11-02T18:00:00-03:00');
});

test('execução: em simulação não grava nada', async (t) => {
  t.mock.method(console, 'log', () => {});
  const pasta = criarPastaDados(t, { 1988: [jogo()] });
  const antes = fs.readFileSync(path.join(pasta, 'jogos', '1988.json'), 'utf8');
  const { gravados } = await executar({ pastaDados: pasta, simular: true, fontes: [['Teste', [complemento()]]] });
  assert.equal(gravados, 0);
  assert.equal(fs.readFileSync(path.join(pasta, 'jogos', '1988.json'), 'utf8'), antes);
});

test('execução: rodar de novo não grava nada', async (t) => {
  t.mock.method(console, 'log', () => {});
  const pasta = criarPastaDados(t, { 1988: [jogo()] });
  const fontes = [['Teste', [complemento()]]];
  await executar({ pastaDados: pasta, fontes });
  const { gravados } = await executar({ pastaDados: pasta, fontes });
  assert.equal(gravados, 0);
});
