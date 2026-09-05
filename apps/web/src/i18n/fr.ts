import type { Dicionario } from './pt';

/** Français. Même forme que `pt`, vérifiée par le compilateur. */
export const fr: Dicionario = {
  idioma: { nome: 'Français', codigo: 'FR', trocar: 'Changer de langue' },

  comum: {
    cancelar: 'Annuler',
    confirmar: 'Confirmer',
    salvar: 'Enregistrer',
    salvando: 'Enregistrement…',
    editar: 'Modifier',
    entendi: 'Compris',
    voltar: 'Retour',
    carregando: 'CHARGEMENT…',
    sair: 'Se déconnecter',
    semPermissao: 'sans autorisation'
  },

  status: {
    imprimindo: 'IMPRESSION',
    pausada: 'EN PAUSE',
    cancelada: 'ANNULÉE',
    ociosa: 'INACTIVE',
    atencao: 'ATTENTION',
    offline: 'HORS LIGNE'
  },

  login: {
    chamada: 'Toute la ferme sur un seul écran.',
    subChamada:
      'Caméras en direct, contrôle des impressions, bibliothèque de fichiers et sauvegarde quotidienne de la configuration de chaque machine.',
    kicker: 'ACCÈS AU SERVEUR',
    titulo: 'Se connecter',
    usuario: 'IDENTIFIANT',
    usuarioPlaceholder: 'opérateur',
    senha: 'MOT DE PASSE',
    manterConectado: 'Rester connecté',
    esqueciSenha: 'Mot de passe oublié',
    entrar: 'Se connecter',
    entrando: 'Connexion…',
    informeUsuario: 'Saisissez votre identifiant.',
    informeSenha: 'Saisissez votre mot de passe.',
    credenciaisInvalidas: 'Identifiant ou mot de passe incorrect.',
    servidorMudo: 'Le serveur n’a pas répondu. Vérifiez que le conteneur tourne toujours.',
    naoFoiPossivel: 'Connexion impossible.',
    verificando: 'vérification du serveur…',
    respondendo: 'serveur actif',
    foraDoAr: 'serveur injoignable',
    impressoras: 'IMPRIMANTES',
    arquivos: 'FICHIERS',
    ultimoBackup: 'DERNIÈRE SAUVEGARDE'
  },

  barra: {
    painel: 'Tableau de bord',
    cameras: 'Caméras',
    arquivos: 'Fichiers',
    backups: 'Sauvegardes',
    alertas: 'Alertes',
    gerir: 'Gérer les imprimantes',
    sairCom: (u: string) => `Se déconnecter (${u})`,
    paradaEmergencia: 'Arrêt d’urgence',
    paradaSemPermissao: 'Arrêt d’urgence (sans autorisation)',
    resumo: (a: number, f: number, at: number) => `${a} actives · file ${f} · ${at} attention`,
    alertas_n: (n: number) => ` · ${n} ${n === 1 ? 'alerte' : 'alertes'}`,
    criticos_n: (n: number) => `${n} ${n === 1 ? 'CRITIQUE' : 'CRITIQUES'}`,
    verCriticos: 'Voir les alertes critiques',
    semConexao: ' · HORS CONNEXION',
    pararTudo: 'Tout arrêter',
    confirmaParada: (n: number) =>
      `Cela coupe immédiatement les chauffages et les moteurs des ${n} imprimantes. Les impressions en cours seront perdues et chaque machine aura besoin d’un FIRMWARE_RESTART pour repartir.`,
    paradaEnviada: (n: number) => `Arrêt d’urgence envoyé à ${n} imprimantes.`,
    paradaFalhou: (ids: string) => `Arrêt envoyé, mais échec sur : ${ids}. Vérifiez ces machines physiquement.`,
    paradaErro: 'Impossible d’envoyer l’arrêt d’urgence.'
  },

  painel: {
    semImpressoras: 'AUCUNE IMPRIMANTE ENREGISTRÉE',
    semImpressorasTexto: 'Ajoutez votre premier hôte Moonraker et le mur de caméras apparaîtra ici.',
    cadastrar: 'Ajouter une imprimante',
    selecionar: (nome: string, status: string, pct: number) => `Sélectionner ${nome} — ${status}, ${pct} %`,
    expandir: (nome: string) => `Ouvrir ${nome} en plein écran`,
    cameraDe: (nome: string) => `Caméra de ${nome}`
  },

  fila: {
    titulo: (n: number) => `FILE — ${n} ${n === 1 ? 'TÂCHE' : 'TÂCHES'}`,
    vazia: 'LA FILE EST VIDE. ENVOYEZ UN FICHIER DEPUIS L’ONGLET FICHIERS.',
    dica: 'CLIQUEZ SUR UNE CAMÉRA POUR OUVRIR LE PANNEAU DE CETTE IMPRIMANTE.',
    proximaLivre: 'la prochaine libre',
    tirarDaFila: (arquivo: string) => `Retirer ${arquivo} de la file`,
    estados: {
      pendente: 'EN ATTENTE',
      atribuido: 'ATTRIBUÉE',
      imprimindo: 'IMPRESSION',
      concluido: 'TERMINÉE',
      falhou: 'ÉCHEC',
      cancelado: 'ANNULÉE'
    }
  },

  impressora: {
    maquina: 'MACHINE',
    reiniciar: 'Redémarrer l’hôte de l’imprimante',
    desligar: 'Éteindre l’hôte de l’imprimante',
    reiniciarSemPermissao: 'Redémarrer l’hôte (sans autorisation)',
    desligarSemPermissao: 'Éteindre l’hôte (sans autorisation)',
    reiniciarCurto: 'Redémarrer',
    desligarCurto: 'Éteindre',
    confirmaReiniciar: (nome: string, imprimindo: boolean) =>
      `Redémarre l’ordinateur qui fait tourner Klipper et Moonraker sur ${nome}. La machine disparaît du tableau de bord pendant une minute environ, puis revient d’elle-même.${
        imprimindo ? ' L’impression en cours sera perdue.' : ''
      }`,
    confirmaDesligar: (nome: string, imprimindo: boolean) =>
      `Éteint l’ordinateur qui fait tourner Klipper et Moonraker sur ${nome}. Elle ne revient que si quelqu’un rallume la machine sur place.${
        imprimindo ? ' L’impression en cours sera perdue.' : ''
      }`,
    falhaEnergia: 'La commande n’a pas pu être envoyée.',
    fechar: 'Fermer le panneau',
    trabalho: 'TÂCHE',
    camada: (c: string) => `COUCHE ${c}`,
    pausar: 'Mettre l’impression en pause',
    continuar: 'Reprendre l’impression',
    cancelar: 'Annuler l’impression',
    confirmaCancelar: (nome: string, job: string, pct: number) =>
      `Interrompt ${job} sur ${nome}, à ${pct}%. Impossible de reprendre où elle s’est arrêtée : la pièce est perdue et l’impression repart de zéro.`,
    excluirPeca: 'Exclure cette pièce de l’impression',
    excluirPecaCurto: 'Exclure la pièce',
    confirmaExcluirPeca: (peca: string) =>
      `Retire ${peca} de cette impression. La buse cesse d’y passer et les autres pièces du plateau continuent normalement. Impossible de revenir en arrière — et si c’était la dernière, l’impression se termine.`,
    temperaturas: 'TEMPÉRATURES',
    bico: 'Buse',
    mesa: 'Plateau',
    alvoDe: (nome: string) => `Consigne de ${nome} en degrés Celsius`,
    faixa: (min: number, max: number) => `entre ${min} et ${max} °C`,
    desligarAquecedores: 'Éteindre tous les chauffages',
    confirmaDesligarAquecedores: (nome: string, imprimindo: boolean) =>
      `Met à zéro la consigne de tous les chauffages de ${nome} d’un coup — buse, plateau et tout ce qui chauffe.${
        imprimindo ? ' L’impression en cours continue avec une buse froide et sera perdue.' : ''
      }`,
    falhaAlvo: 'Impossible de changer la consigne.',
    cabeca: 'TÊTE D’IMPRESSION',
    passo: 'PAS (MM)',
    passoGrupo: 'Pas de déplacement en millimètres',
    moverYTras: 'Déplacer Y vers l’arrière',
    moverYFrente: 'Déplacer Y vers l’avant',
    moverXEsq: 'Déplacer X vers la gauche',
    moverXDir: 'Déplacer X vers la droite',
    subirZ: 'Monter Z',
    descerZ: 'Descendre Z',
    home: 'Origine sur tous les axes',
    posicaoDesconhecida: 'POSITION INCONNUE',
    macros: 'MACROS',
    fila: 'FILE DE CETTE IMPRIMANTE',
    filaVazia: 'rien en file pour cette machine',
    daFazenda: 'de la ferme',
    iniciar: (arquivo: string) => `Autoriser et lancer ${arquivo}`,
    iniciarOcupada: 'l’imprimante doit être inactive pour démarrer',
    iniciando: 'Démarrage…',
    aguardandoAutorizacao: 'EN ATTENTE D’AUTORISATION',
    concluida: 'LA DERNIÈRE PIÈCE EST SORTIE ENTIÈRE',
    reimprimir: (arquivo: string) => `Réimprimer ${arquivo}`,
    retirarPeca: 'Retirez la pièce du plateau avant de lancer la suivante.',
    falhaIniciar: 'Impossible de démarrer.'
  },

  cameras: {
    nenhuma: 'AUCUNE CAMÉRA DISPONIBLE',
    verNoQuadrante: (nome: string) => `Afficher ${nome} dans le quadrant`,
    semSinal: 'PAS DE SIGNAL',
    semCamera: 'PAS DE CAMÉRA'
  },

  arquivos: {
    biblioteca: (n: number) => `BIBLIOTHÈQUE — ${n} FICHIERS`,
    agrupadoPor: 'GROUPÉ PAR IMPRIMANTE',
    destinoGrupo: 'l’imprimante du groupe',
    semArquivos: 'aucun G-code sur cette imprimante',
    impressoraOffline: 'imprimante hors ligne — impossible de lister',
    recolher: (nome: string) => `Replier ${nome}`,
    expandir: (nome: string) => `Déplier ${nome}`,
    contagem: (n: number) => `${n} ${n === 1 ? 'fichier' : 'fichiers'}`,
    enviarPara: 'ENVOYER VERS',
    carregando: 'CHARGEMENT DE LA BIBLIOTHÈQUE…',
    erro: 'IMPOSSIBLE DE LISTER LES FICHIERS.',
    vazio: 'AUCUN G-CODE TROUVÉ SUR LES IMPRIMANTES DE LA FERME.',
    enfileirar: (nome: string) => `Envoyer ${nome} dans la file`,
    enfileirarSemPermissao: 'Envoyer dans la file (sans autorisation)',
    previaDe: (nome: string) => `Aperçu de ${nome}`,
    enviado: (arquivo: string, destino: string) => `${arquivo} envoyé dans la file (${destino}).`,
    falhaEnfileirar: 'Impossible de mettre en file.'
  },

  backups: {
    rotina: 'PLANIFICATION',
    ultimoCiclo: 'DERNIER CYCLE',
    armazenado: 'STOCKÉ',
    falhas: 'ÉCHECS',
    diario: (hora: string) => `chaque jour à ${hora} · et à la reconnexion`,
    nunca: 'jamais',
    rodarTodas: 'Sauvegarder toute la ferme maintenant',
    rodarSemPermissao: 'Sauvegarder maintenant (sans autorisation)',
    rodarUma: (nome: string) => `Sauvegarder ${nome} maintenant`,
    restaurarDe: (nome: string) => `Restaurer une sauvegarde de ${nome} sur une autre imprimante`,
    perfis: 'PROFILS',
    firmware: 'FIRMWARE/ÉTAL.',
    gcode: 'G-CODE',
    naFila: 'EN FILE — EN ATTENTE QUE L’IMPRIMANTE SOIT INACTIVE',
    estados: { OK: 'OK', PARCIAL: 'PARTIELLE', FALHOU: 'ÉCHEC', NUNCA: 'JAMAIS' },
    resultado: (iniciados: number, adiados: number, offline: number) => {
      const partes = [`${iniciados} en cours`];
      if (adiados > 0) partes.push(`${adiados} en impression (copiées dès qu’elles seront inactives)`);
      if (offline > 0) partes.push(`${offline} hors ligne`);
      return `Sauvegarde : ${partes.join(' · ')}.`;
    },
    adiado: (nome: string) => `${nome} imprime — la sauvegarde partira dès qu’elle sera inactive.`,
    iniciado: (nome: string) => `Sauvegarde de ${nome} lancée.`,
    falha: 'Impossible de lancer la sauvegarde.',
    restaurarTitulo: 'RESTAURER LA CONFIGURATION',
    snapshotOrigem: 'SAUVEGARDE SOURCE',
    semSnapshot: 'aucune sauvegarde enregistrée',
    destino: 'IMPRIMANTE CIBLE',
    mesmaMaquina: ' (la même machine)',
    restaurar: 'Restaurer',
    restaurando: 'Restauration…',
    confirmaTitulo: 'Écraser la configuration',
    confirmaTexto: (nome: string) =>
      `Les fichiers de configuration de ${nome} seront remplacés par ceux de la sauvegarde choisie. Ce qui s’y trouve aujourd’hui et n’est pas dans la sauvegarde sera perdu. La machine aura besoin d’un FIRMWARE_RESTART ensuite.`,
    sobrescrever: 'Écraser',
    restaurado: (n: number) => `Restauration terminée : ${n} fichiers de configuration envoyés.`,
    falhaRestaurar: 'La restauration a échoué.',
    plano: 'PLAN',
    resumoPlano: (secoes: string, horas: number, copias: number) =>
      `${secoes} · ${horas} h · ${copias} copies`,
    semSecao: 'rien de sélectionné',
    secoes: {
      config: 'Configuration (printer.cfg, macros)',
      banco: 'Profils Mainsail/Fluidd',
      sistema: 'Firmware et calibration',
      gcode: 'Bibliothèque de G-code'
    },
    secoesCurtas: { config: 'config', banco: 'profils', sistema: 'firmware', gcode: 'G-code' },
    configurar: (nome: string) => `Configurer la sauvegarde de ${nome}`,
    configTitulo: 'RÉGLAGES DE SAUVEGARDE',
    oQueCopiar: 'QUOI SAUVEGARDER',
    arquivosDeConfig: 'FICHIERS DE CONFIGURATION',
    arquivosDica: 'Décochez ce qui ne doit pas y entrer. Un nouveau fichier sur l’imprimante y entre tout seul.',
    arquivosOffline: 'L’imprimante doit être sur le réseau pour lister ses fichiers.',
    arquivosVazio: 'Aucun fichier de configuration sur l’imprimante.',
    intervalo: 'TOUTES LES COMBIEN D’HEURES',
    retencaoLabel: 'COPIES CONSERVÉES',
    padraoGlobal: (v: number) => `par défaut (${v})`,
    retencaoAviso: (n: number) =>
      n === 1
        ? 'Ne conserve que la copie la plus récente ; les précédentes sont supprimées.'
        : `Conserve les ${n} plus récentes ; les précédentes sont supprimées.`,
    salvar: 'Enregistrer',
    salvando: 'Enregistrement…',
    salvo: (nome: string) => `Réglages de sauvegarde de ${nome} enregistrés.`,
    falhaSalvar: 'Impossible d’enregistrer les réglages.',
    copias: (nome: string) => `Copies conservées de ${nome}`,
    copiasTitulo: 'COPIES CONSERVÉES',
    copiasVazio: 'Aucune copie conservée pour l’instant.',
    baixar: 'Télécharger le .zip',
    baixarComGcode: 'Télécharger avec le G-code',
    comGcode: (n: number) => `+ ${n} G-code`,
    fechar: 'Fermer'
  },

  alertas: {
    carregando: 'CHARGEMENT…',
    nenhum: 'AUCUNE ALERTE OUVERTE.',
    selecione: 'CHOISISSEZ UNE ALERTE À GAUCHE.',
    severidade: (s: string) => `GRAVITÉ ${s.toUpperCase()}`,
    sevNomes: { critica: 'critique', alta: 'haute', media: 'moyenne', baixa: 'basse' },
    resolver: 'Marquer l’alerte comme résolue',
    resolverSemPermissao: 'Résoudre l’alerte (sans autorisation)',
    abrirImpressora: 'Ouvrir l’imprimante sur le tableau de bord',
    semImagem: 'PAS D’IMAGE DE CE MOMENT',
    frameDe: (nome: string) => `Image de la caméra au moment de l’alerte sur ${nome}`,
    critico: 'CRITIQUE',
    bannerCritico: 'LA MACHINE EST À L’ARRÊT — AGISSEZ MAINTENANT',
    titulos: {
      klipper_parado: 'Klipper à l’arrêt',
      erro_impressao: 'Impression interrompue par une erreur',
      impressora_offline: 'Imprimante injoignable',
      impressao_concluida: 'Impression terminée',
      impressao_pausada: 'Impression en pause',
      filamento_acabando: 'Filament bientôt épuisé',
      camera_offline: 'Caméra hors ligne',
      camera_muda: 'La caméra ne répond plus',
      backup_falhou: 'Échec de la sauvegarde',
      backup_recuperacao: 'Sauvegarde de rattrapage effectuée',
      backup_esperando: 'Sauvegarde en attente que l’imprimante soit inactive'
    } as Record<string, string>
  },

  notificacoes: {
    titulo: 'NOTIFICATIONS',
    subtitulo: 'Telegram',
    configurar: 'Configurer les notifications',
    ligadas: 'activées',
    desligadas: 'désactivées',
    semToken: 'sans jeton du bot',
    paraChat: (c: string) => `vers le chat ${c}`,
    ultimoEnvio: (q: string) => `dernier envoi ${q}`,
    nenhumEnvio: 'rien envoyé pour l’instant',
    ultimaFalha: (m: string) => `dernier échec : ${m}`,
    ligar: 'Envoyer les alertes vers Telegram',
    token: 'JETON DU BOT',
    tokenDica: 'Créez le bot avec @BotFather. Le jeton ne quitte jamais le serveur.',
    tokenGuardado: 'enregistré — laissez tel quel pour le conserver',
    chat: 'CHAT',
    chatDica: 'Écrivez au bot et lisez chat.id dans /getUpdates. Un groupe commence par -100.',
    quais: 'QUOI SIGNALER',
    resolucao: 'Signaler aussi quand l’alerte se résout d’elle-même',
    comandos: 'Répondre à /status dans le chat',
    comandosDica: 'Seul le chat ci-dessus est servi. En lecture seule : mettre en pause ou annuler passe toujours par l’app.',
    idioma: 'Les messages partent en portugais, la langue dans laquelle le serveur écrit les alertes.',
    testar: 'Envoyer un test',
    testando: 'Envoi…',
    testeOk: 'message envoyé',
    salvar: 'Enregistrer',
    salvando: 'Enregistrement…',
    salvo: 'Notifications enregistrées.',
    falhaSalvar: 'Enregistrement impossible.',
    semPermissao: 'Seul un administrateur configure les notifications.'
  },
  gestao: {
    titulo: (n: number) => `IMPRIMANTES DE LA FERME — ${n}`,
    nova: 'Ajouter une imprimante',
    vazio: 'Aucune imprimante pour l’instant. Ajoutez l’adresse Moonraker de chaque machine — en général',
    camera: 'CAMÉRA',
    semCamera: 'non configurée',
    backupLigado: 'activée',
    backupDesligado: 'désactivée',
    backup: 'SAUVEGARDE',
    chave: 'CLÉ',
    chaveDefinida: 'définie',
    chaveNenhuma: 'aucune',
    remover: (nome: string) => `Retirer ${nome} de la ferme`,
    removerTitulo: 'Retirer l’imprimante',
    removerTexto: (nome: string) =>
      `${nome} disparaît du tableau de bord, du mur de caméras et du cycle de sauvegarde. Les sauvegardes déjà enregistrées pour cette machine sont supprimées aussi. L’imprimante elle-même n’est pas touchée.`,
    editando: (id: string) => `MODIFICATION DE ${id}`,
    novaKicker: 'NOUVELLE IMPRIMANTE',
    cadastrar: 'Ajouter une imprimante',
    nome: 'NOM',
    nomePlaceholder: 'Ender 3 V2 — A',
    url: 'URL DE MOONRAKER',
    urlPlaceholder: 'http://ender-a.local:7125',
    urlDica: 'Accepte un nom .local (mDNS) ou une IP. Le port par défaut de Moonraker est 7125.',
    apiKey: 'CLÉ API (FACULTATIF)',
    apiKeyPlaceholder: 'laissez vide si Moonraker n’en demande pas',
    cameraUrl: 'URL DE LA CAMÉRA (FACULTATIF)',
    cameraPlaceholder: 'détectée automatiquement lors du test de connexion',
    incluirBackup: 'Inclure dans la sauvegarde quotidienne',
    testar: 'Tester la connexion',
    testando: 'Test en cours…',
    testeOk: (host: string, versao: string) => `Connecté à ${host}, en ${versao}.`,
    testeCameraOk: ' La caméra a répondu.',
    testeCameraFalhou: (erro: string) => ` L’imprimante a répondu, mais pas la caméra : ${erro}`,
    testeFalhou: (erro: string) => `Non connecté : ${erro}`,
    testeErro: 'Le test a échoué.',
    naoSalvou: 'Enregistrement impossible.',
    cameraDescoberta: (nome: string) => `Caméra détectée automatiquement (${nome}).`,
    cameraSemDeteccao: ' Aucune caméra détectée — vous pouvez saisir l’URL à la main.',
    previaCamera: 'Aperçu de la caméra'
  },

  erros: {
    semServidor: 'Impossible de joindre le serveur.',
    generico: (n: number) => `Erreur ${n}`
  }
};
