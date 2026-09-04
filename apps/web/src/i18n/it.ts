import type { Dicionario } from './pt';

/** Italiano. Stessa forma di `pt`, verificata dal compilatore. */
export const it: Dicionario = {
  idioma: { nome: 'Italiano', codigo: 'IT', trocar: 'Cambia lingua' },

  comum: {
    cancelar: 'Annulla',
    confirmar: 'Conferma',
    salvar: 'Salva',
    salvando: 'Salvataggio…',
    editar: 'Modifica',
    entendi: 'Ho capito',
    carregando: 'CARICAMENTO…',
    sair: 'Esci',
    semPermissao: 'senza permesso'
  },

  status: {
    imprimindo: 'IN STAMPA',
    pausada: 'IN PAUSA',
    cancelada: 'ANNULLATA',
    ociosa: 'INATTIVA',
    atencao: 'ATTENZIONE',
    offline: 'NON IN LINEA'
  },

  login: {
    chamada: 'Tutta la farm su un solo schermo.',
    subChamada:
      'Telecamere dal vivo, controllo delle stampe, libreria dei file e backup quotidiano della configurazione di ogni macchina.',
    kicker: 'ACCESSO AL SERVER',
    titulo: 'Accedi',
    usuario: 'UTENTE',
    usuarioPlaceholder: 'operatore',
    senha: 'PASSWORD',
    manterConectado: 'Resta collegato',
    esqueciSenha: 'Password dimenticata',
    entrar: 'Accedi',
    entrando: 'Accesso…',
    informeUsuario: 'Inserisci il nome utente.',
    informeSenha: 'Inserisci la password.',
    credenciaisInvalidas: 'Nome utente o password errati.',
    servidorMudo: 'Il server non ha risposto. Controlla che il container sia ancora attivo.',
    naoFoiPossivel: 'Accesso non riuscito.',
    verificando: 'verifica del server…',
    respondendo: 'server attivo',
    foraDoAr: 'server irraggiungibile',
    impressoras: 'STAMPANTI',
    arquivos: 'FILE',
    ultimoBackup: 'ULTIMO BACKUP'
  },

  barra: {
    painel: 'Pannello',
    cameras: 'Telecamere',
    arquivos: 'File',
    backups: 'Backup',
    alertas: 'Avvisi',
    gerir: 'Gestisci le stampanti',
    sairCom: (u: string) => `Esci (${u})`,
    paradaEmergencia: 'Arresto di emergenza',
    paradaSemPermissao: 'Arresto di emergenza (senza permesso)',
    resumo: (a: number, f: number, at: number) => `${a} attive · coda ${f} · ${at} attenzione`,
    alertas_n: (n: number) => ` · ${n} ${n === 1 ? 'avviso' : 'avvisi'}`,
    criticos_n: (n: number) => `${n} ${n === 1 ? 'CRITICO' : 'CRITICI'}`,
    verCriticos: 'Vedi gli avvisi critici',
    semConexao: ' · NESSUNA CONNESSIONE',
    pararTudo: 'Ferma tutto',
    confirmaParada: (n: number) =>
      `Questo spegne subito riscaldatori e motori di tutte le ${n} stampanti. Le stampe in corso andranno perse e ogni macchina avrà bisogno di un FIRMWARE_RESTART per ripartire.`,
    paradaEnviada: (n: number) => `Arresto di emergenza inviato a ${n} stampanti.`,
    paradaFalhou: (ids: string) => `Arresto inviato, ma non riuscito su: ${ids}. Controlla quelle macchine di persona.`,
    paradaErro: 'Impossibile inviare l’arresto di emergenza.'
  },

  painel: {
    semImpressoras: 'NESSUNA STAMPANTE REGISTRATA',
    semImpressorasTexto: 'Aggiungi il primo host Moonraker e il muro di telecamere comparirà qui.',
    cadastrar: 'Aggiungi una stampante',
    selecionar: (nome: string, status: string, pct: number) => `Seleziona ${nome} — ${status}, ${pct}%`,
    expandir: (nome: string) => `Apri ${nome} a schermo intero`,
    cameraDe: (nome: string) => `Telecamera di ${nome}`
  },

  fila: {
    titulo: (n: number) => `CODA — ${n} ${n === 1 ? 'LAVORO' : 'LAVORI'}`,
    vazia: 'LA CODA È VUOTA. INVIA UN FILE DALLA SCHEDA FILE.',
    dica: 'CLICCA SU UNA TELECAMERA PER APRIRE IL PANNELLO DI QUELLA STAMPANTE.',
    proximaLivre: 'la prima libera',
    tirarDaFila: (arquivo: string) => `Togli ${arquivo} dalla coda`,
    estados: {
      pendente: 'IN ATTESA',
      atribuido: 'ASSEGNATO',
      imprimindo: 'IN STAMPA',
      concluido: 'COMPLETATO',
      falhou: 'FALLITO',
      cancelado: 'ANNULLATO'
    }
  },

  impressora: {
    maquina: 'MACCHINA',
    reiniciar: 'Riavviare l’host della stampante',
    desligar: 'Spegnere l’host della stampante',
    reiniciarSemPermissao: 'Riavviare l’host (senza permesso)',
    desligarSemPermissao: 'Spegnere l’host (senza permesso)',
    reiniciarCurto: 'Riavvia',
    desligarCurto: 'Spegni',
    confirmaReiniciar: (nome: string, imprimindo: boolean) =>
      `Riavvia il computer che esegue Klipper e Moonraker su ${nome}. La macchina sparisce dal pannello per circa un minuto e torna da sola.${
        imprimindo ? ' La stampa in corso andrà persa.' : ''
      }`,
    confirmaDesligar: (nome: string, imprimindo: boolean) =>
      `Spegne il computer che esegue Klipper e Moonraker su ${nome}. Torna solo se qualcuno accende la macchina di persona.${
        imprimindo ? ' La stampa in corso andrà persa.' : ''
      }`,
    falhaEnergia: 'Non è stato possibile inviare il comando.',
    fechar: 'Chiudi il pannello',
    trabalho: 'LAVORO',
    camada: (c: string) => `STRATO ${c}`,
    pausar: 'Metti in pausa la stampa',
    continuar: 'Riprendi la stampa',
    cancelar: 'Annulla la stampa',
    temperaturas: 'TEMPERATURE',
    bico: 'Ugello',
    mesa: 'Piano',
    cabeca: 'TESTA DI STAMPA',
    passo: 'PASSO (MM)',
    passoGrupo: 'Passo dello spostamento in millimetri',
    moverYTras: 'Sposta Y indietro',
    moverYFrente: 'Sposta Y in avanti',
    moverXEsq: 'Sposta X a sinistra',
    moverXDir: 'Sposta X a destra',
    subirZ: 'Alza Z',
    descerZ: 'Abbassa Z',
    home: 'Azzera tutti gli assi',
    posicaoDesconhecida: 'POSIZIONE SCONOSCIUTA',
    macros: 'MACRO',
    fila: 'CODA DI QUESTA STAMPANTE',
    filaVazia: 'niente in coda per questa macchina',
    daFazenda: 'della farm',
    iniciar: (arquivo: string) => `Autorizza e avvia ${arquivo}`,
    iniciarOcupada: 'la stampante deve essere inattiva per partire',
    iniciando: 'Avvio…',
    aguardandoAutorizacao: 'IN ATTESA DI AUTORIZZAZIONE',
    concluida: 'L’ULTIMO PEZZO È USCITO INTERO',
    reimprimir: (arquivo: string) => `Ristampa ${arquivo}`,
    retirarPeca: 'Togli il pezzo dal piano prima di avviare il prossimo.',
    falhaIniciar: 'Impossibile avviare.'
  },

  cameras: {
    nenhuma: 'NESSUNA TELECAMERA DISPONIBILE',
    verNoQuadrante: (nome: string) => `Mostra ${nome} nel quadrante`,
    semSinal: 'NESSUN SEGNALE',
    semCamera: 'NESSUNA TELECAMERA'
  },

  arquivos: {
    biblioteca: (n: number) => `LIBRERIA — ${n} FILE`,
    agrupadoPor: 'RAGGRUPPATO PER STAMPANTE',
    destinoGrupo: 'la stampante del gruppo',
    semArquivos: 'nessun G-code su questa stampante',
    impressoraOffline: 'stampante non in linea — impossibile elencare',
    recolher: (nome: string) => `Comprimi ${nome}`,
    expandir: (nome: string) => `Espandi ${nome}`,
    contagem: (n: number) => `${n} ${n === 1 ? 'file' : 'file'}`,
    enviarPara: 'INVIA A',
    carregando: 'CARICAMENTO DELLA LIBRERIA…',
    erro: 'IMPOSSIBILE ELENCARE I FILE.',
    vazio: 'NESSUN G-CODE TROVATO SULLE STAMPANTI DELLA FARM.',
    enfileirar: (nome: string) => `Manda ${nome} in coda`,
    enfileirarSemPermissao: 'Manda in coda (senza permesso)',
    previaDe: (nome: string) => `Anteprima di ${nome}`,
    enviado: (arquivo: string, destino: string) => `${arquivo} mandato in coda (${destino}).`,
    falhaEnfileirar: 'Impossibile mettere in coda.'
  },

  backups: {
    rotina: 'PIANIFICAZIONE',
    ultimoCiclo: 'ULTIMO CICLO',
    armazenado: 'ARCHIVIATO',
    falhas: 'ERRORI',
    diario: (hora: string) => `ogni giorno alle ${hora} · e alla riconnessione`,
    nunca: 'mai',
    rodarTodas: 'Fai il backup di tutta la farm adesso',
    rodarSemPermissao: 'Backup adesso (senza permesso)',
    rodarUma: (nome: string) => `Fai il backup di ${nome} adesso`,
    restaurarDe: (nome: string) => `Ripristina un backup di ${nome} su un’altra stampante`,
    perfis: 'PROFILI',
    firmware: 'FIRMWARE/CALIB.',
    gcode: 'G-CODE',
    naFila: 'IN CODA — IN ATTESA CHE LA STAMPANTE SIA INATTIVA',
    estados: { OK: 'OK', PARCIAL: 'PARZIALE', FALHOU: 'FALLITO', NUNCA: 'MAI' },
    resultado: (iniciados: number, adiados: number, offline: number) => {
      const partes = [`${iniciados} in corso`];
      if (adiados > 0) partes.push(`${adiados} in stampa (saranno copiate quando saranno inattive)`);
      if (offline > 0) partes.push(`${offline} non in linea`);
      return `Backup: ${partes.join(' · ')}.`;
    },
    adiado: (nome: string) => `${nome} sta stampando — il backup partirà appena sarà inattiva.`,
    iniciado: (nome: string) => `Backup di ${nome} avviato.`,
    falha: 'Impossibile avviare il backup.',
    restaurarTitulo: 'RIPRISTINA LA CONFIGURAZIONE',
    snapshotOrigem: 'BACKUP DI ORIGINE',
    semSnapshot: 'nessun backup archiviato',
    destino: 'STAMPANTE DI DESTINAZIONE',
    mesmaMaquina: ' (la stessa macchina)',
    restaurar: 'Ripristina',
    restaurando: 'Ripristino…',
    confirmaTitulo: 'Sovrascrivere la configurazione',
    confirmaTexto: (nome: string) =>
      `I file di configurazione di ${nome} saranno sostituiti da quelli del backup scelto. Ciò che c’è adesso e non è nel backup andrà perso. Dopo, la macchina ha bisogno di un FIRMWARE_RESTART.`,
    sobrescrever: 'Sovrascrivi',
    restaurado: (n: number) => `Ripristino completato: ${n} file di configurazione inviati.`,
    falhaRestaurar: 'Ripristino non riuscito.',
    plano: 'PIANO',
    resumoPlano: (secoes: string, horas: number, copias: number) =>
      `${secoes} · ${horas} h · ${copias} copie`,
    semSecao: 'niente selezionato',
    secoes: {
      config: 'Configurazione (printer.cfg, macro)',
      banco: 'Profili di Mainsail/Fluidd',
      sistema: 'Firmware e calibrazione',
      gcode: 'Libreria di G-code'
    },
    secoesCurtas: { config: 'config', banco: 'profili', sistema: 'firmware', gcode: 'G-code' },
    configurar: (nome: string) => `Configura il backup di ${nome}`,
    configTitulo: 'IMPOSTAZIONI DI BACKUP',
    oQueCopiar: 'COSA SALVARE',
    arquivosDeConfig: 'FILE DI CONFIGURAZIONE',
    arquivosDica: 'Togli la spunta a ciò che non deve entrare. Un file nuovo sulla stampante entra da solo.',
    arquivosOffline: 'La stampante deve essere in rete per elencare i file.',
    arquivosVazio: 'Nessun file di configurazione sulla stampante.',
    intervalo: 'OGNI QUANTE ORE',
    retencaoLabel: 'COPIE CONSERVATE',
    padraoGlobal: (v: number) => `predefinito (${v})`,
    retencaoAviso: (n: number) =>
      n === 1
        ? 'Conserva solo la copia più recente; le precedenti vengono cancellate.'
        : `Conserva le ${n} più recenti; le precedenti vengono cancellate.`,
    salvar: 'Salva',
    salvando: 'Salvataggio…',
    salvo: (nome: string) => `Impostazioni di backup di ${nome} salvate.`,
    falhaSalvar: 'Impossibile salvare le impostazioni.',
    copias: (nome: string) => `Copie conservate di ${nome}`,
    copiasTitulo: 'COPIE CONSERVATE',
    copiasVazio: 'Ancora nessuna copia conservata.',
    baixar: 'Scarica .zip',
    baixarComGcode: 'Scarica con il G-code',
    comGcode: (n: number) => `+ ${n} G-code`,
    fechar: 'Chiudi'
  },

  alertas: {
    carregando: 'CARICAMENTO…',
    nenhum: 'NESSUN AVVISO APERTO.',
    selecione: 'SCEGLI UN AVVISO A SINISTRA.',
    severidade: (s: string) => `GRAVITÀ ${s.toUpperCase()}`,
    sevNomes: { critica: 'critica', alta: 'alta', media: 'media', baixa: 'bassa' },
    resolver: 'Segna l’avviso come risolto',
    resolverSemPermissao: 'Risolvi l’avviso (senza permesso)',
    abrirImpressora: 'Apri la stampante nel pannello',
    semImagem: 'NESSUNA IMMAGINE DI QUEL MOMENTO',
    frameDe: (nome: string) => `Immagine della telecamera al momento dell’avviso su ${nome}`,
    critico: 'CRITICO',
    bannerCritico: 'LA MACCHINA È FERMA — AGISCI SUBITO',
    titulos: {
      klipper_parado: 'Klipper fermo',
      erro_impressao: 'Stampa interrotta da un errore',
      impressora_offline: 'Stampante irraggiungibile',
      impressao_concluida: 'Stampa completata',
      filamento_acabando: 'Filamento in esaurimento',
      camera_offline: 'Telecamera non in linea',
      camera_muda: 'La telecamera non risponde più',
      backup_falhou: 'Backup non riuscito',
      backup_recuperacao: 'Backup di recupero eseguito',
      backup_esperando: 'Backup in attesa che la stampante sia inattiva'
    } as Record<string, string>
  },

  notificacoes: {
    titulo: 'NOTIFICHE',
    subtitulo: 'Telegram',
    configurar: 'Configurare le notifiche',
    ligadas: 'attive',
    desligadas: 'disattivate',
    semToken: 'senza token del bot',
    paraChat: (c: string) => `alla chat ${c}`,
    ultimoEnvio: (q: string) => `ultimo invio ${q}`,
    nenhumEnvio: 'ancora niente inviato',
    ultimaFalha: (m: string) => `ultimo errore: ${m}`,
    ligar: 'Inviare gli avvisi su Telegram',
    token: 'TOKEN DEL BOT',
    tokenDica: 'Crea il bot con @BotFather. Il token non lascia mai il server.',
    tokenGuardado: 'salvato — lascialo così per mantenerlo',
    chat: 'CHAT',
    chatDica: 'Scrivi al bot e leggi chat.id in /getUpdates. Un gruppo inizia con -100.',
    quais: 'COSA SEGNALARE',
    resolucao: 'Segnalare anche quando l’avviso si risolve da solo',
    comandos: 'Rispondere a /status in chat',
    comandosDica: 'Viene servita solo la chat qui sopra. Sola lettura: mettere in pausa o annullare richiede ancora l’app.',
    idioma: 'I messaggi escono in portoghese, la lingua in cui il server scrive gli avvisi.',
    testar: 'Invia una prova',
    testando: 'Invio…',
    testeOk: 'messaggio inviato',
    salvar: 'Salva',
    salvando: 'Salvataggio…',
    salvo: 'Notifiche salvate.',
    falhaSalvar: 'Impossibile salvare.',
    semPermissao: 'Solo un amministratore configura le notifiche.'
  },
  gestao: {
    titulo: (n: number) => `STAMPANTI DELLA FARM — ${n}`,
    nova: 'Aggiungi una stampante',
    vazio: 'Ancora nessuna stampante. Aggiungi l’indirizzo Moonraker di ogni macchina — di solito',
    camera: 'TELECAMERA',
    semCamera: 'non configurata',
    backupLigado: 'attivo',
    backupDesligado: 'disattivo',
    backup: 'BACKUP',
    chave: 'CHIAVE',
    chaveDefinida: 'impostata',
    chaveNenhuma: 'nessuna',
    remover: (nome: string) => `Togli ${nome} dalla farm`,
    removerTitulo: 'Togli la stampante',
    removerTexto: (nome: string) =>
      `${nome} sparisce dal pannello, dal muro di telecamere e dal ciclo di backup. Anche i backup già archiviati di questa macchina vengono cancellati. La stampante in sé non viene toccata.`,
    editando: (id: string) => `MODIFICA DI ${id}`,
    novaKicker: 'NUOVA STAMPANTE',
    cadastrar: 'Aggiungi stampante',
    nome: 'NOME',
    nomePlaceholder: 'Ender 3 V2 — A',
    url: 'URL DI MOONRAKER',
    urlPlaceholder: 'http://ender-a.local:7125',
    urlDica: 'Accetta un nome .local (mDNS) o un IP. La porta predefinita di Moonraker è 7125.',
    apiKey: 'API KEY (FACOLTATIVA)',
    apiKeyPlaceholder: 'lascia vuoto se Moonraker non la richiede',
    cameraUrl: 'URL DELLA TELECAMERA (FACOLTATIVO)',
    cameraPlaceholder: 'rilevato da solo quando provi la connessione',
    incluirBackup: 'Includi nel backup quotidiano',
    testar: 'Prova la connessione',
    testando: 'Prova in corso…',
    testeOk: (host: string, versao: string) => `Connesso a ${host}, con ${versao}.`,
    testeCameraOk: ' La telecamera ha risposto.',
    testeCameraFalhou: (erro: string) => ` La stampante ha risposto, ma la telecamera no: ${erro}`,
    testeFalhou: (erro: string) => `Non connesso: ${erro}`,
    testeErro: 'Prova non riuscita.',
    naoSalvou: 'Impossibile salvare.',
    cameraDescoberta: (nome: string) => `Telecamera rilevata automaticamente (${nome}).`,
    cameraSemDeteccao: ' Nessuna telecamera rilevata — puoi scrivere l’URL a mano.',
    previaCamera: 'Anteprima della telecamera'
  },

  erros: {
    semServidor: 'Impossibile raggiungere il server.',
    generico: (n: number) => `Errore ${n}`
  }
};
