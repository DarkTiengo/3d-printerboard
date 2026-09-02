# 3D Printerboard

Gerenciador de fazenda de impressão 3D: monitora e opera 5–10 impressoras
Klipper/Moonraker por uma tela só — parede de câmeras ao vivo, controle de
impressão, biblioteca de G-code com fila, alertas e **backup automático das
configurações de cada máquina**, que o Moonraker não faz.

Roda como um container só. O mesmo processo serve a API e o front, e mantém
uma conexão WebSocket persistente com cada host Moonraker.

## Subir

```bash
cp .env.example .env
# defina ADMIN_PASSWORD e gere o JWT_SECRET:
openssl rand -hex 32

mkdir -p data                 # precisa existir e ser sua, veja PUID/PGID no .env
docker compose up --build -d
```

Acesse `http://localhost:8080` e entre com o `ADMIN_USER`/`ADMIN_PASSWORD` do
`.env`. O primeiro admin só é criado no primeiro boot; depois disso mude a senha
pelo app — editar o `.env` não tem efeito.

Deixe `NETWORK_MODE=host` se as impressoras forem acessadas por nome `.local`:
no modo bridge o container não faz mDNS.

### Sem hardware

```bash
MOCK_PRINTERS=true docker compose up
```

Sobe as oito impressoras do design em estados diferentes (imprimindo, ociosa,
pausada, atenção), com câmeras sintéticas, arquivos e backups funcionais. Dá
para percorrer as sete telas inteiras antes de cadastrar a fazenda de verdade.

## Cadastrar as impressoras

Botão de ajustes na barra superior (só admin) → **+**. Para cada máquina:

| Campo | Exemplo |
| --- | --- |
| URL do Moonraker | `http://ender-a.local:7125` |
| API key | em branco, a menos que o Moonraker exija |
| URL da câmera | `http://ender-a.local/webcam/?action=stream` |

O botão de tomada testa a conexão antes de salvar.

## Telas

**Painel** — parede de câmeras + mini painel da impressora selecionada
(trabalho, temperaturas, jog, macros) ou a fila, quando nada está selecionado.
**Câmeras** — quadrante 2×2 com controles e tira de miniaturas.
**Arquivos** — biblioteca de G-code da fazenda inteira; um clique manda para a fila.
**Backups** — estado por máquina, backup manual e restauração.
**Alertas** — lista por severidade com o frame da câmera no momento do alerta.
**Gestão** — CRUD das impressoras.

## Papéis

| | leitura | operador | admin |
| --- | --- | --- | --- |
| Ver tudo | ✓ | ✓ | ✓ |
| Pausar/continuar/cancelar, parada de emergência, fila | | ✓ | ✓ |
| Rodar backup | | ✓ | ✓ |
| Restaurar backup, gerir impressoras e usuários | | | ✓ |

Checado no servidor; o front só reflete desabilitando os botões.

## Backup

Roda todo dia às 03:00 (`BACKUP_CRON`), só pela API HTTP do Moonraker — sem SSH,
sem credenciais do sistema operacional. Cobre as três linhas do card:

- **perfis** — `printer.cfg`, macros e o resto do root `config`, mais um dump do
  banco do Moonraker (perfis de fatiamento do Mainsail/Fluidd)
- **firmware/calibração** — `machine.system_info` e `machine.update.status`
- **G-code** — o root `gcodes`

Cada ciclo vira `data/backups/<impressora>/<timestamp>.tar.gz` com um
`manifest.json`. Os G-code vão para um store endereçado por hash em
`data/blobs/`: oito máquinas imprimem em boa parte os mesmos arquivos, e sem a
deduplicação a retenção de 7 dias encheria o disco.

### Só copia impressora ociosa

**Nenhum backup roda numa máquina que está trabalhando** — vale para o ciclo
agendado, para o botão manual e para a recuperação. Puxar um gigabyte de G-code
do Raspberry Pi no meio de uma peça disputa CPU e rede com o Klipper, e o preço
é stutter na impressão.

Quem não está ociosa não é recusada: entra numa fila e é copiada assim que a
impressão terminar. Ociosa significa ociosa mesmo — pausada, em atenção e
offline também esperam. O card mostra `NA FILA — AGUARDANDO FICAR OCIOSA` e o
botão de backup manual responde dizendo que vai rodar depois.

Se uma impressora nunca abre uma janela ociosa, isso não fica em silêncio: depois
de dois intervalos na fila, um alerta de severidade média avisa.

### Recuperação ao religar

O ciclo agendado só alcança quem estava ligado na hora, e numa fazenda caseira as
máquinas passam dias desligadas. Por isso, **toda vez que uma impressora reaparece
na rede o sistema confere o último backup dela**: se já passou de
`BACKUP_INTERVALO_HORAS` (24 h por padrão), ela entra na fila — e é copiada assim
que estiver ociosa, com um alerta de severidade baixa registrando que tinha ficado
para trás. Antes de perguntar qualquer coisa, espera o Klipper terminar de subir.

Quando a fazenda inteira religa junto, os backups saem um de cada vez.

### Restauração

Sobrescreve a configuração da máquina de destino — pode ser outra impressora, que
é como se clona a máquina que está funcionando. Exige papel admin e confirmação.

## Câmeras

Uma conexão upstream por câmera no servidor, com fan-out para todos os
espectadores — o host da câmera vê uma conexão, não uma por aba aberta.

No navegador, quase tudo é **snapshot por polling**, não MJPEG: o HTTP/1.1
limita a 6 conexões por origem, e um stream por tile consumiria todas, deixando
o SSE e a própria API na fila. Fica ao vivo só o feed em foco (o mini painel, ou
o primeiro quadrante da tela de Câmeras).

## Desenvolvimento

```bash
npm install
npm run build -w @3dfarm/shared          # o resto depende do dist dele
MOCK_PRINTERS=true npm run dev:server    # API em :8080
npm run dev:web                          # Vite em :5173, com proxy para a API

npm test         # Vitest: normalizador, motor de fila, demux MJPEG, formatadores
npm run typecheck
```

```
packages/shared   tipos e formatadores usados pelos dois lados
apps/server       Fastify, SQLite, clientes Moonraker, backup, fila, alertas
apps/web          React + Vite, telas e componentes
design/           o pacote de design — README.md é a fonte da verdade visual
```

O `design/README.md` traz as medidas, cores e estados finais de cada tela;
consulte a cada mudança de UI.
