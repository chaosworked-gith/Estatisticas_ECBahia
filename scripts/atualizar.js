'use strict';

// Robô que atualiza os jogos do Bahia a partir da API-Football.
// Uso: API_FOOTBALL_KEY=sua_chave node scripts/atualizar.js
// Para consultar outra temporada: TEMPORADA=2024 (padrão: ano atual em Salvador).

const fs = require('node:fs');
const path = require('node:path');

const API_BASE = 'https://v3.football.api-sports.io';
const FUSO = 'America/Bahia';
const FONTE = 'api-football';
const PASTA_DADOS = path.resolve(__dirname, '..', 'dados');
const TEMPO_LIMITE_MS = 30000;

// Códigos de situação da API para o nosso formato. Código fora da lista gera aviso.
const SITUACOES = {
  TBD: 'agendado',
  NS: 'agendado',
  '1H': 'ao_vivo',
  HT: 'ao_vivo',
  '2H': 'ao_vivo',
  ET: 'ao_vivo',
  BT: 'ao_vivo',
  P: 'ao_vivo',
  INT: 'ao_vivo',
  LIVE: 'ao_vivo',
  FT: 'encerrado',
  AET: 'encerrado',
  PEN: 'encerrado',
  AWD: 'encerrado',
  WO: 'encerrado',
  PST: 'adiado',
  SUSP: 'adiado',
  CANC: 'cancelado',
  ABD: 'cancelado',
};

// Chave: "país|nome", como a API escreve, sem acento e em minúsculas.
const COMPETICOES = {
  'brazil|serie a': 'Campeonato Brasileiro Série A',
  'brazil|serie b': 'Campeonato Brasileiro Série B',
  'brazil|serie c': 'Campeonato Brasileiro Série C',
  'brazil|serie d': 'Campeonato Brasileiro Série D',
  'brazil|copa do brasil': 'Copa do Brasil',
  'brazil|copa do nordeste': 'Copa do Nordeste',
  'brazil|baiano - 1': 'Campeonato Baiano',
  'brazil|supercopa do brasil': 'Supercopa do Brasil',
  'world|conmebol libertadores': 'Copa Libertadores',
  'world|conmebol sudamericana': 'Copa Sul-Americana',
  'world|conmebol recopa': 'Recopa Sul-Americana',
  'world|friendlies clubs': 'Amistoso',
};

const FASES = {
  'round of 32': '16 avos de final',
  '16th finals': '16 avos de final',
  'round of 16': 'Oitavas de final',
  '8th finals': 'Oitavas de final',
  'quarter-finals': 'Quartas de final',
  'semi-finals': 'Semifinal',
  final: 'Final',
  '3rd place final': 'Disputa de terceiro lugar',
  'preliminary round': 'Fase preliminar',
  'knockout round play-offs': 'Repescagem',
};

// A API escreve alguns nomes sem acento. Times fora da lista ficam como vieram.
const NOMES_TIMES = {
  'america mineiro': 'América-MG',
  'athletico paranaense': 'Athletico-PR',
  'atletico goianiense': 'Atlético-GO',
  'atletico mineiro': 'Atlético-MG',
  'atletico paranaense': 'Athletico-PR',
  'atletico-mg': 'Atlético-MG',
  avai: 'Avaí',
  ceara: 'Ceará',
  confianca: 'Confiança',
  criciuma: 'Criciúma',
  cuiaba: 'Cuiabá',
  goias: 'Goiás',
  gremio: 'Grêmio',
  nautico: 'Náutico',
  'sao paulo': 'São Paulo',
  'vasco da gama': 'Vasco da Gama',
  vitoria: 'Vitória',
};

// Campos que contam para dizer que um jogo mudou.
const CAMPOS_COMPARADOS = [
  'data',
  'hora',
  'competicao',
  'fase',
  'mandante',
  'visitante',
  'gols_mandante',
  'gols_visitante',
  'penaltis',
  'estadio',
  'cidade',
  'situacao',
  'fonte',
  'id_api',
];

// Erro já explicado em português, mostrado sem detalhes técnicos.
class ErroRobo extends Error {}

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

function partesNoFuso(instante) {
  const partes = {};
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  });
  for (const { type, value } of formato.formatToParts(instante)) {
    partes[type] = value;
  }
  return partes;
}

