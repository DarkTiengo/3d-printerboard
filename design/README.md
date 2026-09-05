# Handoff: 3D Printerboard — gerenciador de fazenda de impressão 3D

## Visão geral

Aplicação web de servidor para monitorar e operar uma fazenda caseira de 5–10 impressoras 3D.
Cinco áreas: **Painel** (parede de câmeras + mini painel de controle da impressora selecionada),
**Câmeras** (quadrante grande + tira de miniaturas), **Arquivos** (biblioteca de G-code),
**Backups** (perfis, firmware/calibração e G-code por impressora) e **Alertas** (lista + detalhe).
Antes de tudo, uma **tela de login** que também coleta o endereço do servidor.

Alvo combinado: **React**. O backend pode ser Moonraker direto (Klipper) ou uma API própria
agregando vários hosts — ver "Camada de dados".

## Sobre os arquivos deste pacote

Os arquivos HTML aqui são **referências de design**, não código de produção. Eles mostram
aparência e comportamento pretendidos. A tarefa é **recriar esses designs em React**, com os
padrões e bibliotecas do seu projeto — não portar o HTML como está.

O protótipo usa um runtime de template próprio (`support.js`, tags `<sc-for>`/`<sc-if>`,
`renderVals()`). Nada disso deve ir para produção; leia-o como JSX equivalente:
`<sc-for list={items} as="p">` = `items.map(p => …)`, `<sc-if value={x}>` = `{x && …}`,
e a classe `Component` é o estado do componente.

## Fidelidade

**Alta fidelidade.** Cores, tipografia, espaçamentos e estados são finais e devem ser
reproduzidos fielmente. Os feeds de câmera e miniaturas de peça são placeholders listrados —
substituir por `<img>`/`<video>` reais mantendo as mesmas proporções.

---

## Sistema visual (design system Modernist, tema escuro)

O design segue o design system **Modernist**, invertido para fundo escuro.

### Cores (hex resolvido)

| Token | Hex | Uso |
| --- | --- | --- |
| `--color-text` | `#201e1d` | fundo da aplicação (papel invertido) |
| `--color-bg` | `#f3f2f2` | texto principal e ícones |
| `--color-accent` | `#ec3013` | ação primária, status "imprimindo", barra de progresso, seleção |
| `--color-accent-400` | tom claro do vermelho | hover das ações primárias |
| `--color-accent-700` | tom escuro do vermelho | status "atenção", severidade média |
| `--color-neutral-300` | | texto secundário sobre escuro |
| `--color-neutral-400` | | rótulos mono, metadados |
| `--color-neutral-500` | | texto de apoio fraco |
| `--color-neutral-600` | | bordas de botão, severidade baixa |
| `--color-neutral-700` | | divisores fortes (2px), bordas de painel |
| `--color-neutral-800` | | divisores fracos (1px), trilho de progresso |
| `--color-neutral-900` | | fundo de hover / linha selecionada |

Os valores exatos das rampas estão em `_ds/modernist-*/styles.css` (variáveis CSS, geradas em OKLCH).
Recomendado: importar esse arquivo de tokens no projeto React em vez de recopiar hex.

### Tipografia

- Títulos e rótulos de UI: **Archivo**, peso 800 (`--font-heading`).
- Corpo: **Archivo** (`--font-body`).
- Dados técnicos, rótulos em caixa alta, tempos e temperaturas: **fonte monoespaçada do sistema**
  (`ui-monospace, monospace`), `letter-spacing: .06em` nos rótulos de seção em caixa alta.
- Escala usada: 10px (rótulo mono), 11–12px (metadados), 13–15px (corpo/UI), 17–22px (títulos de
  painel), 26–34px (números grandes e título do login), 64px (chamada do login).

### Estrutura

- Divisores **2px** `--color-neutral-700` entre áreas maiores; **1px** `--color-neutral-800` entre linhas.
- Grades com `gap: 2px` sobre fundo escuro para a parede de câmeras (a "junta" faz o papel de linha).
- Tudo alinhado à esquerda. Sem sombras.
- **Exceção deliberada ao Modernist:** os botões são arredondados a pedido do cliente
  (`border-radius: 999px` em botões e pílulas, `10px` em campos de formulário, `8px` no jog pad).
  O restante do sistema mantém raio 0 (painéis, cards, tags, feeds).

### Ícones

