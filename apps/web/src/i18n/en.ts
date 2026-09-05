import type { Dicionario } from './pt';

/** English. Same shape as `pt`, checked by the compiler. */
export const en: Dicionario = {
  idioma: { nome: 'English', codigo: 'EN', trocar: 'Change language' },

  comum: {
    cancelar: 'Cancel',
    confirmar: 'Confirm',
    salvar: 'Save',
    salvando: 'Saving…',
    editar: 'Edit',
    entendi: 'Got it',
    voltar: 'Go back',
    carregando: 'LOADING…',
    sair: 'Sign out',
    semPermissao: 'no permission'
  },

  status: {
    imprimindo: 'PRINTING',
    pausada: 'PAUSED',
    cancelada: 'CANCELLED',
    ociosa: 'IDLE',
    atencao: 'ATTENTION',
    offline: 'OFFLINE'
  },

  login: {
    chamada: 'The whole farm on one screen.',
    subChamada:
      'Live cameras, print control, a G-code library and a daily backup of every machine’s configuration.',
    kicker: 'SERVER ACCESS',
    titulo: 'Sign in',
    usuario: 'USERNAME',
    usuarioPlaceholder: 'operator',
    senha: 'PASSWORD',
    manterConectado: 'Keep me signed in',
    esqueciSenha: 'Forgot password',
    entrar: 'Sign in',
    entrando: 'Signing in…',
    informeUsuario: 'Enter your username.',
    informeSenha: 'Enter your password.',
    credenciaisInvalidas: 'Wrong username or password.',
    servidorMudo: 'The server did not answer. Check whether the container is still running.',
    naoFoiPossivel: 'Could not sign in.',
    verificando: 'checking server…',
    respondendo: 'server responding',
    foraDoAr: 'server unreachable',
    impressoras: 'PRINTERS',
    arquivos: 'FILES',
    ultimoBackup: 'LAST BACKUP'
  },

  barra: {
    painel: 'Dashboard',
    cameras: 'Cameras',
    arquivos: 'Files',
    backups: 'Backups',
    alertas: 'Alerts',
    gerir: 'Manage printers',
    sairCom: (u: string) => `Sign out (${u})`,
    paradaEmergencia: 'Emergency stop',
    paradaSemPermissao: 'Emergency stop (no permission)',
    resumo: (a: number, f: number, at: number) => `${a} active · queue ${f} · ${at} attention`,
    alertas_n: (n: number) => ` · ${n} ${n === 1 ? 'alert' : 'alerts'}`,
    criticos_n: (n: number) => `${n} CRITICAL`,
    verCriticos: 'See the critical alerts',
    semConexao: ' · DISCONNECTED',
    pararTudo: 'Stop everything',
    confirmaParada: (n: number) =>
      `This shuts down heaters and motors on all ${n} printers immediately. Prints in progress will be lost and each machine will need a FIRMWARE_RESTART to come back.`,
    paradaEnviada: (n: number) => `Emergency stop sent to ${n} printers.`,
    paradaFalhou: (ids: string) => `Stop sent, but it failed on: ${ids}. Check those machines physically.`,
    paradaErro: 'Could not send the emergency stop.'
  },

  painel: {
    semImpressoras: 'NO PRINTERS REGISTERED',
    semImpressorasTexto: 'Add your first Moonraker host and the camera wall shows up here.',
    cadastrar: 'Add a printer',
    selecionar: (nome: string, status: string, pct: number) => `Select ${nome} — ${status}, ${pct}%`,
    expandir: (nome: string) => `Open ${nome} full screen`,
    cameraDe: (nome: string) => `${nome} camera`
  },

  fila: {
    titulo: (n: number) => `QUEUE — ${n} ${n === 1 ? 'JOB' : 'JOBS'}`,
    vazia: 'QUEUE IS EMPTY. SEND A FILE FROM THE FILES TAB.',
    dica: 'CLICK A CAMERA TO OPEN THAT PRINTER’S CONTROL PANEL.',
    proximaLivre: 'next free',
    tirarDaFila: (arquivo: string) => `Remove ${arquivo} from the queue`,
    estados: {
      pendente: 'PENDING',
      atribuido: 'ASSIGNED',
      imprimindo: 'PRINTING',
      concluido: 'DONE',
      falhou: 'FAILED',
      cancelado: 'CANCELLED'
    }
  },

  impressora: {
    maquina: 'MACHINE',
    reiniciar: 'Reboot the printer host',
    desligar: 'Shut down the printer host',
    reiniciarSemPermissao: 'Reboot the host (no permission)',
    desligarSemPermissao: 'Shut down the host (no permission)',
    reiniciarCurto: 'Reboot',
    desligarCurto: 'Shut down',
    confirmaReiniciar: (nome: string, imprimindo: boolean) =>
      `Reboots the computer running Klipper and Moonraker on ${nome}. The machine drops off the dashboard for about a minute and comes back on its own.${
        imprimindo ? ' The print in progress will be lost.' : ''
      }`,
    confirmaDesligar: (nome: string, imprimindo: boolean) =>
      `Shuts down the computer running Klipper and Moonraker on ${nome}. It only comes back if someone powers the machine on in person.${
        imprimindo ? ' The print in progress will be lost.' : ''
      }`,
    falhaEnergia: 'The command could not be sent.',
    fechar: 'Close panel',
    trabalho: 'JOB',
    camada: (c: string) => `LAYER ${c}`,
    pausar: 'Pause print',
    continuar: 'Resume print',
    cancelar: 'Cancel print',
    confirmaCancelar: (nome: string, job: string, pct: number) =>
      `Stops ${job} on ${nome}, now at ${pct}%. There is no resuming from where it stopped: the part is lost and the print starts over.`,
    excluirPeca: 'Exclude this object from the print',
    excluirPecaCurto: 'Exclude object',
    confirmaExcluirPeca: (peca: string) =>
      `Drops ${peca} from this print. The nozzle stops going over it and the other objects on the bed carry on. There is no bringing it back — and if it was the last one left, the print ends.`,
    temperaturas: 'TEMPERATURES',
    bico: 'Nozzle',
    mesa: 'Bed',
    alvoDe: (nome: string) => `${nome} target in degrees Celsius`,
    faixa: (min: number, max: number) => `between ${min} and ${max} °C`,
    desligarAquecedores: 'Turn all heaters off',
    confirmaDesligarAquecedores: (nome: string, imprimindo: boolean) =>
      `Zeroes the target of every heater on ${nome} at once — nozzle, bed and anything else that heats.${
        imprimindo ? ' The print in progress keeps running with a cold nozzle and will be lost.' : ''
      }`,
    falhaAlvo: 'Could not change the target.',
    cabeca: 'PRINT HEAD',
    passo: 'STEP (MM)',
    passoGrupo: 'Jog step in millimetres',
    moverYTras: 'Move Y back',
    moverYFrente: 'Move Y forward',
    moverXEsq: 'Move X left',
    moverXDir: 'Move X right',
    subirZ: 'Raise Z',
    descerZ: 'Lower Z',
    home: 'Home all axes',
    posicaoDesconhecida: 'POSITION UNKNOWN',
    macros: 'MACROS',
    fila: 'THIS PRINTER’S QUEUE',
    filaVazia: 'nothing queued for this machine',
    daFazenda: 'farm-wide',
    iniciar: (arquivo: string) => `Authorise and start ${arquivo}`,
    iniciarOcupada: 'the printer must be idle to start',
    iniciando: 'Starting…',
    aguardandoAutorizacao: 'WAITING FOR AUTHORISATION',
    concluida: 'LAST PART CAME OUT WHOLE',
    reimprimir: (arquivo: string) => `Reprint ${arquivo}`,
    retirarPeca: 'Take the part off the bed before starting the next one.',
    falhaIniciar: 'Could not start.'
  },

  cameras: {
    nenhuma: 'NO CAMERA AVAILABLE',
    verNoQuadrante: (nome: string) => `Show ${nome} in the quadrant`,
    semSinal: 'NO SIGNAL',
    semCamera: 'NO CAMERA'
  },

  arquivos: {
    biblioteca: (n: number) => `LIBRARY — ${n} FILES`,
    agrupadoPor: 'GROUPED BY PRINTER',
    destinoGrupo: 'the printer of the group',
    semArquivos: 'no G-code on this printer',
    impressoraOffline: 'printer offline — cannot list',
    recolher: (nome: string) => `Collapse ${nome}`,
    expandir: (nome: string) => `Expand ${nome}`,
    contagem: (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`,
    enviarPara: 'SEND TO',
    carregando: 'LOADING LIBRARY…',
    erro: 'COULD NOT LIST THE FILES.',
    vazio: 'NO G-CODE FOUND ON THE FARM’S PRINTERS.',
    enfileirar: (nome: string) => `Send ${nome} to the queue`,
    enfileirarSemPermissao: 'Send to queue (no permission)',
    previaDe: (nome: string) => `Preview of ${nome}`,
    enviado: (arquivo: string, destino: string) => `${arquivo} sent to the queue (${destino}).`,
    falhaEnfileirar: 'Could not queue the file.'
  },

  backups: {
    rotina: 'SCHEDULE',
    ultimoCiclo: 'LAST RUN',
    armazenado: 'STORED',
    falhas: 'FAILURES',
    diario: (hora: string) => `daily ${hora} · and on reconnect`,
    nunca: 'never',
    rodarTodas: 'Back up the whole farm now',
    rodarSemPermissao: 'Back up now (no permission)',
    rodarUma: (nome: string) => `Back up ${nome} now`,
    restaurarDe: (nome: string) => `Restore a ${nome} backup onto another printer`,
    perfis: 'PROFILES',
    firmware: 'FIRMWARE/CALIB.',
    gcode: 'G-CODE',
    naFila: 'QUEUED — WAITING FOR THE PRINTER TO GO IDLE',
    estados: { OK: 'OK', PARCIAL: 'PARTIAL', FALHOU: 'FAILED', NUNCA: 'NEVER' },
    resultado: (iniciados: number, adiados: number, offline: number) => {
      const partes = [`${iniciados} running`];
      if (adiados > 0) partes.push(`${adiados} printing (will be copied once idle)`);
      if (offline > 0) partes.push(`${offline} offline`);
      return `Backup: ${partes.join(' · ')}.`;
    },
    adiado: (nome: string) => `${nome} is printing — the backup will run as soon as it goes idle.`,
    iniciado: (nome: string) => `Backup of ${nome} started.`,
    falha: 'Could not start the backup.',
    restaurarTitulo: 'RESTORE CONFIGURATION',
    snapshotOrigem: 'SOURCE SNAPSHOT',
    semSnapshot: 'no snapshot stored',
    destino: 'TARGET PRINTER',
    mesmaMaquina: ' (same machine)',
    restaurar: 'Restore',
    restaurando: 'Restoring…',
    confirmaTitulo: 'Overwrite configuration',
    confirmaTexto: (nome: string) =>
      `The configuration files on ${nome} will be replaced by the ones in the chosen snapshot. Anything there now that is not in the backup is lost. The machine needs a FIRMWARE_RESTART afterwards.`,
    sobrescrever: 'Overwrite',
    restaurado: (n: number) => `Restore finished: ${n} configuration files sent.`,
    falhaRestaurar: 'Restore failed.',
    plano: 'PLAN',
    resumoPlano: (secoes: string, horas: number, copias: number) =>
      `${secoes} · ${horas} h · ${copias} copies`,
    semSecao: 'nothing selected',
    secoes: {
      config: 'Configuration (printer.cfg, macros)',
      banco: 'Mainsail/Fluidd profiles',
      sistema: 'Firmware and calibration',
      gcode: 'G-code library'
    },
    secoesCurtas: { config: 'config', banco: 'profiles', sistema: 'firmware', gcode: 'G-code' },
    configurar: (nome: string) => `Configure the backup of ${nome}`,
    configTitulo: 'BACKUP SETTINGS',
    oQueCopiar: 'WHAT TO BACK UP',
    arquivosDeConfig: 'CONFIGURATION FILES',
    arquivosDica: 'Uncheck what should stay out. A new file on the printer is included on its own.',
    arquivosOffline: 'The printer has to be on the network to list its files.',
    arquivosVazio: 'No configuration files on the printer.',
    intervalo: 'EVERY HOW MANY HOURS',
    retencaoLabel: 'COPIES KEPT',
    padraoGlobal: (v: number) => `default (${v})`,
    retencaoAviso: (n: number) =>
      n === 1
        ? 'Keeps only the most recent copy; older ones are deleted.'
        : `Keeps the ${n} most recent; older ones are deleted.`,
    salvar: 'Save',
    salvando: 'Saving…',
    salvo: (nome: string) => `Backup settings for ${nome} saved.`,
    falhaSalvar: 'Could not save the settings.',
    copias: (nome: string) => `Stored copies of ${nome}`,
    copiasTitulo: 'STORED COPIES',
    copiasVazio: 'No copies stored yet.',
    baixar: 'Download .zip',
    baixarComGcode: 'Download with the G-code',
    comGcode: (n: number) => `+ ${n} G-code`,
    fechar: 'Close'
  },

  alertas: {
    carregando: 'LOADING…',
    nenhum: 'NO OPEN ALERTS.',
    selecione: 'PICK AN ALERT ON THE LEFT.',
    severidade: (s: string) => `${s.toUpperCase()} SEVERITY`,
    sevNomes: { critica: 'critical', alta: 'high', media: 'medium', baixa: 'low' },
    resolver: 'Mark alert as resolved',
    resolverSemPermissao: 'Resolve alert (no permission)',
    abrirImpressora: 'Open the printer on the dashboard',
    semImagem: 'NO IMAGE FROM THAT MOMENT',
    frameDe: (nome: string) => `Camera image at the moment of the alert on ${nome}`,
    critico: 'CRITICAL',
    bannerCritico: 'THE MACHINE IS HALTED — ACT NOW',
    titulos: {
      klipper_parado: 'Klipper halted',
      erro_impressao: 'Print stopped by an error',
      impressora_offline: 'Printer unreachable',
      impressao_concluida: 'Print finished',
      impressao_pausada: 'Print paused',
      filamento_acabando: 'Filament running out',
      camera_offline: 'Camera offline',
      camera_muda: 'Camera stopped responding',
      backup_falhou: 'Backup failed',
      backup_recuperacao: 'Catch-up backup ran',
      backup_esperando: 'Backup waiting for the printer to go idle'
    } as Record<string, string>
  },

  notificacoes: {
    titulo: 'NOTIFICATIONS',
    subtitulo: 'Telegram',
    configurar: 'Configure notifications',
    ligadas: 'on',
    desligadas: 'off',
    semToken: 'no bot token',
    paraChat: (c: string) => `to chat ${c}`,
    ultimoEnvio: (q: string) => `last sent ${q}`,
    nenhumEnvio: 'nothing sent yet',
    ultimaFalha: (m: string) => `last failure: ${m}`,
    ligar: 'Send alerts to Telegram',
    token: 'BOT TOKEN',
    tokenDica: 'Create the bot with @BotFather. The token never leaves the server.',
    tokenGuardado: 'stored — leave it alone to keep it',
    chat: 'CHAT',
    chatDica: 'Message the bot and read chat.id from /getUpdates. A group starts with -100.',
    quais: 'WHAT TO SEND',
    resolucao: 'Also say when an alert clears itself',
    comandos: 'Answer /status in the chat',
    comandosDica: 'Only the chat above is answered. Read-only: pausing or cancelling still means opening the app.',
    idioma: 'Messages go out in Portuguese — the language the server writes alerts in.',
    testar: 'Send a test',
    testando: 'Sending…',
    testeOk: 'message sent',
    salvar: 'Save',
    salvando: 'Saving…',
    salvo: 'Notifications saved.',
    falhaSalvar: 'Could not save.',
    semPermissao: 'Only an admin configures notifications.'
  },
  gestao: {
    titulo: (n: number) => `FARM PRINTERS — ${n}`,
    nova: 'Add a new printer',
    vazio: 'No printers registered yet. Add each machine’s Moonraker address — usually',
    camera: 'CAMERA',
    semCamera: 'not configured',
    backupLigado: 'on',
    backupDesligado: 'off',
    backup: 'BACKUP',
    chave: 'KEY',
    chaveDefinida: 'set',
    chaveNenhuma: 'none',
    remover: (nome: string) => `Remove ${nome} from the farm`,
    removerTitulo: 'Remove printer',
    removerTexto: (nome: string) =>
      `${nome} leaves the dashboard, the camera wall and the backup cycle. Snapshots already stored for this machine are deleted too. The printer itself is not touched.`,
    editando: (id: string) => `EDITING ${id}`,
    novaKicker: 'NEW PRINTER',
    cadastrar: 'Add printer',
    nome: 'NAME',
    nomePlaceholder: 'Ender 3 V2 — A',
    url: 'MOONRAKER URL',
    urlPlaceholder: 'http://ender-a.local:7125',
    urlDica: 'Accepts a .local name (mDNS) or an IP. Moonraker’s default port is 7125.',
    apiKey: 'API KEY (OPTIONAL)',
    apiKeyPlaceholder: 'leave blank unless Moonraker requires one',
    cameraUrl: 'CAMERA URL (OPTIONAL)',
    cameraPlaceholder: 'detected automatically when you test the connection',
    incluirBackup: 'Include in the daily backup',
    testar: 'Test connection',
    testando: 'Testing…',
    testeOk: (host: string, versao: string) => `Connected to ${host}, running ${versao}.`,
    testeCameraOk: ' The camera answered.',
    testeCameraFalhou: (erro: string) => ` The printer answered, but the camera did not: ${erro}`,
    testeFalhou: (erro: string) => `Not connected: ${erro}`,
    testeErro: 'Test failed.',
    naoSalvou: 'Could not save.',
    cameraDescoberta: (nome: string) => `Camera detected automatically (${nome}).`,
    cameraSemDeteccao: ' No camera detected — you can fill the URL in by hand.',
    previaCamera: 'Camera preview'
  },

  erros: {
    semServidor: 'Could not reach the server.',
    generico: (n: number) => `Error ${n}`
  }
};
