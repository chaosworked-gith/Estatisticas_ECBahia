# Estatísticas do Esporte Clube Bahia

Site com os jogos e as estatísticas do Bahia, publicado no GitHub Pages.

O site não tem servidor nem banco de dados. Os jogos ficam em arquivos JSON neste repositório, um robô mantém esses arquivos em dia e a página calcula os números na hora em que é aberta.

## Situação atual

O site mostra o histórico de 1931 a 2025. A temporada 2026 ainda não está aqui, porque o plano gratuito da API-Football só libera de 2022 a 2024. Por isso, o agendamento do robô está desligado no workflow. O botão manual continua lá.

Há dois caminhos para colocar os jogos de 2026:

- **Pelo Futebol 80:** quando a página publicar os jogos, rode de novo `node scripts/importar-historico.js`. Depois, atualize o período e o aviso de 2026 no rodapé do `index.html`.
- **Pela API:** com um plano que libere a temporada, tire o comentário do agendamento em `.github/workflows/atualizar.yml` e use o botão **Run workflow**. Depois, volte a citar a API-Football no rodapé.

## Como funciona

As etapas abaixo descrevem o projeto com o robô ligado. Sem ele, os dados vêm só da importação do histórico.

1. O robô em Node.js roda no GitHub Actions e consulta a API-Football.
2. Se algum dado mudou, ele grava os arquivos em `dados/` e envia para o repositório.
3. O `index.html` lê os JSON e calcula vitórias, empates, derrotas e aproveitamento.

## Estrutura de pastas

```text
.
├── .github/
│   └── workflows/
│       └── atualizar.yml  Agendamento do robô no GitHub Actions
├── dados/
│   ├── config.json        Id do Bahia na API (criado na primeira execução do robô)
│   ├── indice.json        Temporadas existentes e data da última atualização
│   └── jogos/
│       └── ANO.json       Jogos de uma temporada (exemplo: 2026.json)
├── scripts/
│   ├── atualizar.js             Robô de atualização
│   ├── importar-historico.js    Importação do histórico, para rodar uma única vez
│   └── *.test.js                Testes dos dois
├── .nojekyll              Faz o GitHub Pages publicar os arquivos como estão
├── index.html             O site
└── README.md
```

## Formato dos dados

### `dados/indice.json`

```json
{
  "ultima_atualizacao": "2026-11-02T17:17:00-03:00",
  "temporadas": [2026, 2025, 2024]
}
```

Enquanto não houver jogos, `temporadas` fica vazio e `ultima_atualizacao` fica `null`.

### `dados/jogos/ANO.json`

```json
{
  "temporada": 2026,
  "jogos": [
    {
      "id": "api-1234567",
      "data": "2026-04-12",
      "hora": "16:00",
      "competicao": "Campeonato Brasileiro Série A",
      "fase": "3ª rodada",
      "mandante": "Bahia",
      "visitante": "Palmeiras",
      "gols_mandante": 2,
      "gols_visitante": 1,
      "penaltis": null,
      "estadio": "Arena Fonte Nova",
      "cidade": "Salvador",
      "situacao": "encerrado",
      "fonte": "api-football",
      "id_api": 1234567,
      "atualizado_em": "2026-04-12T18:17:00-03:00"
    }
  ]
}
```

Este jogo é só uma ilustração do formato, não é um resultado real.

