'use strict';

// Completa hora, fase, estádio e cidade dos jogos que estão nos arquivos de dados/jogos, usando as
// fichas técnicas do Futebol 80 e as páginas de temporada da Wikipédia.
// Uso: node scripts/complementar-jogos.js            (grava)
//      node scripts/complementar-jogos.js --simular  (só mostra o que faria)
// Só preenche campo vazio. Nunca muda placar, data ou times. Se o placar não bater, o jogo fica
// como está e aparece no registro, para alguém conferir.

const fs = require('node:fs');
const path = require('node:path');

const {
  ErroRobo,
  PASTA_DADOS,
  atualizarIndice,
  formatarInstante,
  gravarSeMudou,
  lerJson,
  normalizar,
} = require('./atualizar.js');

const URL_FICHAS = 'https://www.futebol80.com.br/links/times/bahia/bahiaft.htm';
const API_WIKIPEDIA = 'https://en.wikipedia.org/w/api.php';
const TEMPORADAS_WIKIPEDIA = [2023, 2024, 2025];
const CAMPOS = ['hora', 'fase', 'estadio', 'cidade'];
const TEMPO_LIMITE_MS = 60000;
const DIAS_DE_TOLERANCIA = 3;

const MESES = {
  janeiro: '01',
  fevereiro: '02',
  março: '03',
  abril: '04',
  maio: '05',
  junho: '06',
  julho: '07',
  agosto: '08',
  setembro: '09',
  outubro: '10',
  outubo: '10', // Escrito assim em algumas fichas.
  novembro: '11',
  dezembro: '12',
};
const MESES_INGLES = {
  January: '01',
  February: '02',
  March: '03',
  April: '04',
  May: '05',
  June: '06',
  July: '07',
  August: '08',
  September: '09',
  October: '10',
  November: '11',
  December: '12',
};

// Palavras que indicam que um trecho do título da ficha é a fase, e não o nome da competição.
const PALAVRAS_DE_FASE = /fase|turno|etapa|rodada|fina[li]|quartas|oitavas|grupo|quadrangular|triangular|hexagonal|octogonal|repescagem|desempate|jogo/i;

