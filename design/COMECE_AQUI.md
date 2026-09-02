# Começando a programar — 3D Printerboard (React)

Leia \`README.md\` antes: ele tem o sistema visual, as seis telas com medidas e o mapeamento
para as APIs do Moonraker. Este arquivo é só o caminho prático do zero até a primeira tela rodando.

## O que tem no pacote

| Arquivo | Para que serve |
| --- | --- |
| \`README.md\` | Especificação de design completa — a fonte da verdade |
| \`3D Printerboard.dc.html\` | Design final rodando (login + 5 telas). Abra no navegador |
| \`3D Printerboard opcoes.dc.html\` | Explorações de layout descartadas, como referência |
| \`ds-styles.css\` | Tokens do design system Modernist (cores, rampas, tipografia, espaçamento) |
| \`support.js\` | Runtime do protótipo. **Não vai para produção** |

Os HTML são referência de design, não código de produção. Recrie em React.

## Stack sugerida

\`\`\`
Vite + React + TypeScript
lucide-react              ícones (o design usa Lucide)
@tanstack/react-query     dados do servidor
zustand                   estado de UI (tela ativa, impressora selecionada, passo do jog)
@radix-ui/react-tooltip   tooltips dos botões só-ícone
react-router-dom          rotas
\`\`\`

CSS: os tokens já são variáveis CSS. Importe \`ds-styles.css\` no \`main.tsx\` e escreva os estilos
com \`var(--color-*)\`. Se preferir Tailwind, exponha os tokens como cores customizadas em vez de
recriar a paleta.

## Passo a passo

1. \`npm create vite@latest printerboard -- --template react-ts\`
2. Copie \`ds-styles.css\` para \`src/styles/\` e importe em \`main.tsx\`.
3. Carregue Archivo (Google Fonts, pesos 400 e 800) no \`index.html\`.
4. Reset global: \`body { margin: 0; background: var(--color-text); color: var(--color-bg); font-family: var(--font-body); }\`
   — o app é tema escuro, então o papel e a tinta estão invertidos.
5. Construa \`<IconButton>\` primeiro (pílula, três variantes: primária, secundária, desabilitada;
   tooltip + \`aria-label\` obrigatórios). Quase toda ação do app passa por ele.
6. Faça a tela de **Login** com estado local — ela não depende de dados.
7. Faça o **Painel** com dados falsos (copie o array \`base\` do arquivo \`.dc.html\`, que já traz
   oito impressoras em estados diferentes: imprimindo, ociosa, pausada, atenção).
8. Só então ligue no backend. Enquanto não houver servidor, mantenha os dados falsos atrás de uma
   função \`getPrinters()\` — assim a troca é de uma linha.

## Ordem de implementação

1. \`IconButton\`, \`Tag\`, \`ProgressBar\` — os três se repetem em todas as telas
2. Login
3. Painel: parede de câmeras + seleção
4. Mini painel de controle (o mais denso: trabalho, temperaturas, jog, macros)
5. Câmeras, Arquivos, Alertas
6. Backups — deixe por último: é o único que precisa de serviço novo no backend

## Estrutura de pastas sugerida

\`\`\`
src/
  styles/ds-styles.css
  components/   IconButton, Tag, ProgressBar, CameraTile, Tooltip
  screens/      Login, Dashboard, Cameras, Files, Backups, Alerts
  panels/       PrinterPanel (mini dashboard), JogPad, TempList, MacroGrid
  data/         types.ts, mock.ts, moonraker.ts
  store/        ui.ts
\`\`\`

## Cuidados

- **Botões só-ícone precisam de \`aria-label\`** com o mesmo texto do tooltip. Sem isso o app fica
  inutilizável em leitor de tela.
- **Foco visível:** \`:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }\`.
  Nunca deixe o anel azul padrão.
- **Raio:** só botões, campos e o jog pad são arredondados. Painéis, cards, tags e feeds têm raio 0 —
  é uma decisão do design system, não descuido.
- **Câmeras:** oito streams MJPEG simultâneos derrubam a rede. Reduza a taxa de quadros das câmeras
  não selecionadas, ou carregue só as visíveis com \`IntersectionObserver\`.
- **Parada de emergência** deve pedir confirmação antes de disparar \`printer.emergency_stop\`.
- **Estado otimista:** ao pausar/cancelar, atualize a UI na hora e reconcilie quando o WebSocket
  confirmar — o Moonraker leva alguns segundos para refletir.
- **Backup** não existe no Moonraker. Precisa de um serviço seu copiando \`printer.cfg\`, macros,
  perfis e G-code por host, com agendamento e restauração.

## Usando com o Claude Code

Na raiz do projeto novo, com esta pasta acessível:

\`\`\`
Leia design_handoff_3d_printerboard/README.md e COMECE_AQUI.md.
Implemente a tela de login e o painel em React + TypeScript seguindo a especificação,
usando os tokens de ds-styles.css e ícones do lucide-react. Use dados falsos por enquanto.
\`\`\`

Peça uma tela por vez e confira contra o \`.dc.html\` aberto no navegador ao lado.