### Campos de cada jogo

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | texto | Identificador único e estável. Jogo da API: `api-` mais o `id_api`. Jogo histórico: `f80-` mais data e times. |
| `data` | texto | Data do jogo no formato `AAAA-MM-DD`. |
| `hora` | texto ou `null` | Horário de Salvador no formato `HH:MM`. Pode ficar `null` em jogos antigos. |
| `competicao` | texto | Nome da competição em português. |
| `fase` | texto ou `null` | Rodada ou fase, como `3ª rodada` ou `Final`. |
| `mandante` | texto | Time da casa. |
| `visitante` | texto | Time de fora. |
| `gols_mandante` | número ou `null` | Gols do mandante. Fica `null` enquanto o jogo não começa e em W.O. do histórico. |
| `gols_visitante` | número ou `null` | Gols do visitante. Fica `null` enquanto o jogo não começa e em W.O. do histórico. |
| `penaltis` | objeto ou `null` | Disputa de pênaltis, como `{ "mandante": 4, "visitante": 3 }`. Fica `null` se não houve. |
| `estadio` | texto ou `null` | Nome do estádio. Pode ficar `null` em jogos antigos. |
| `cidade` | texto ou `null` | Cidade do jogo. Pode ficar `null` se a fonte não informar. |
| `situacao` | texto | `agendado`, `ao_vivo`, `encerrado`, `adiado` ou `cancelado`. |
| `fonte` | texto | De onde veio o jogo: `api-football` ou `futebol80`. |
| `id_api` | número ou `null` | Número do jogo na API-Football. Fica `null` em jogos históricos. |
| `atualizado_em` | texto | Data e hora da última alteração do jogo, com o fuso de Salvador. |

### O que não é salvo

Vitórias, empates, derrotas e aproveitamento não ficam nos arquivos. O site calcula esses números a partir dos jogos.

### Regras dos dados

- Um jogo é identificado pelo `id_api`. Assim, um jogo remarcado tem a data e o horário corrigidos sem criar outra linha.
- Cada jogo fica no arquivo da sua temporada, mesmo que a data caia em outro ano. Exemplo: os jogos do Brasileirão de 2020 disputados em fevereiro de 2021 ficam em `2020.json`.
- A chave da API fica nos Secrets do repositório, com o nome `API_FOOTBALL_KEY`. Ela nunca é escrita no código.
- O site usa caminhos relativos, como `dados/indice.json`, porque o GitHub Pages publica o projeto em uma subpasta do endereço.

## O robô

O `scripts/atualizar.js` usa só o Node.js, sem instalar nada. Em cada execução, ele:

1. Lê o id do Bahia em `dados/config.json`. Na primeira execução, descobre o id na API e guarda nesse arquivo.
2. Busca todos os jogos da temporada com uma única consulta, no fuso `America/Bahia`.
3. Converte os jogos para o formato acima e junta com os que já existem, usando o `id_api`.
4. Só grava os arquivos se algo mudou. É nesse caso que `ultima_atualizacao` muda.
5. Mostra no registro quantas consultas ainda restam no dia.

A primeira execução gasta duas consultas. As seguintes gastam uma.

Para rodar no computador, no PowerShell:

```powershell
$env:API_FOOTBALL_KEY = "sua_chave"
node scripts/atualizar.js
```

Sem outra indicação, o robô usa o ano atual em Salvador. Para consultar outra temporada, rode antes `$env:TEMPORADA = "2024"`.

Se a API recusar a consulta, o robô explica o motivo, não grava os jogos e termina com erro.

Competição ou fase sem tradução aparece como `Aviso:` no registro e fica com o nome da API. Jogo com situação desconhecida também gera aviso e não entra no arquivo. As traduções ficam em tabelas no começo do script.

Para rodar os testes, que não acessam a API:

```bash
node --test
```

## O agendamento