**Lucide** (https://lucide.dev), traço 2px, `stroke-linecap/linejoin: round`, tamanho 13–19px.
Em React usar `lucide-react`. Mapa dos ícones usados:

| Onde | Ícone Lucide |
| --- | --- |
| Aba Painel | `layout-grid` |
| Aba Câmeras / "abrir impressora" | `video` |
| Aba Arquivos | `file-text` |
| Aba Backups | `archive` |
| Aba Alertas | `clock` |
| Parada de emergência | `octagon-x` |
| Pausar / Continuar | `pause` / `play` |
| Cancelar / fechar | `x` |
| Peças da mesa / excluir peça | `package-x` |
| Expandir (canto do tile) | `maximize-2` |
| Fila | `menu` |
| Temperatura | `thermometer` |
| Jog X/Y/Z | `arrow-up`, `arrow-down`, `arrow-left`, `arrow-right`, `move-vertical` |
| Home | `house` |
| Macro | `zap` |
| Backup agora / restaurar | `download` / `upload` |
| Resolver alerta | `check` |

### Botões com dica em vez de rótulo

A maioria das ações é **só ícone**, com o texto aparecendo como tooltip no hover
(`title` no protótipo). Em React, trocar por um componente de tooltip acessível
(Radix Tooltip ou equivalente) e **manter sempre `aria-label` com o mesmo texto**.

Formatos:
- Ação primária redonda: 40×40px, fundo `--color-accent`, ícone 16–19px, hover `--color-accent-400`.
- Ação secundária redonda: 36–40px, borda 1px `--color-neutral-700`, fundo transparente, hover `--color-neutral-900`.
- Controle de impressão: pílula `flex: 1`, altura 34px, ícone centralizado.
- Pílulas de macro e de passo: texto mono 10–11px, padding 7–9px × 12px.

---

## Telas

### 1. Login

**Objetivo:** autenticar o operador e apontar o app para o servidor da fazenda.

**Layout:** duas colunas em `100vh`.
- **Esquerda (flex: 1)**, borda direita 2px, padding 56px, fundo listrado a 45° (`#2b2928`/`#232120`,
  faixas de 10px) — placeholder de foto; em produção, uma fotografia em preto e branco (wrapper `.grayscale`).
  Três blocos empilhados com `space-between`: marca (quadrado vermelho 12px + "3D PRINTERBOARD" 20px/800);
  chamada `h1` 64px, `line-height: 1.02`, `letter-spacing: -.02em`, máx. 620px, com parágrafo 16px
  `--color-neutral-300` de até 480px; e uma faixa de três números (rótulo mono 10px + valor 26px/800)
  em células de `gap: 2px` sobre `--color-neutral-700`, borda 2px.
- **Direita (520px fixo)**, padding 56px/64px, conteúdo centralizado verticalmente, `gap: 28px`:
  kicker "ACESSO AO SERVIDOR", título "Entrar" 34px/800; três campos (Usuário, Senha, Endereço do
  servidor — este em fonte mono), cada um com rótulo mono 10px acima; linha com checkbox
  "Manter conectado" e link "Esqueci a senha"; botão Entrar em pílula, largura total, 15px/800,
  padding 15×20px, com seta à direita; rodapé com ponto vermelho 7px e status do servidor em mono 11px.

**Campos:** fundo transparente, borda 1px `--color-neutral-700`, raio 10px, padding 13×14px, 15px.
Foco: borda `--color-accent` (em produção acrescentar `outline: 2px solid var(--color-accent);
outline-offset: 2px` no `:focus-visible`).

**Checkbox:** quadrado 18px, raio 5px; marcado = fundo vermelho + `check` branco 12px; desmarcado =
borda 1px `--color-neutral-600`.

**Comportamento no protótipo:** "Entrar" apenas troca de tela, sem validação. Em produção: validar
campos obrigatórios, mostrar erro de credencial e de servidor inacessível, estado de carregando no
botão e persistir sessão quando "manter conectado" estiver ligado.

### 2. Painel (tela inicial após o login)

**Barra superior** (altura ~72px, borda inferior 2px, padding 16×22px, `gap: 16px`, `flex-wrap`):
marca "3D PRINTERBOARD" 19px/800; cinco abas redondas 40×40px só com ícone (ativa = fundo vermelho, ícone
claro; inativa = transparente, ícone `--color-neutral-300`, hover `--color-neutral-900`); resumo em
mono 11px ("N ativas · fila 7 · N atenção"); botão redondo vermelho de **parada de emergência**.

**Corpo:** duas colunas.
- **Parede de câmeras (flex: 1)**, `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))`,
  `gap: 2px`, padding 2px. Cada tile: feed 4:3; canto superior esquerdo com ponto de status 7px + "CAM P01"
  em mono 10px; canto superior direito com `maximize-2`; rodapé com gradiente
  (`transparent → rgba(32,30,29,.92) 55%`) contendo nome 15px/800, porcentagem em mono e barra de
  progresso 3px (trilho `--color-neutral-800`, preenchimento vermelho).
  Clique seleciona a impressora; a selecionada recebe `outline: 2px solid var(--color-accent)` com
  `outline-offset: -2px`.
- **Coluna direita, 360px fixo**, borda esquerda 2px:
  - **Sem seleção:** cabeçalho "FILA — 7 TRABALHOS" com ícone `menu`, lista de trabalhos (nome do
    arquivo 13px/800 + "destino · tempo" em mono 10px, linhas separadas por 1px) e uma instrução em
    mono 10px `--color-neutral-500`.
  - **Com seleção — mini painel**, em seções separadas por 1px, de cima para baixo:
    1. Cabeçalho: ponto de status, nome, tag de status, botão fechar.
    2. Feed 16:10 com o nome da câmera.
    3. Trabalho: nome do arquivo em mono, barra 5px, linha "72% · CAMADA 84/210" e tempo restante,
       e os controles em pílula (pausar / continuar / cancelar). Numa máquina com
       `[exclude_object]`, e só enquanto o fatiador tiver rotulado as peças, aparece um quarto:
       `package-x`, que abre o **mapa da mesa** — diálogo com o desenho das peças no lugar onde
       elas estão (peça em curso em `--color-accent`, excluídas tracejadas em
       `--color-neutral-700`) e a lista ao lado, numerada igual ao mapa. Clicar numa peça, no
       desenho ou na lista, tira só ela da impressão; as outras seguem.
    4. Temperaturas: uma linha por sensor com ícone `thermometer` (`fan` nas ventoinhas
       por temperatura), na ordem bico → mesa → câmara → ventoinhas → sensores de leitura.
       Quem aquece mostra "atual / campo de alvo em °C" e o alvo é editável ali mesmo;
       quem só mede mostra a leitura, com o nome um tom abaixo (`--color-neutral-300`).
       No cabeçalho da seção, à direita, um botão `power` desliga todos os aquecedores.
    5. Cabeça de impressão: jog pad 3×3 (38×32px, raio 8px, borda 1px) com X±, Y±, Z± e home,
       seletor de passo (0.1 / 1 / 10 / 100 — ativo em pílula vermelha) e posição atual em mono.
    6. Macros: grade 2 colunas de pílulas com ícone `zap` vermelho.

**Regras dos controles:** *Pausar* habilitado quando imprimindo ou em atenção; *Continuar* apenas
quando pausada (é a única ação em vermelho); *Cancelar* quando imprimindo, em atenção ou pausada.
*Cancelar* e *excluir peça* perguntam antes — o clique não tem desfazer.
Desabilitado = borda `--color-neutral-800`, texto `--color-neutral-700`, `pointer-events: none`.

### 3. Câmeras

Quadrante 2×2 ocupando a altura disponível, `gap: 2px`. Sobre cada feed: nome da câmera com ponto de
status no topo; no rodapé, nome 17px/800 e "pct · restante" em mono, com os três controles redondos
à direita. Abaixo, tira horizontal rolável de miniaturas 150px (16:10), clicáveis, com a mesma
moldura vermelha de seleção.

### 4. Arquivos

Grade `repeat(auto-fill, minmax(280px, 1fr))`, `gap: 20px`, padding 22px. Card com borda 2px:
prévia 4:3 com legenda mono, nome 15px/800, perfil de fatiamento em mono 10px, linha de métricas
(tempo, filamento, nº de impressões) e botão redondo vermelho "Enviar para a fila".

### 5. Backups

Faixa superior com quatro números (rotina, último ciclo, armazenado, falhas — falhas em vermelho),
botão redondo "Backup agora" à direita, borda inferior 2px. Abaixo, grade
`repeat(auto-fill, minmax(340px, 1fr))`: card por impressora com nome, tag de estado
(OK / PARCIAL / FALHOU — não-OK em vermelho) e três linhas em mono (perfis, firmware/calibração,
G-code), mais dois botões redondos: backup agora e restaurar em outra impressora.

A última seção do mini painel é **MÁQUINA**: duas pílulas iguais às das macros — reiniciar e
desligar o host —, ícone em `--color-accent`, cada uma atrás de um `Confirm`. Fica no fim de
propósito: são as ações que tiram a impressora do ar e não devem dividir espaço com os controles
de impressão. Desabilitadas quando a máquina está fora do ar ou o papel não permite.

### 6. Alertas

Duas colunas. Esquerda 420px: lista com ponto de severidade 8px (crítica e alta = `--color-accent`,
média = `--color-accent-700`, baixa = `--color-neutral-600`), título 13px/800 e "quando · impressora"
em mono; item selecionado com fundo `--color-neutral-900`.

A severidade **crítica** divide o vermelho vivo com "alta" de propósito — o que a separa é
estrutura, não matiz, para o sinal mais forte da tela não depender de distinguir dois vermelhos:
barra de 4px `--color-accent` na borda esquerda da linha, fundo `--color-accent-900` quando não
selecionada, tag `CRÍTICO` em mono 9px sobre `--color-accent`, e faixa cheia no topo do detalhe.
A lista vem ordenada por gravidade e, dentro dela, pelo mais recente. Fora da tela de Alertas, a
barra superior mostra um contador de críticos em vermelho cheio que leva direto à lista. Direita: metadados em mono, título 28px/800,
descrição 14px `--color-neutral-300` (máx. 520px, `text-wrap: pretty`), frame 16:9 do momento do alerta
e dois botões redondos (resolver, abrir impressora).

---

## Estado

```ts
type Status = 'imprimindo' | 'pausada' | 'cancelada' | 'ociosa' | 'atenção';

type Printer = {
  id: string;          // 'P01'
  nome: string;        // 'Ender 3 V2 — A'
  job: string;         // 'suporte_camera_v3.gcode'
  pct: number;         // 0-100
  restante: string;    // '1h 14m'
  camada: string;      // '84/210'
  status: Status;
  // estado do firmware, separado do estado do trabalho: fora de 'ready' a
  // máquina não aceita comandos e os campos acima são o último valor conhecido
  klippy: 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected';
  mensagemKlippy: string | null;  // motivo cru do Klipper, quando há
};
```

Estado da UI: `auth`, `tela` ('dash' | 'cams' | 'files' | 'backup' | 'alerts'),
`sel` (id da impressora selecionada, ou null), `alerta` (índice do alerta aberto),
`passo` (passo do jog em mm), e overrides otimistas de status por impressora.

Transições: login → painel; clique no tile → `sel`; fechar → `sel = null`;
pausar/continuar/cancelar → muda o status daquela impressora (progresso vai a 0 quando cancelada
ou ociosa; "restante" vira "pausada"/"cancelada").

## Camada de dados (sugestão)

Cada impressora é um host Moonraker. Mapeamento direto:

- Status e progresso: `printer.objects.subscribe` via WebSocket (`print_stats`, `display_status`,
  `extruder`, `heater_bed`, `toolhead`).
- Controles: `printer.print.pause`, `printer.print.resume`, `printer.print.cancel`;
  parada de emergência: `printer.emergency_stop`.
- Jog e macros: `printer.gcode.script`.
- Arquivos: `server.files.list` (+ miniaturas embutidas no G-code) e `server.files.upload`.
- Alertas/histórico: `server.history.list` e notificações do WebSocket.
- Backups: não existe no Moonraker — precisa de um serviço próprio que copie `printer.cfg`, macros,
  perfis e G-code por host, com agendamento e restauração.

Como são vários hosts, o caminho recomendado é um **serviço agregador** que mantém as conexões
WebSocket, normaliza para o modelo `Printer` acima e expõe uma única API + um stream (SSE/WS) para o
front. A tela de login já pede o endereço desse serviço.

Atualização em tempo real: preferir push (WebSocket) a polling. Feeds de câmera como MJPEG
(`<img src="…/stream">`) ou WebRTC; na parede, considerar reduzir a taxa de quadros das câmeras
não selecionadas.

## Acessibilidade

- Todo botão só-ícone precisa de `aria-label` além do tooltip.
- Foco visível: `outline: 2px solid var(--color-accent); outline-offset: 2px` (nunca o anel padrão).
- Status nunca deve depender só da cor — o ponto vem sempre acompanhado do texto do status.
- Contraste: o vermelho sobre o fundo escuro serve para ícones e texto grande; para texto pequeno
  em vermelho, usar um passo mais claro da rampa.

## Responsivo

Desktop é o alvo principal; a parede de câmeras já é fluida (`auto-fill`). Em telas estreitas:
a coluna do mini painel deve virar um painel deslizante sobre a parede, e a barra superior
(que já quebra em linha) deve manter parada de emergência e resumo sempre visíveis.
Alvo de toque mínimo de 44px na versão celular.

## Ativos

Nenhuma imagem real. Placeholders no protótipo:
- Feeds e miniaturas de peça: listras a 45° `#3a3737`/`#302d2d` de 6px.
- Fundo do login: listras a 45° `#2b2928`/`#232120` de 10px.
Substituir por streams e fotos reais; fotografias em preto e branco, sem tingimento.

## Arquivos deste pacote

- `3D Printerboard.dc.html` — o design final (login + as cinco telas), com todos os estados interativos.
- `3D Printerboard opcoes.dc.html` — explorações anteriores de layout (rail lateral, painel estilo Mainsail).
- `ds-styles.css` — os tokens do Modernist (cores, rampas, tipografia, espaçamento).

Para ver o design rodando, abrir `3D Printerboard.dc.html` em um navegador.
