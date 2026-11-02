# Estatísticas do Esporte Clube Bahia

Site com os jogos e as estatísticas do Bahia, publicado no GitHub Pages.

O site não tem servidor nem banco de dados. Os jogos ficam em arquivos JSON neste repositório, um robô mantém esses arquivos em dia e a página calcula os números na hora em que é aberta.

## Como funciona

1. O robô em Node.js roda no GitHub Actions e consulta a API-Football.
2. Se algum dado mudou, ele grava os arquivos em `dados/` e envia para o repositório.
3. O `index.html` lê os JSON e calcula vitórias, empates, derrotas e aproveitamento.

## Estrutura de pastas

```text
.
├── .github/
│   └── workflows/         Agendamento do robô no GitHub Actions
├── dados/
│   ├── indice.json        Temporadas existentes e data da última atualização
│   └── jogos/
│       └── ANO.json       Jogos de uma temporada (exemplo: 2026.json)
├── scripts/               Robô de atualização e importação do histórico
├── index.html             O site (será criado em etapa futura)
└── README.md
```

As pastas `dados/jogos`, `scripts` e `.github/workflows` têm um arquivo `.gitkeep` porque o Git não guarda pastas vazias. Ele pode ser apagado quando a pasta receber seu primeiro arquivo.

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
| `gols_mandante` | número ou `null` | Gols do mandante. Fica `null` enquanto o jogo não começa. |
| `gols_visitante` | número ou `null` | Gols do visitante. Fica `null` enquanto o jogo não começa. |
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