function limparCelula(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function ladosDoPlacar(casa, golsCasa, golsFora, fora) {
  const bahiaEmCasa = normalizar(casa) === 'bahia';
  if (!bahiaEmCasa && normalizar(fora) !== 'bahia') return null;
  return {
    adversario: bahiaEmCasa ? fora : casa,
    pro: Number(bahiaEmCasa ? golsCasa : golsFora),
    contra: Number(bahiaEmCasa ? golsFora : golsCasa),
  };
}

// Fichas do Futebol 80: "Bahia 1 x 0 Botafogo", depois a data, a competição e "Local: Estádio (Cidade)".
function lerFichas(html) {
  const linhas = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((linha) => [...linha[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((celula) => limparCelula(celula[1])).filter(Boolean))
    .filter((celulas) => celulas.length > 0);

  const fichas = [];
  linhas.forEach((celulas, i) => {
    // O título pode vir depois de outra célula, como "Jogo 31".
    const titulo = celulas.map((celula) => /^(.+?) (\d+) x (\d+) (.+)$/.exec(celula)).find(Boolean);
    if (!titulo) return;
    // Algumas fichas têm uma linha a mais antes da data: "(Na prorrogação: Guarani 1 x 0 Bahia)".
    // O título traz só o tempo normal. A tabela de jogos traz a soma dos dois.
    const prorrogacao = /^\(Na prorrogação: (.+?) (\d+) x (\d+) (.+?)\)$/.exec(linhas[i + 1]?.[0] ?? '');
    const inicio = /^\(/.test(linhas[i + 1]?.[0] ?? '') ? i + 2 : i + 1;
    const data = /^(\d{1,2})\/([A-Za-zçÇ]+)\/(\d{4})$/.exec(linhas[inicio]?.[0] ?? '');
    const mes = data && MESES[data[2].toLowerCase()];
    const lados = ladosDoPlacar(titulo[1], titulo[2], titulo[3], titulo[4]);
    if (!mes || !lados) return;
    const extra = prorrogacao && ladosDoPlacar(prorrogacao[1], prorrogacao[2], prorrogacao[3], prorrogacao[4]);
    if (extra) {
      lados.pro += extra.pro;
      lados.contra += extra.contra;
    }

    const local = /^Local:\s*(.*)$/.exec(linhas[inicio + 2]?.[0] ?? '');
    const nomeLocal = local?.[1].trim() ?? '';
    const partes = /^(.*?)\s*\(([^)]+)\)$/.exec(nomeLocal);
    const fase = (linhas[inicio + 1]?.[0] ?? '')
      .split(' - ')
      .slice(1)
      .map((parte) => parte.trim())
      .filter((parte) => PALAVRAS_DE_FASE.test(parte))
      .join(', ');

    fichas.push({
      data: `${data[3]}-${mes}-${data[1].padStart(2, '0')}`,
      ...lados,
      hora: null,
      fase: fase || null,
      estadio: (partes ? partes[1] : nomeLocal) || null,
      // A ficha escreve "Campinas-SP". Os outros jogos trazem só a cidade.
      cidade: partes ? partes[2].replace(/-[A-Z]{2}$/, '') : null,
    });
  });
  return fichas;
}

function limparWikitexto(valor) {
  return String(valor ?? '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function caixasDeJogo(wikitexto) {
  const caixas = [];
  const padrao = /\{\{\s*football ?box collapsible/gi;
  let achado;
  while ((achado = padrao.exec(wikitexto))) {
    let nivel = 0;
    let i = achado.index;
    for (; i < wikitexto.length - 1; i += 1) {
      if (wikitexto.startsWith('{{', i)) {
        nivel += 1;
        i += 1;
      } else if (wikitexto.startsWith('}}', i)) {
        nivel -= 1;
        i += 1;
        if (nivel === 0) break;
      }
    }
    caixas.push(wikitexto.slice(achado.index, i + 1));
  }
  return caixas;
}

function camposDaCaixa(corpo) {
  const partes = [];
  let nivel = 0;
  let atual = '';
  for (let i = 2; i < corpo.length - 2; i += 1) {
    const dois = corpo.slice(i, i + 2);
    if (dois === '{{' || dois === '[[') {
      nivel += 1;
      atual += dois;
      i += 1;
    } else if (dois === '}}' || dois === ']]') {
      nivel -= 1;
      atual += dois;
      i += 1;
    } else if (corpo[i] === '|' && nivel === 0) {
      partes.push(atual);
      atual = '';
    } else {
      atual += corpo[i];
    }
  }
  partes.push(atual);
  const campos = {};
  for (const parte of partes.slice(1)) {
    const igual = parte.indexOf('=');
    if (igual > 0) campos[parte.slice(0, igual).trim().toLowerCase()] = parte.slice(igual + 1).trim();
  }
  return campos;
}

function lerDataDaWikipedia(valor, ano) {
  const modelo = /\{\{\s*start date\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i.exec(valor ?? '');
  if (modelo) return `${modelo[1]}-${modelo[2].padStart(2, '0')}-${modelo[3].padStart(2, '0')}`;
  const texto = /(\d{1,2}) ([A-Z][a-z]+)(?: (\d{4}))?/.exec(valor ?? '');
  if (!texto || !MESES_INGLES[texto[2]]) return null;
  return `${texto[3] ?? ano}-${MESES_INGLES[texto[2]]}-${texto[1].padStart(2, '0')}`;
}

// Só aceita horário com o fuso informado, e leva para o horário de Salvador (UTC-3).
function lerHoraDaWikipedia(valor) {
  const texto = String(valor ?? '');
  const modelo = /\{\{\s*UTZ\s*\|\s*(\d{1,2}):(\d{2})\s*\|\s*([-−+]?\d+)/i.exec(texto);
  const solto = /(\d{1,2}):(\d{2}).*?UTC\s*([-−+]\d+)/i.exec(texto);
  const partes = modelo ?? solto;
  if (!partes) return null;
  const fuso = Number(partes[3].replace('−', '-'));
  const minutos = (((Number(partes[1]) - fuso - 3) * 60 + Number(partes[2])) % 1440 + 1440) % 1440;
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

function lerFaseDaWikipedia(valor) {
  const texto = limparWikitexto(valor);
  if (/^\d+\*?$/.test(texto)) return `${parseInt(texto, 10)}ª rodada`;
  if (/^semi/i.test(texto)) return 'Semifinal';
  if (/^final$/i.test(texto)) return 'Final';
  return null;
}

function lerJogosDaWikipedia(wikitexto, ano) {
  const jogos = [];
  for (const corpo of caixasDeJogo(wikitexto)) {
    const campos = camposDaCaixa(corpo);
    const placar = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(limparWikitexto(campos.score));
    const data = lerDataDaWikipedia(campos.date, ano);
    const lados = placar && ladosDoPlacar(limparWikitexto(campos.team1), placar[1], placar[2], limparWikitexto(campos.team2));
    if (!data || !lados) continue;
    const estadio = limparWikitexto(campos.stadium);
    jogos.push({
      data,
      ...lados,
      hora: lerHoraDaWikipedia(campos.time),
      fase: lerFaseDaWikipedia(campos.round),
      // Nome de patrocínio: "Casa de Apostas (Arena Fonte Nova)" fica "Arena Fonte Nova".
      estadio: /\(([^)]+)\)/.exec(estadio)?.[1] ?? (estadio || null),
      cidade: limparWikitexto(campos.location).split(',')[0].trim() || null,
    });
  }
  return jogos;
}

function adversarioDoJogo(jogo) {
  return jogo.mandante === 'Bahia' ? jogo.visitante : jogo.mandante;
}

function placarDoBahia(jogo) {
  return jogo.mandante === 'Bahia'
    ? { pro: jogo.gols_mandante, contra: jogo.gols_visitante }
    : { pro: jogo.gols_visitante, contra: jogo.gols_mandante };
}

const nomeParaComparar = (nome) => normalizar(nome).replace(/-[a-z]{2,3}$/, '');

// Acha o jogo do complemento: mesmo dia e, se houver mais de um jogo no dia, mesmo adversário.
function acharJogo(jogosDoDia, complemento) {
  if (jogosDoDia.length === 1) return jogosDoDia[0];
  const adversario = nomeParaComparar(complemento.adversario);
  return jogosDoDia.find((jogo) => nomeParaComparar(adversarioDoJogo(jogo)) === adversario) ?? null;
}

// Mesmo adversário e mesmo placar, com poucos dias de diferença: é o mesmo jogo, com a data
// diferente em uma das fontes. A data dos dados não muda.
function acharComDataProxima(jogos, complemento) {
  const alvo = Date.parse(complemento.data);
  const adversario = nomeParaComparar(complemento.adversario);
  return jogos.find((jogo) => {
    const { pro, contra } = placarDoBahia(jogo);
    return Math.abs(Date.parse(jogo.data) - alvo) <= DIAS_DE_TOLERANCIA * 86400000
      && nomeParaComparar(adversarioDoJogo(jogo)) === adversario
      && pro === complemento.pro
      && contra === complemento.contra;
  }) ?? null;
}

// Preenche só os campos vazios. Devolve o que aconteceu com cada complemento.
function aplicarComplementos(jogos, complementos, carimbo) {
  const porDia = new Map();
  for (const jogo of jogos) {
    if (!porDia.has(jogo.data)) porDia.set(jogo.data, []);
    porDia.get(jogo.data).push(jogo);
  }

  const resumo = { jogos: 0, campos: 0, jaCompletos: 0, semPar: [], placarDiferente: [], dataDiferente: [] };
  for (const complemento of complementos) {
    let jogo = acharJogo(porDia.get(complemento.data) ?? [], complemento);
    if (!jogo) {
      jogo = acharComDataProxima(jogos, complemento);
      if (!jogo) {
        resumo.semPar.push(complemento);
        continue;
      }
      resumo.dataDiferente.push({ complemento, jogo });
    }

    const { pro, contra } = placarDoBahia(jogo);
    if (pro !== complemento.pro || contra !== complemento.contra) {
      resumo.placarDiferente.push({ complemento, jogo });
      continue;
    }

    const preenchidos = CAMPOS.filter((campo) => (jogo[campo] === null || jogo[campo] === undefined) && complemento[campo]);
    if (preenchidos.length === 0) {
      resumo.jaCompletos += 1;
      continue;
    }
    for (const campo of preenchidos) jogo[campo] = complemento[campo];
    jogo.atualizado_em = carimbo;
    resumo.jogos += 1;
    resumo.campos += preenchidos.length;
  }
  return resumo;
}

async function baixar(url, opcoes = {}) {
  let resposta;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS), ...opcoes });
  } catch (erro) {
    throw new ErroRobo(`Não foi possível baixar ${url} (${erro.cause?.code ?? erro.name}).`);
  }
  if (!resposta.ok) throw new ErroRobo(`${url} respondeu com o código ${resposta.status}.`);
  return resposta;
}

async function baixarFichas() {
  const resposta = await baixar(URL_FICHAS);
  return lerFichas(new TextDecoder('windows-1252').decode(await resposta.arrayBuffer()));
}

async function baixarWikipedia(ano) {
  const busca = new URLSearchParams({ action: 'parse', prop: 'wikitext', redirects: '1', format: 'json', page: `${ano} Esporte Clube Bahia season` });
  const resposta = await baixar(`${API_WIKIPEDIA}?${busca}`, { headers: { 'user-agent': 'EstatisticasBahia/1.0 (site de torcedor)' } });
  const corpo = await resposta.json();
  if (corpo.error) throw new ErroRobo(`A Wikipédia não tem a página da temporada ${ano}.`);
  return lerJogosDaWikipedia(corpo.parse.wikitext['*'], ano);
}

function descreverSemPar(lista) {
  return lista.map((c) => `  ${c.data} x ${c.adversario} (${c.pro} x ${c.contra})`);
}

function descreverDiferencas(lista) {
  return lista.map(({ complemento: c, jogo }) => {
    const { pro, contra } = placarDoBahia(jogo);
    return `  ${c.data} x ${adversarioDoJogo(jogo)}: nos dados ${pro ?? '?'} x ${contra ?? '?'}, na outra fonte ${c.pro} x ${c.contra}`;
  });
}

async function executar({ pastaDados = PASTA_DADOS, simular = false, instante = new Date(), fontes = null } = {}) {
  const pastaJogos = path.join(pastaDados, 'jogos');
  const arquivos = fs.readdirSync(pastaJogos).filter((nome) => /^\d{4}\.json$/.test(nome)).sort();
  const temporadas = new Map(arquivos.map((nome) => [nome, lerJson(path.join(pastaJogos, nome), null)]));
  const todos = [...temporadas.values()].flatMap((dados) => dados.jogos);
  const carimbo = formatarInstante(instante);

  const listaDeFontes = fontes ?? [
    ['Fichas do Futebol 80', await baixarFichas()],
    ...await Promise.all(TEMPORADAS_WIKIPEDIA.map(async (ano) => [`Wikipédia ${ano}`, await baixarWikipedia(ano)])),
  ];

  const relatorio = {};
  for (const [nome, complementos] of listaDeFontes) {
    const resumo = aplicarComplementos(todos, complementos, carimbo);
    relatorio[nome] = resumo;
    console.log(`\n${nome}: ${complementos.length} jogos lidos.`);
    console.log(`  Jogos completados: ${resumo.jogos}. Campos preenchidos: ${resumo.campos}. Já estavam completos: ${resumo.jaCompletos}.`);
    if (resumo.semPar.length > 0) {
      console.log(`  Sem jogo correspondente nos dados: ${resumo.semPar.length}.`);
      descreverSemPar(resumo.semPar).forEach((linha) => console.log(linha));
    }
    if (resumo.dataDiferente.length > 0) {
      console.log(`  Mesmo jogo com data diferente, data dos dados mantida: ${resumo.dataDiferente.length}.`);
      resumo.dataDiferente.forEach(({ complemento: c, jogo }) => console.log(`  ${jogo.data} x ${adversarioDoJogo(jogo)}: na outra fonte ${c.data}`));
    }
    if (resumo.placarDiferente.length > 0) {
      console.log(`  Placar diferente, jogo não alterado: ${resumo.placarDiferente.length}.`);
      descreverDiferencas(resumo.placarDiferente).forEach((linha) => console.log(linha));
    }
  }

  const contagem = {};
  for (const campo of CAMPOS) contagem[campo] = todos.filter((jogo) => jogo[campo]).length;
  console.log(`\nTotal nos dados, de ${todos.length} jogos: ${JSON.stringify(contagem)}.`);

  if (simular) {
    console.log('Simulação: nada foi gravado.');
    return { relatorio, contagem, gravados: 0 };
  }

  let gravados = 0;
  for (const [nome, dados] of temporadas) {
    if (gravarSeMudou(path.join(pastaJogos, nome), dados)) gravados += 1;
  }
  if (gravados > 0) atualizarIndice(pastaDados, true, carimbo);
  console.log(`Arquivos gravados: ${gravados}.`);
  return { relatorio, contagem, gravados };
}

if (require.main === module) {
  executar({ simular: process.argv.includes('--simular') }).catch((erro) => {
    console.error(`ERRO: ${erro instanceof ErroRobo ? erro.message : erro.stack}`);
    process.exitCode = 1;
  });
}

module.exports = { aplicarComplementos, executar, lerFichas, lerHoraDaWikipedia, lerJogosDaWikipedia };
