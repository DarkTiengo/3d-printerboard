/** Português do Brasil — idioma em que o design foi escrito. */
export const pt = {
  idioma: { nome: 'Português', codigo: 'PT', trocar: 'Mudar idioma' },

  comum: {
    cancelar: 'Cancelar',
    confirmar: 'Confirmar',
    salvar: 'Salvar',
    salvando: 'Salvando…',
    editar: 'Editar',
    entendi: 'Entendi',
    carregando: 'CARREGANDO…',
    sair: 'Sair',
    semPermissao: 'sem permissão'
  },

  status: {
    imprimindo: 'IMPRIMINDO',
    pausada: 'PAUSADA',
    cancelada: 'CANCELADA',
    ociosa: 'OCIOSA',
    atencao: 'ATENÇÃO',
    offline: 'OFFLINE'
  },

  login: {
    chamada: 'Toda a fazenda em uma tela só.',
    subChamada:
      'Câmeras ao vivo, controle de impressão, biblioteca de arquivos e backup diário das configurações de cada máquina.',
    kicker: 'ACESSO AO SERVIDOR',
    titulo: 'Entrar',
    usuario: 'USUÁRIO',
    usuarioPlaceholder: 'operador',
    senha: 'SENHA',
    manterConectado: 'Manter conectado',
    esqueciSenha: 'Esqueci a senha',
    entrar: 'Entrar',
    entrando: 'Entrando…',
    informeUsuario: 'Informe o usuário.',
    informeSenha: 'Informe a senha.',
    credenciaisInvalidas: 'Usuário ou senha inválidos.',
    servidorMudo: 'O servidor não respondeu. Verifique se o container ainda está no ar.',
    naoFoiPossivel: 'Não foi possível entrar.',
    verificando: 'verificando servidor…',
    respondendo: 'servidor respondendo',
    foraDoAr: 'servidor fora do ar',
    impressoras: 'IMPRESSORAS',
    arquivos: 'ARQUIVOS',
    ultimoBackup: 'ÚLTIMO BACKUP'
  },

  barra: {
    painel: 'Painel',
    cameras: 'Câmeras',
    arquivos: 'Arquivos',
    backups: 'Backups',
    alertas: 'Alertas',
    gerir: 'Gerir impressoras',
    sairCom: (u: string) => `Sair (${u})`,
    paradaEmergencia: 'Parada de emergência',
    paradaSemPermissao: 'Parada de emergência (sem permissão)',
    resumo: (a: number, f: number, at: number) => `${a} ativas · fila ${f} · ${at} atenção`,
    alertas_n: (n: number) => ` · ${n} ${n === 1 ? 'alerta' : 'alertas'}`,
    semConexao: ' · SEM CONEXÃO',
    pararTudo: 'Parar tudo',
    confirmaParada: (n: number) =>
      `Isto desliga os aquecedores e os motores de todas as ${n} impressoras imediatamente. As impressões em andamento serão perdidas e cada máquina precisará de um FIRMWARE_RESTART para voltar.`,
    paradaEnviada: (n: number) => `Parada de emergência enviada para ${n} impressoras.`,
    paradaFalhou: (ids: string) =>
      `Parada enviada, mas falhou em: ${ids}. Verifique essas máquinas fisicamente.`,
    paradaErro: 'Falha ao enviar a parada de emergência.'
  },

  painel: {
    semImpressoras: 'NENHUMA IMPRESSORA CADASTRADA',
    semImpressorasTexto: 'Cadastre o primeiro host Moonraker para a parede de câmeras aparecer aqui.',
    cadastrar: 'Cadastrar impressora',
    selecionar: (nome: string, status: string, pct: number) => `Selecionar ${nome} — ${status}, ${pct}%`,
    expandir: (nome: string) => `Abrir ${nome} em tela cheia`,
    cameraDe: (nome: string) => `Câmera de ${nome}`
  },

  fila: {
    titulo: (n: number) => `FILA — ${n} ${n === 1 ? 'TRABALHO' : 'TRABALHOS'}`,
    vazia: 'FILA VAZIA. MANDE UM ARQUIVO PELA ABA ARQUIVOS.',
    dica: 'CLIQUE EM UMA CÂMERA PARA ABRIR O PAINEL DE CONTROLE DA IMPRESSORA.',
    proximaLivre: 'próxima livre',
    tirarDaFila: (arquivo: string) => `Tirar ${arquivo} da fila`,
    estados: {
      pendente: 'PENDENTE',
      atribuido: 'ATRIBUÍDO',
      imprimindo: 'IMPRIMINDO',
      concluido: 'CONCLUÍDO',
      falhou: 'FALHOU',
      cancelado: 'CANCELADO'
    }
  },

  impressora: {
    fechar: 'Fechar painel',
    trabalho: 'TRABALHO',
    camada: (c: string) => `CAMADA ${c}`,
    pausar: 'Pausar impressão',
    continuar: 'Continuar impressão',
    cancelar: 'Cancelar impressão',
    temperaturas: 'TEMPERATURAS',
    bico: 'Bico',
    mesa: 'Mesa',
    cabeca: 'CABEÇA DE IMPRESSÃO',
    passo: 'PASSO (MM)',
    passoGrupo: 'Passo do jog em milímetros',
    moverYTras: 'Mover Y para trás',
    moverYFrente: 'Mover Y para a frente',
    moverXEsq: 'Mover X para a esquerda',
    moverXDir: 'Mover X para a direita',
    subirZ: 'Subir Z',
    descerZ: 'Descer Z',
    home: 'Home em todos os eixos',
    posicaoDesconhecida: 'POSIÇÃO DESCONHECIDA',
    macros: 'MACROS',
    fila: 'FILA DESTA IMPRESSORA',
    filaVazia: 'nada na fila desta máquina',
    daFazenda: 'da fazenda',
    iniciar: (arquivo: string) => `Autorizar e iniciar ${arquivo}`,
    iniciarOcupada: 'a impressora precisa estar ociosa para começar',
    iniciando: 'Iniciando…',
    aguardandoAutorizacao: 'AGUARDANDO AUTORIZAÇÃO',
    concluida: 'ÚLTIMA PEÇA SAIU INTEIRA',
    reimprimir: (arquivo: string) => `Reimprimir ${arquivo}`,
    retirarPeca: 'Tire a peça da mesa antes de começar a próxima.',
    falhaIniciar: 'Não foi possível iniciar.'
  },

  cameras: {
    nenhuma: 'NENHUMA CÂMERA DISPONÍVEL',
    verNoQuadrante: (nome: string) => `Ver ${nome} no quadrante`,
    semSinal: 'SEM SINAL',
    semCamera: 'SEM CÂMERA'
  },

  arquivos: {
    biblioteca: (n: number) => `BIBLIOTECA — ${n} ARQUIVOS`,
    agrupadoPor: 'AGRUPADO POR IMPRESSORA',
    destinoGrupo: 'a impressora do grupo',
    semArquivos: 'nenhum G-code nesta impressora',
    impressoraOffline: 'impressora offline — não dá para listar',
    recolher: (nome: string) => `Recolher ${nome}`,
    expandir: (nome: string) => `Expandir ${nome}`,
    contagem: (n: number) => `${n} ${n === 1 ? 'arquivo' : 'arquivos'}`,
    enviarPara: 'ENVIAR PARA',
    carregando: 'CARREGANDO BIBLIOTECA…',
    erro: 'NÃO FOI POSSÍVEL LISTAR OS ARQUIVOS.',
    vazio: 'NENHUM G-CODE ENCONTRADO NAS IMPRESSORAS DA FAZENDA.',
    enfileirar: (nome: string) => `Enviar ${nome} para a fila`,
    enfileirarSemPermissao: 'Enviar para a fila (sem permissão)',
    previaDe: (nome: string) => `Prévia de ${nome}`,
    enviado: (arquivo: string, destino: string) => `${arquivo} enviado para a fila (${destino}).`,
    falhaEnfileirar: 'Falha ao enfileirar.'
  },

  backups: {
    rotina: 'ROTINA',
    ultimoCiclo: 'ÚLTIMO CICLO',
    armazenado: 'ARMAZENADO',
    falhas: 'FALHAS',
    diario: (hora: string) => `diário ${hora} · e ao religar`,
    nunca: 'nunca',
    rodarTodas: 'Backup de toda a fazenda agora',
    rodarSemPermissao: 'Backup agora (sem permissão)',
    rodarUma: (nome: string) => `Fazer backup de ${nome} agora`,
    restaurarDe: (nome: string) => `Restaurar um backup de ${nome} em outra impressora`,
    perfis: 'PERFIS',
    firmware: 'FIRMWARE/CALIB.',
    gcode: 'G-CODE',
    naFila: 'NA FILA — AGUARDANDO FICAR OCIOSA',
    estados: { OK: 'OK', PARCIAL: 'PARCIAL', FALHOU: 'FALHOU', NUNCA: 'NUNCA' },
    resultado: (iniciados: number, adiados: number, offline: number) => {
      const partes = [`${iniciados} em andamento`];
      if (adiados > 0) partes.push(`${adiados} imprimindo (serão copiadas ao ficarem ociosas)`);
      if (offline > 0) partes.push(`${offline} offline`);
      return `Backup: ${partes.join(' · ')}.`;
    },
    adiado: (nome: string) => `${nome} está imprimindo — o backup vai rodar assim que ela ficar ociosa.`,
    iniciado: (nome: string) => `Backup de ${nome} iniciado.`,
    falha: 'Falha ao iniciar o backup.',
    restaurarTitulo: 'RESTAURAR CONFIGURAÇÃO',
    snapshotOrigem: 'SNAPSHOT DE ORIGEM',
    semSnapshot: 'nenhum snapshot guardado',
    destino: 'IMPRESSORA DE DESTINO',
    mesmaMaquina: ' (mesma máquina)',
    restaurar: 'Restaurar',
    restaurando: 'Restaurando…',
    confirmaTitulo: 'Sobrescrever configuração',
    confirmaTexto: (nome: string) =>
      `Os arquivos de configuração de ${nome} serão substituídos pelos do snapshot escolhido. O que estiver lá agora e não estiver no backup se perde. A máquina precisa de um FIRMWARE_RESTART depois.`,
    sobrescrever: 'Sobrescrever',
    restaurado: (n: number) => `Restauração concluída: ${n} arquivos de configuração enviados.`,
    falhaRestaurar: 'Falha na restauração.',
    plano: 'PLANO',
    resumoPlano: (secoes: string, horas: number, copias: number) =>
      `${secoes} · ${horas} h · ${copias} cópias`,
    semSecao: 'nada selecionado',
    secoes: {
      config: 'Configuração (printer.cfg, macros)',
      banco: 'Perfis do Mainsail/Fluidd',
      sistema: 'Firmware e calibração',
      gcode: 'Biblioteca de G-code'
    },
    secoesCurtas: { config: 'config', banco: 'perfis', sistema: 'firmware', gcode: 'G-code' },
    configurar: (nome: string) => `Configurar o backup de ${nome}`,
    configTitulo: 'CONFIGURAÇÃO DO BACKUP',
    oQueCopiar: 'O QUE COPIAR',
    arquivosDeConfig: 'ARQUIVOS DE CONFIGURAÇÃO',
    arquivosDica: 'Desmarque o que não deve entrar. Arquivo novo na impressora entra sozinho.',
    arquivosOffline: 'A impressora precisa estar na rede para listar os arquivos.',
    arquivosVazio: 'Nenhum arquivo de configuração na impressora.',
    intervalo: 'A CADA QUANTAS HORAS',
    retencaoLabel: 'CÓPIAS GUARDADAS',
    padraoGlobal: (v: number) => `padrão (${v})`,
    retencaoAviso: (n: number) => `Guarda as ${n} mais recentes; as anteriores são apagadas.`,
    salvar: 'Salvar',
    salvando: 'Salvando…',
    salvo: (nome: string) => `Configuração de backup de ${nome} salva.`,
    falhaSalvar: 'Não foi possível salvar a configuração.',
    copias: (nome: string) => `Cópias guardadas de ${nome}`,
    copiasTitulo: 'CÓPIAS GUARDADAS',
    copiasVazio: 'Nenhuma cópia guardada ainda.',
    baixar: 'Baixar .zip',
    baixarComGcode: 'Baixar com o G-code junto',
    comGcode: (n: number) => `+ ${n} G-code`,
    fechar: 'Fechar'
  },

  alertas: {
    carregando: 'CARREGANDO…',
    nenhum: 'NENHUM ALERTA ABERTO.',
    selecione: 'SELECIONE UM ALERTA À ESQUERDA.',
    severidade: (s: string) => `SEVERIDADE ${s.toUpperCase()}`,
    sevNomes: { alta: 'alta', media: 'média', baixa: 'baixa' },
    resolver: 'Marcar alerta como resolvido',
    resolverSemPermissao: 'Resolver alerta (sem permissão)',
    abrirImpressora: 'Abrir a impressora no painel',
    semImagem: 'SEM IMAGEM DO MOMENTO',
    frameDe: (nome: string) => `Imagem da câmera no momento do alerta em ${nome}`,
    titulos: {
      erro_impressao: 'Impressão interrompida por erro',
      impressora_offline: 'Impressora fora do ar',
      impressao_concluida: 'Impressão concluída',
      filamento_acabando: 'Filamento acabando',
      camera_offline: 'Câmera offline',
      camera_muda: 'Câmera parou de responder',
      backup_falhou: 'Backup falhou',
      backup_recuperacao: 'Backup de recuperação executado',
      backup_esperando: 'Backup esperando a impressora ficar ociosa'
    } as Record<string, string>
  },

  gestao: {
    titulo: (n: number) => `IMPRESSORAS DA FAZENDA — ${n}`,
    nova: 'Cadastrar nova impressora',
    vazio: 'Nenhuma impressora cadastrada. Adicione o endereço do Moonraker de cada máquina — normalmente',
    camera: 'CÂMERA',
    semCamera: 'não configurada',
    backupLigado: 'ligado',
    backupDesligado: 'desligado',
    backup: 'BACKUP',
    chave: 'CHAVE',
    chaveDefinida: 'definida',
    chaveNenhuma: 'nenhuma',
    remover: (nome: string) => `Remover ${nome} da fazenda`,
    removerTitulo: 'Remover impressora',
    removerTexto: (nome: string) =>
      `${nome} sai do painel, da parede de câmeras e do ciclo de backup. Os snapshots já guardados dessa máquina também são apagados. A impressora em si não é alterada.`,
    editando: (id: string) => `EDITANDO ${id}`,
    novaKicker: 'NOVA IMPRESSORA',
    cadastrar: 'Cadastrar',
    nome: 'NOME',
    nomePlaceholder: 'Ender 3 V2 — A',
    url: 'URL DO MOONRAKER',
    urlPlaceholder: 'http://ender-a.local:7125',
    urlDica: 'Aceita nome .local (mDNS) ou IP. A porta padrão do Moonraker é 7125.',
    apiKey: 'API KEY (OPCIONAL)',
    apiKeyPlaceholder: 'em branco se o Moonraker não exige',
    cameraUrl: 'URL DA CÂMERA (OPCIONAL)',
    cameraPlaceholder: 'detectada sozinha ao testar a conexão',
    incluirBackup: 'Incluir no backup diário',
    testar: 'Testar conexão',
    testando: 'Testando…',
    testeOk: (host: string, versao: string) => `Conectado a ${host}, rodando ${versao}.`,
    testeCameraOk: ' A câmera respondeu.',
    testeCameraFalhou: (erro: string) => ` A impressora respondeu, mas a câmera não: ${erro}`,
    testeFalhou: (erro: string) => `Não conectou: ${erro}`,
    testeErro: 'Falha no teste.',
    naoSalvou: 'Não foi possível salvar.',
    cameraDescoberta: (nome: string) => `Câmera detectada automaticamente (${nome}).`,
    cameraSemDeteccao: ' Nenhuma câmera detectada — dá para preencher a URL na mão.',
    previaCamera: 'Prévia da câmera'
  },

  erros: {
    semServidor: 'Não foi possível falar com o servidor.',
    generico: (n: number) => `Erro ${n}`
  }
};

export type Dicionario = typeof pt;