O agendamento está desligado por enquanto (veja [Situação atual](#situação-atual)). Quando ligado, o arquivo `.github/workflows/atualizar.yml` roda o robô no GitHub Actions:

- **Quando consulta a API:** a cada hora, no minuto 17, e pelo botão **Run workflow**, na aba **Actions**.
- **Em dia de jogo:** nos minutos 2, 32 e 47, o robô também roda, mas só consulta a API se houver jogo por perto. Assim, perto da partida, a consulta acontece a cada 15 minutos.
- **Temporada:** o botão tem um campo opcional para consultar outro ano. Vazio, usa o ano atual.
- **Chave:** vem do Secret `API_FOOTBALL_KEY` do repositório. Sem ela, a execução agendada só avisa e termina sem erro. A manual dá erro.
- **Envio:** só acontece quando algo mudou em `dados/`. A mensagem do commit mostra a data e a hora de Salvador.
- **Uma execução por vez:** se o horário de outra chegar, ela espera a atual terminar.

Se o robô falhar, a execução aparece com erro na aba **Actions**, com a explicação no passo **Rodar o robô**.

O agendamento do GitHub não é exato. Ele pode atrasar e, em horários de muito movimento, pular uma execução. Em repositórios públicos, o GitHub também desliga o agendamento depois de 60 dias sem atividade no repositório.

### Quantas consultas isso gasta

"Jogo por perto" vai de 30 minutos antes até 3 horas depois do horário marcado, enquanto o jogo não estiver encerrado. Jogo que aparece como ao vivo conta por até 5 horas, para cobrir atrasos. Jogo sem horário definido não conta.

| Situação | Consultas no dia |
| --- | --- |
| Dia sem jogo | 24 |
| Dia de jogo que acaba em cerca de 2 horas | 33 |
| Dia de jogo, no máximo normal | 35 |
| Jogo preso como ao vivo | 41 |
| Limite: consulta em todos os horários, o dia inteiro | 96 |

O plano gratuito permite 100 consultas por dia. Cada execução manual gasta mais uma, e a primeira execução do robô gasta duas.

## O histórico

O `scripts/importar-historico.js` lê a [tabela de jogos do Futebol 80](https://www.futebol80.com.br/links/times/bahia/bahiajg.htm), com autorização do responsável pelo site, e grava um arquivo por temporada, com `fonte` igual a `futebol80`. Foi feito para rodar uma única vez:

```bash
node scripts/importar-historico.js
```

Se rodar de novo, não duplica nada. Regras da importação:

- **Conferência:** a leitura precisa bater com os totais publicados na própria página. Se não bater, nada é gravado.
- **API:** jogos que vieram da API nunca são apagados nem sobrescritos. Se a API já tem o jogo daquele dia, a versão do Futebol 80 não entra.
- **Mandante:** a página traz sempre o Bahia primeiro e uma coluna com o local. Em jogo fora, o adversário vira mandante e o placar é invertido. Em campo neutro, o Bahia fica como mandante, na ordem da página.
- **Campos vazios:** a página não informa hora, fase, estádio, cidade e pênaltis.
- **W.O.:** os 3 jogos decididos por W.O. ficam sem placar. Aparecem na lista, mas não entram na conta.
- **Nomes:** os times ficam como na página, com o estado, como `Vitória-BA`. Os nomes da API vêm sem o estado.

A tabela não informa a temporada. Por isso, cada jogo fica no ano da sua data, com uma exceção: jogos de campeonatos nacionais que terminaram no ano seguinte ficam no arquivo da edição a que pertencem. São 45 jogos: as Taças Brasil de 1959, 1963 e 1968 e os Brasileiros de 1973, 1977, 1986, 1988 e 2020. O Campeonato Baiano também atravessou o ano em várias edições antigas, mas a tabela não permite separar essas edições, então ele fica no ano da data.

Se a API trouxer uma temporada que já tem jogos do histórico, a versão da API fica no lugar do jogo do mesmo dia.

## O site

O `index.html` é um arquivo único. Ele lê `dados/indice.json` e o arquivo da temporada escolhida, e calcula os números no navegador. Só a fonte vem de fora, do Google Fonts. Sem ela, o site usa uma fonte do próprio aparelho.

Como a conta é feita:

- **Aproveitamento:** 3 pontos por vitória e 1 por empate, só com jogos encerrados.
- **Pênaltis:** a disputa aparece no jogo, mas o resultado conta como empate.
- **Jogo ao vivo:** aparece nas listas e só entra na conta depois de encerrado.

Para abrir direto uma temporada, acrescente `?temporada=2025` ao endereço.

Para ver o site no computador, é preciso um servidor local. Abrindo o arquivo direto, o navegador bloqueia a leitura dos JSON e o site mostra uma mensagem de erro.
