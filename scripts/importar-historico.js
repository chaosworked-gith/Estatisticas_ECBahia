'use strict';

// Importa o histórico de jogos do Bahia publicado pelo Futebol 80, com autorização do
// responsável pelo site. Feito para rodar uma única vez: node scripts/importar-historico.js
// Se rodar de novo, não duplica nada. Jogos que vieram da API nunca são tocados.

const path = require('node:path');

const {
  ErroRobo,
  PASTA_DADOS,
  acharMesmoJogo,
  atualizarIndice,
  formatarInstante,
  gravarSeMudou,
  jogoMudou,
  lerJson,
  normalizar,
} = require('./atualizar.js');

const URL_PAGINA = 'https://www.futebol80.com.br/links/times/bahia/bahiajg.htm';
const FONTE = 'futebol80';
const TEMPO_LIMITE_MS = 60000;
const CAMPOS_COMPLEMENTADOS = ['hora', 'fase', 'estadio', 'cidade'];

const MESES = {
  jan: '01',
  fev: '02',
  mar: '03',
  abr: '04',
  mai: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  set: '09',
  out: '10',
  nov: '11',
  dez: '12',
};

// Mesmos nomes que o robô grava. O restante da lista fica como o Futebol 80 escreve.
const COMPETICOES = {
  Baiano: 'Campeonato Baiano',
  Brasileiro: 'Campeonato Brasileiro Série A',
  'Brasileiro-Série B': 'Campeonato Brasileiro Série B',
  'Brasileiro-Série C': 'Campeonato Brasileiro Série C',
  'Sul-Americana': 'Copa Sul-Americana',
  Libertadores: 'Copa Libertadores',
  'Torneio Início-Baiano': 'Torneio Início do Baiano',
};

// A tabela não traz a temporada. Estes jogos são de campeonatos nacionais que terminaram
// no ano seguinte e ficam no arquivo da edição a que pertencem.
const TEMPORADAS_ESPECIAIS = [
  { competicao: 'Brasileiro-Taça Brasil', de: '1960-01-01', ate: '1960-06-30', temporada: 1959 },
  { competicao: 'Brasileiro-Taça Brasil', de: '1964-01-01', ate: '1964-06-30', temporada: 1963 },
  { competicao: 'Brasileiro-Taça Brasil', de: '1969-01-01', ate: '1969-06-30', temporada: 1968 },
  { competicao: 'Brasileiro-Nacional', de: '1974-01-01', ate: '1974-02-28', temporada: 1973 },
  { competicao: 'Brasileiro-Copa Brasil', de: '1978-01-01', ate: '1978-03-05', temporada: 1977 },
  { competicao: 'Brasileiro-Copa Brasil', de: '1987-01-01', ate: '1987-02-28', temporada: 1986 },
  { competicao: 'Brasileiro-Copa União', de: '1989-01-01', ate: '1989-02-28', temporada: 1988 },
  { competicao: 'Brasileiro', de: '2021-01-01', ate: '2021-02-28', temporada: 2020 },
];