function formatarInstante(instante) {
  const p = partesNoFuso(instante);
  const deslocamento = p.timeZoneName.replace('GMT', '') || '+00:00';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${deslocamento}`;
}

function traduzirCompeticao(liga, avisos) {
  const traducao = COMPETICOES[`${normalizar(liga?.country)}|${normalizar(liga?.name)}`];
  if (traducao) return traducao;
  avisos.add(`Competição sem tradução: "${liga?.name}" (${liga?.country}). Mantive o nome da API.`);
  return liga?.name ?? null;
}

function traduzirFase(rodada, avisos) {
  if (!rodada) return null;
  const texto = rodada.trim();
  if (FASES[texto.toLowerCase()]) return FASES[texto.toLowerCase()];

  let m;
  if ((m = texto.match(/^Regular Season - (\d+)$/i))) return `${m[1]}ª rodada`;
  if ((m = texto.match(/^Group Stage - (\d+)$/i))) return `Fase de grupos, ${m[1]}ª rodada`;
  if ((m = texto.match(/^Group ([A-Z]) - (\d+)$/i))) return `Grupo ${m[1].toUpperCase()}, ${m[2]}ª rodada`;
  if ((m = texto.match(/^(\d+)(?:st|nd|rd|th) Qualifying Round$/i))) return `${m[1]}ª fase preliminar`;
  if ((m = texto.match(/^(\d+)(?:st|nd|rd|th) (?:Phase|Round)(?: - (\d+))?$/i))) {
    return m[2] ? `${m[1]}ª fase, ${m[2]}ª rodada` : `${m[1]}ª fase`;
  }

  avisos.add(`Fase sem tradução: "${texto}". Mantive o nome da API.`);
  return texto;
}

function nomeTime(time, idBahia) {
  if (time?.id === idBahia) return 'Bahia';
  return NOMES_TIMES[normalizar(time?.name)] ?? time?.name ?? null;
}

function converterJogo(item, idBahia, atualizadoEm, avisos) {
  const { fixture, league, teams, goals, score } = item;
  const codigo = fixture?.status?.short;
  const situacao = SITUACOES[codigo];
  if (!situacao) {
    avisos.add(`Jogo ${fixture?.id} ignorado: situação desconhecida "${codigo}".`);
    return null;
  }

  const instante = new Date(fixture.date);
  if (Number.isNaN(instante.getTime())) {
    avisos.add(`Jogo ${fixture.id} ignorado: data inválida "${fixture.date}".`);
    return null;
  }
  const p = partesNoFuso(instante);
  const penaltis = score?.penalty;

  return {
    id: `api-${fixture.id}`,
    data: `${p.year}-${p.month}-${p.day}`,
    // TBD quer dizer horário a definir: a hora enviada pela API não vale.
    hora: codigo === 'TBD' ? null : `${p.hour}:${p.minute}`,
    competicao: traduzirCompeticao(league, avisos),
    fase: traduzirFase(league?.round, avisos),
    mandante: nomeTime(teams?.home, idBahia),
    visitante: nomeTime(teams?.away, idBahia),
    gols_mandante: goals?.home ?? null,
    gols_visitante: goals?.away ?? null,
    penaltis:
      penaltis?.home != null && penaltis?.away != null
        ? { mandante: penaltis.home, visitante: penaltis.away }
        : null,
    estadio: fixture.venue?.name || null,
    // A API costuma mandar "Salvador, Bahia".
    cidade: fixture.venue?.city?.split(',')[0].trim() || null,
    situacao,
    fonte: FONTE,
    id_api: fixture.id,
    atualizado_em: atualizadoEm,
  };
}

function converterJogos(itens, idBahia, atualizadoEm) {
  const avisos = new Set();
  const jogos = itens
    .map((item) => converterJogo(item, idBahia, atualizadoEm, avisos))
    .filter(Boolean);
  return { jogos, avisos: [...avisos] };
}

function jogoMudou(antigo, novo) {
  return CAMPOS_COMPARADOS.some(
    (campo) => JSON.stringify(antigo[campo] ?? null) !== JSON.stringify(novo[campo] ?? null),
  );
}

function ordenarJogos(a, b) {
  return (
    a.data.localeCompare(b.data) ||
    (a.hora ?? '').localeCompare(b.hora ?? '') ||
    String(a.id).localeCompare(String(b.id))
  );
}

// Junta pelo id_api. Jogos sem id_api (histórico) e jogos que não vieram na resposta ficam intactos.
function juntarJogos(existentes, novos) {
  const pendentes = new Map(novos.map((jogo) => [jogo.id_api, jogo]));
  const resumo = { novos: 0, alterados: 0, remarcados: [], semMudanca: 0, ausentes: 0 };

  const jogos = existentes.map((antigo) => {
    if (antigo.id_api == null) return antigo;

    const novo = pendentes.get(antigo.id_api);
    if (!novo) {
      resumo.ausentes += 1;
      return antigo;
    }
    pendentes.delete(antigo.id_api);

    if (!jogoMudou(antigo, novo)) {
      resumo.semMudanca += 1;
      return antigo;
    }

    resumo.alterados += 1;
    if (antigo.data !== novo.data || antigo.hora !== novo.hora) {
      resumo.remarcados.push({ antes: antigo, depois: novo });
    }
    return { ...novo, id: antigo.id };
  });

  for (const novo of pendentes.values()) {
    jogos.push(novo);
    resumo.novos += 1;
  }

  return { jogos: jogos.sort(ordenarJogos), resumo };
}

function lerJson(arquivo, padrao) {
  let texto;
  try {
    texto = fs.readFileSync(arquivo, 'utf8');
  } catch (erro) {
    if (erro.code === 'ENOENT') return padrao;
    throw erro;
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroRobo(`O arquivo ${path.basename(arquivo)} não é um JSON válido. Nada foi gravado.`);
  }
}

// Compara o conteúdo, não os bytes: a quebra de linha muda entre Windows e Linux.
function gravarSeMudou(arquivo, dados) {
  const atual = lerJson(arquivo, null);
  if (atual !== null && JSON.stringify(atual) === JSON.stringify(dados)) return false;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, `${JSON.stringify(dados, null, 2)}\n`);
  return true;
}

function mostrarConsultasRestantes(cabecalhos) {
  const restantes = cabecalhos.get('x-ratelimit-requests-remaining');
  const limite = cabecalhos.get('x-ratelimit-requests-limit');
  if (restantes === null) {
    console.log('Consultas restantes hoje: a API não informou.');
    return;
  }
  console.log(`Consultas restantes hoje: ${restantes}${limite ? ` de ${limite}` : ''}.`);
}

function explicarRecusa(erros, temporada) {
  const explicacoes = {
    plan: `A temporada ${temporada} não está liberada no seu plano. Veja no painel da API-Football quais temporadas sua conta pode consultar.`,
    token: 'A chave foi recusada. Confira o valor de API_FOOTBALL_KEY.',
    access: 'A conta não tem acesso à API. Veja a situação dela no painel da API-Football.',
    requests: 'O limite de consultas do dia acabou. O robô volta a funcionar quando o limite renovar.',
    rateLimit: 'Muitas consultas em pouco tempo. Tente de novo em um minuto.',
  };

  const linhas = erros.map(({ campo, mensagem }) => {
    const tipo = explicacoes[campo] ? campo : /\bplans?\b/i.test(mensagem) ? 'plan' : null;
    return tipo ? `${explicacoes[tipo]} Resposta da API: "${mensagem}"` : `Resposta da API: "${mensagem}"`;
  });
  return `A API recusou a consulta. ${linhas.join(' ')}`;
}

async function consultarApi(caminho, parametros, chave, temporada) {
  const url = new URL(caminho, API_BASE);
  // Mantém a barra do fuso, como na documentação da API.
  url.search = new URLSearchParams(parametros).toString().replace(/%2F/g, '/');

  let resposta;
  try {
    resposta = await fetch(url, {
      headers: { 'x-apisports-key': chave },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    throw new ErroRobo(`Não foi possível falar com a API (${erro.cause?.code ?? erro.name}).`);
  }
  mostrarConsultasRestantes(resposta.headers);

  let corpo = null;
  try {
    corpo = JSON.parse(await resposta.text());
  } catch {
    // Resposta fora do formato: tratada logo abaixo.
  }

  // A recusa pode vir com qualquer código HTTP, inclusive 200. O campo "error" é só um código interno.
  const erros = Object.entries(corpo?.errors ?? {})
    .filter(([campo]) => campo !== 'error')
    .map(([campo, mensagem]) => ({ campo, mensagem: String(mensagem) }));
  if (erros.length > 0) throw new ErroRobo(explicarRecusa(erros, temporada));

  if (!resposta.ok || !Array.isArray(corpo?.response)) {
    throw new ErroRobo(`A API respondeu de um jeito inesperado (código ${resposta.status}). Nada foi gravado.`);
  }
  return corpo.response;
}

async function obterIdBahia(pastaDados, chave, temporada) {
  const arquivo = path.join(pastaDados, 'config.json');
  const config = lerJson(arquivo, null);
  if (Number.isInteger(config?.id_bahia)) return config.id_bahia;

  console.log('Primeira execução: procurando o Bahia na API.');
  const times = await consultarApi('/teams', { name: 'Bahia', country: 'Brazil' }, chave, temporada);
  const achados = times.filter(
    ({ team }) => normalizar(team?.name) === 'bahia' && normalizar(team?.country) === 'brazil' && !team?.national,
  );
  if (achados.length !== 1) {
    throw new ErroRobo(`Esperava achar um único Bahia na API e achei ${achados.length}. Nada foi gravado.`);
  }

  const { id, name } = achados[0].team;
  gravarSeMudou(arquivo, { id_bahia: id, nome_api: name });
  console.log(`Bahia encontrado: id ${id}. Guardado em dados/config.json.`);
  return id;
}

function listarTemporadas(pastaDados) {
  const pasta = path.join(pastaDados, 'jogos');
  if (!fs.existsSync(pasta)) return [];
  return fs
    .readdirSync(pasta)
    .filter((nome) => /^\d{4}\.json$/.test(nome))
    .map((nome) => Number(nome.slice(0, 4)))
    .sort((a, b) => b - a);
}

function atualizarIndice(pastaDados, jogosMudaram, atualizadoEm) {
  const arquivo = path.join(pastaDados, 'indice.json');
  const atual = lerJson(arquivo, { ultima_atualizacao: null, temporadas: [] });
  return gravarSeMudou(arquivo, {
    ultima_atualizacao: jogosMudaram ? atualizadoEm : atual.ultima_atualizacao,
    temporadas: listarTemporadas(pastaDados),
  });
}

function descreverHorario(jogo) {
  const [ano, mes, dia] = jogo.data.split('-');
  return `${dia}/${mes}/${ano} ${jogo.hora ?? '(horário a definir)'}`;
}

function obterTemporada(instante) {
  const temporada = process.env.TEMPORADA?.trim() || partesNoFuso(instante).year;
  if (!/^\d{4}$/.test(temporada)) {
    throw new ErroRobo(`A temporada "${temporada}" não é válida. Use um ano com quatro dígitos.`);
  }
  return Number(temporada);
}

async function executar({ pastaDados = PASTA_DADOS, chave = process.env.API_FOOTBALL_KEY, instante = new Date() } = {}) {
  const chaveLimpa = chave?.trim();
  if (!chaveLimpa) {
    throw new ErroRobo('A variável de ambiente API_FOOTBALL_KEY não foi definida. Sem ela, o robô não consulta a API.');
  }
  // Evita que um caractere inválido faça a chave aparecer em uma mensagem de erro.
  if (!/^[\x21-\x7e]+$/.test(chaveLimpa)) {
    throw new ErroRobo('A chave em API_FOOTBALL_KEY tem caracteres inválidos. Copie a chave de novo.');
  }

  const temporada = obterTemporada(instante);
  const atualizadoEm = formatarInstante(instante);
  console.log(`Temporada: ${temporada}.`);

  const idBahia = await obterIdBahia(pastaDados, chaveLimpa, temporada);
  const itens = await consultarApi(
    '/fixtures',
    { team: idBahia, season: temporada, timezone: FUSO },
    chaveLimpa,
    temporada,
  );
  console.log(`Jogos recebidos da API: ${itens.length}.`);

  const { jogos: novos, avisos } = converterJogos(itens, idBahia, atualizadoEm);
  avisos.forEach((aviso) => console.log(`Aviso: ${aviso}`));

  const arquivo = path.join(pastaDados, 'jogos', `${temporada}.json`);
  const existente = lerJson(arquivo, null);
  if (existente !== null && !Array.isArray(existente.jogos)) {
    throw new ErroRobo(`O arquivo ${temporada}.json não tem a lista de jogos. Nada foi gravado.`);
  }

  const { jogos, resumo } = juntarJogos(existente?.jogos ?? [], novos);
  console.log(
    `Novos: ${resumo.novos}. Alterados: ${resumo.alterados}. Remarcados: ${resumo.remarcados.length}. ` +
      `Sem mudança: ${resumo.semMudanca}. Não vieram na resposta e foram mantidos: ${resumo.ausentes}.`,
  );
  for (const { antes, depois } of resumo.remarcados) {
    console.log(
      `Remarcado: ${depois.mandante} x ${depois.visitante}, de ${descreverHorario(antes)} para ${descreverHorario(depois)}.`,
    );
  }

  // Sem jogos e sem arquivo, não há o que criar: a lista de temporadas não ganha um ano vazio.
  const jogosMudaram =
    (existente !== null || jogos.length > 0) && gravarSeMudou(arquivo, { temporada, jogos });
  const indiceMudou = atualizarIndice(pastaDados, jogosMudaram, atualizadoEm);

  if (jogosMudaram) console.log(`Gravado: dados/jogos/${temporada}.json.`);
  if (indiceMudou) console.log('Gravado: dados/indice.json.');
  if (!jogosMudaram && !indiceMudou) console.log('Nada mudou. Nenhum arquivo foi gravado.');

  return { temporada, resumo, avisos, jogosMudaram, indiceMudou };
}

if (require.main === module) {
  executar().catch((erro) => {
    console.error(`ERRO: ${erro instanceof ErroRobo ? erro.message : erro.stack}`);
    process.exitCode = 1;
  });
}

module.exports = { ErroRobo, converterJogos, executar, formatarInstante, juntarJogos, traduzirFase };