function limparCelula(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function lerLinhas(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((linha) =>
    [...linha[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((celula) => limparCelula(celula[1])),
  );
}

function lerNumero(texto) {
  return Number(texto.replace(/\./g, ''));
}

function lerData(texto, numero) {
  const partes = /^(\d{2})\/([a-z]{3})\/(\d{4})$/.exec(texto);
  const mes = partes && MESES[partes[2]];
  if (!mes) throw new ErroRobo(`Jogo nº ${numero}: data "${texto}" fora do padrão. Nada foi gravado.`);
  return `${partes[3]}-${mes}-${partes[1]}`;
}

// Linha de jogo: Nº, Data, Competição, L, Equipe, gols, x, gols, Adversário, Autores, resultado, vazia.
function lerJogos(linhas) {
  return linhas
    .filter((celulas) => celulas.length === 12 && /^[\d.]+$/.test(celulas[0]))
    .map((celulas) => {
      const [numero, data, competicao, local, , pro, , contra, adversario, , resultado] = celulas;
      if (!competicao || !adversario || !['C', 'F', 'N'].includes(local) || !['v', 'e', 'd'].includes(resultado)) {
        throw new ErroRobo(`Jogo nº ${numero}: linha fora do padrão. Nada foi gravado.`);
      }

      const temPlacar = /^\d+$/.test(pro) && /^\d+$/.test(contra);
      if (!temPlacar && `${pro} ${contra}`.trim() !== 'WO') {
        throw new ErroRobo(`Jogo nº ${numero}: placar "${pro} x ${contra}" fora do padrão. Nada foi gravado.`);
      }

      return {
        numero: lerNumero(numero),
        data: lerData(data, numero),
        competicao,
        local,
        golsPro: temPlacar ? Number(pro) : null,
        golsContra: temPlacar ? Number(contra) : null,
        adversario,
        resultado,
      };
    });
}

function valorDoRotulo(linhas, rotulo) {
  for (const celulas of linhas) {
    const posicao = celulas.indexOf(rotulo);
    if (posicao > 0 && /^[\d.]+$/.test(celulas[posicao - 1])) return lerNumero(celulas[posicao - 1]);
  }
  return null;
}

function golsDaPagina(linhas) {
  for (const celulas of linhas) {
    const posicao = celulas.indexOf('x');
    if (celulas.length < 12 && posicao > 0 && /^[\d.]+$/.test(celulas[posicao - 1]) && /^[\d.]+$/.test(celulas[posicao + 1])) {
      return { pro: lerNumero(celulas[posicao - 1]), contra: lerNumero(celulas[posicao + 1]) };
    }
  }
  return { pro: null, contra: null };
}

// Compara a leitura com os totais que a própria página publica. Qualquer diferença cancela tudo.
function conferirTotais(linhas, jogos) {
  const contar = (resultado) => jogos.filter((jogo) => jogo.resultado === resultado).length;
  const somar = (campo) => jogos.reduce((soma, jogo) => soma + (jogo[campo] ?? 0), 0);
  const gols = golsDaPagina(linhas);

  const comparacoes = [
    ['jogos', valorDoRotulo(linhas, 'Jogos'), jogos.length],
    ['vitórias', valorDoRotulo(linhas, 'Vitórias'), contar('v')],
    ['empates', valorDoRotulo(linhas, 'Empates'), contar('e')],
    ['derrotas', valorDoRotulo(linhas, 'Derrotas'), contar('d')],
    ['gols pró', gols.pro, somar('golsPro')],
    ['gols contra', gols.contra, somar('golsContra')],
  ];
  for (const [nome, naPagina, lido] of comparacoes) {
    if (naPagina !== lido) {
      throw new ErroRobo(`A leitura não bate com a página em ${nome}: a página diz ${naPagina} e foram lidos ${lido}. Nada foi gravado.`);
    }
  }

  for (const jogo of jogos) {
    if (jogo.golsPro === null) continue;
    const esperado = jogo.golsPro > jogo.golsContra ? 'v' : jogo.golsPro < jogo.golsContra ? 'd' : 'e';
    if (esperado !== jogo.resultado) {
      throw new ErroRobo(`Jogo nº ${jogo.numero}: o placar não combina com o resultado "${jogo.resultado}". Nada foi gravado.`);
    }
  }
}

function nomeDaCompeticao(nome) {
  if (COMPETICOES[nome]) return COMPETICOES[nome];
  if (nome.startsWith('Brasileiro-')) {
    return `Campeonato Brasileiro (${nome.slice('Brasileiro-'.length).replace(/-/g, ', ')})`;
  }
  return nome;
}

function temporadaDoJogo({ competicao, data }) {
  const especial = TEMPORADAS_ESPECIAIS.find(
    (caso) => caso.competicao === competicao && data >= caso.de && data <= caso.ate,
  );
  return especial ? especial.temporada : Number(data.slice(0, 4));
}

function pedacoDoId(texto) {
  return normalizar(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// A página traz sempre o Bahia primeiro. A coluna L diz o local: C (casa), F (fora) ou N (neutro).
// Em campo neutro, o Bahia fica como mandante, na mesma ordem da página.
function converterJogo(jogo, atualizadoEm) {
  const fora = jogo.local === 'F';
  return {
    id: `f80-${jogo.data}-${pedacoDoId(jogo.adversario)}`,
    data: jogo.data,
    hora: null,
    competicao: nomeDaCompeticao(jogo.competicao),
    fase: null,
    mandante: fora ? jogo.adversario : 'Bahia',
    visitante: fora ? 'Bahia' : jogo.adversario,
    gols_mandante: fora ? jogo.golsContra : jogo.golsPro,
    gols_visitante: fora ? jogo.golsPro : jogo.golsContra,
    penaltis: null,
    estadio: null,
    cidade: null,
    situacao: 'encerrado',
    fonte: FONTE,
    id_api: null,
    atualizado_em: atualizadoEm,
  };
}

function ordenarPorData(a, b) {
  return `${a.data} ${a.hora ?? ''}`.localeCompare(`${b.data} ${b.hora ?? ''}`);
}

function juntarHistorico(existentes, importados) {
  const daApi = existentes.filter((jogo) => jogo.id_api != null);
  const porId = new Map(existentes.map((jogo) => [jogo.id, jogo]));
  const jogos = [...existentes];
  const resumo = { novos: 0, alterados: 0, iguais: 0, ignorados: 0 };

  for (const jogo of importados) {
    if (acharMesmoJogo(daApi, jogo)) {
      resumo.ignorados += 1;
      continue;
    }
    const atual = porId.get(jogo.id);
    if (!atual) {
      jogos.push(jogo);
      resumo.novos += 1;
      continue;
    }

    // A tabela não traz estes campos. O que outras fontes completaram continua lá.
    const mesclado = { ...jogo };
    for (const campo of CAMPOS_COMPLEMENTADOS) mesclado[campo] = jogo[campo] ?? atual[campo] ?? null;
    if (jogoMudou(atual, mesclado)) {
      jogos[jogos.indexOf(atual)] = mesclado;
      resumo.alterados += 1;
    } else {
      resumo.iguais += 1;
    }
  }

  return { jogos: jogos.sort(ordenarPorData), resumo };
}

async function baixarPagina() {
  let resposta;
  try {
    resposta = await fetch(URL_PAGINA, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  } catch (erro) {
    throw new ErroRobo(`Não foi possível baixar a página do Futebol 80 (${erro.cause?.code ?? erro.name}).`);
  }
  if (!resposta.ok) throw new ErroRobo(`A página do Futebol 80 respondeu com o código ${resposta.status}.`);
  return new TextDecoder('windows-1252').decode(await resposta.arrayBuffer());
}

function mostrarPorDecada(jogosPorTemporada) {
  const porDecada = new Map();
  for (const [temporada, jogos] of jogosPorTemporada) {
    const decada = Math.floor(temporada / 10) * 10;
    porDecada.set(decada, (porDecada.get(decada) ?? 0) + jogos.length);
  }
  const decadas = [...porDecada].sort(([a], [b]) => a - b);
  console.log('\nJogos lidos, por década da temporada:');
  for (const [decada, total] of decadas) {
    console.log(`  ${decada}-${decada + 9}: ${total}`);
  }
  return Object.fromEntries(decadas);
}

async function executar({ pastaDados = PASTA_DADOS, html, instante = new Date() } = {}) {
  const pagina = html ?? (await baixarPagina());
  const linhas = lerLinhas(pagina);
  const lidos = lerJogos(linhas);
  if (lidos.length === 0) throw new ErroRobo('Nenhum jogo encontrado na página. Nada foi gravado.');
  conferirTotais(linhas, lidos);
  console.log(`Jogos lidos: ${lidos.length}. A leitura bate com os totais da própria página.`);

  const atualizadoEm = formatarInstante(instante);
  const idsUsados = new Map();
  const jogosPorTemporada = new Map();
  for (const lido of lidos) {
    const jogo = converterJogo(lido, atualizadoEm);
    // Dois jogos no mesmo dia e contra o mesmo time teriam o mesmo id.
    const repeticoes = (idsUsados.get(jogo.id) ?? 0) + 1;
    idsUsados.set(jogo.id, repeticoes);
    if (repeticoes > 1) jogo.id = `${jogo.id}-${repeticoes}`;

    const temporada = temporadaDoJogo(lido);
    if (!jogosPorTemporada.has(temporada)) jogosPorTemporada.set(temporada, []);
    jogosPorTemporada.get(temporada).push(jogo);
  }

  const total = { novos: 0, alterados: 0, iguais: 0, ignorados: 0 };
  let algoMudou = false;
  for (const [temporada, importados] of jogosPorTemporada) {
    const arquivo = path.join(pastaDados, 'jogos', `${temporada}.json`);
    const existente = lerJson(arquivo, null);
    if (existente !== null && !Array.isArray(existente.jogos)) {
      throw new ErroRobo(`O arquivo ${temporada}.json não tem a lista de jogos. Parei antes de gravá-lo.`);
    }

    const { jogos, resumo } = juntarHistorico(existente?.jogos ?? [], importados);
    if (gravarSeMudou(arquivo, { temporada, jogos })) algoMudou = true;
    for (const campo of Object.keys(total)) total[campo] += resumo[campo];
  }
  atualizarIndice(pastaDados, algoMudou, atualizadoEm);

  console.log(
    `Novos: ${total.novos}. Alterados: ${total.alterados}. Já estavam iguais: ${total.iguais}. ` +
      `Ignorados porque a API já tem o jogo: ${total.ignorados}.`,
  );
  const porDecada = mostrarPorDecada(jogosPorTemporada);
  console.log(`\nTemporadas: ${jogosPorTemporada.size}. ${algoMudou ? 'Arquivos gravados.' : 'Nada mudou. Nenhum arquivo foi gravado.'}`);

  return { ...total, porDecada, temporadas: jogosPorTemporada.size, algoMudou };
}

if (require.main === module) {
  executar().catch((erro) => {
    console.error(`ERRO: ${erro instanceof ErroRobo ? erro.message : erro.stack}`);
    process.exitCode = 1;
  });
}

module.exports = { baixarPagina, executar, juntarHistorico, nomeDaCompeticao, temporadaDoJogo };
