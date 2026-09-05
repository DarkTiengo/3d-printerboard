import type { Dicionario } from './pt';

/** Español. Misma forma que `pt`, verificada por el compilador. */
export const es: Dicionario = {
  idioma: { nome: 'Español', codigo: 'ES', trocar: 'Cambiar idioma' },

  comum: {
    cancelar: 'Cancelar',
    confirmar: 'Confirmar',
    salvar: 'Guardar',
    salvando: 'Guardando…',
    editar: 'Editar',
    entendi: 'Entendido',
    voltar: 'Volver',
    carregando: 'CARGANDO…',
    sair: 'Salir',
    semPermissao: 'sin permiso'
  },

  status: {
    imprimindo: 'IMPRIMIENDO',
    pausada: 'EN PAUSA',
    cancelada: 'CANCELADA',
    ociosa: 'INACTIVA',
    atencao: 'ATENCIÓN',
    offline: 'DESCONECTADA'
  },

  login: {
    chamada: 'Toda la granja en una sola pantalla.',
    subChamada:
      'Cámaras en vivo, control de impresión, biblioteca de archivos y copia de seguridad diaria de la configuración de cada máquina.',
    kicker: 'ACCESO AL SERVIDOR',
    titulo: 'Entrar',
    usuario: 'USUARIO',
    usuarioPlaceholder: 'operador',
    senha: 'CONTRASEÑA',
    manterConectado: 'Mantener la sesión iniciada',
    esqueciSenha: 'Olvidé mi contraseña',
    entrar: 'Entrar',
    entrando: 'Entrando…',
    informeUsuario: 'Escribe tu usuario.',
    informeSenha: 'Escribe tu contraseña.',
    credenciaisInvalidas: 'Usuario o contraseña incorrectos.',
    servidorMudo: 'El servidor no respondió. Comprueba si el contenedor sigue funcionando.',
    naoFoiPossivel: 'No se pudo entrar.',
    verificando: 'comprobando el servidor…',
    respondendo: 'servidor respondiendo',
    foraDoAr: 'servidor inaccesible',
    impressoras: 'IMPRESORAS',
    arquivos: 'ARCHIVOS',
    ultimoBackup: 'ÚLTIMA COPIA'
  },

  barra: {
    painel: 'Panel',
    cameras: 'Cámaras',
    arquivos: 'Archivos',
    backups: 'Copias',
    alertas: 'Alertas',
    gerir: 'Gestionar impresoras',
    sairCom: (u: string) => `Salir (${u})`,
    paradaEmergencia: 'Parada de emergencia',
    paradaSemPermissao: 'Parada de emergencia (sin permiso)',
    resumo: (a: number, f: number, at: number) => `${a} activas · cola ${f} · ${at} atención`,
    alertas_n: (n: number) => ` · ${n} ${n === 1 ? 'alerta' : 'alertas'}`,
    criticos_n: (n: number) => `${n} ${n === 1 ? 'CRÍTICO' : 'CRÍTICOS'}`,
    verCriticos: 'Ver las alertas críticas',
    semConexao: ' · SIN CONEXIÓN',
    pararTudo: 'Parar todo',
    confirmaParada: (n: number) =>
      `Esto apaga los calentadores y los motores de las ${n} impresoras de inmediato. Las impresiones en curso se pierden y cada máquina necesitará un FIRMWARE_RESTART para volver.`,
    paradaEnviada: (n: number) => `Parada de emergencia enviada a ${n} impresoras.`,
    paradaFalhou: (ids: string) => `Parada enviada, pero falló en: ${ids}. Revisa esas máquinas físicamente.`,
    paradaErro: 'No se pudo enviar la parada de emergencia.'
  },

  painel: {
    semImpressoras: 'NINGUNA IMPRESORA REGISTRADA',
    semImpressorasTexto: 'Añade tu primer host Moonraker y el muro de cámaras aparecerá aquí.',
    cadastrar: 'Añadir impresora',
    selecionar: (nome: string, status: string, pct: number) => `Seleccionar ${nome} — ${status}, ${pct}%`,
    expandir: (nome: string) => `Abrir ${nome} a pantalla completa`,
    cameraDe: (nome: string) => `Cámara de ${nome}`
  },

  fila: {
    titulo: (n: number) => `COLA — ${n} ${n === 1 ? 'TRABAJO' : 'TRABAJOS'}`,
    vazia: 'LA COLA ESTÁ VACÍA. ENVÍA UN ARCHIVO DESDE LA PESTAÑA ARCHIVOS.',
    dica: 'HAZ CLIC EN UNA CÁMARA PARA ABRIR EL PANEL DE CONTROL DE ESA IMPRESORA.',
    proximaLivre: 'la próxima libre',
    tirarDaFila: (arquivo: string) => `Quitar ${arquivo} de la cola`,
    estados: {
      pendente: 'PENDIENTE',
      atribuido: 'ASIGNADO',
      imprimindo: 'IMPRIMIENDO',
      concluido: 'COMPLETADO',
      falhou: 'FALLÓ',
      cancelado: 'CANCELADO'
    }
  },

  impressora: {
    maquina: 'MÁQUINA',
    reiniciar: 'Reiniciar el host de la impresora',
    desligar: 'Apagar el host de la impresora',
    reiniciarSemPermissao: 'Reiniciar el host (sin permiso)',
    desligarSemPermissao: 'Apagar el host (sin permiso)',
    reiniciarCurto: 'Reiniciar',
    desligarCurto: 'Apagar',
    confirmaReiniciar: (nome: string, imprimindo: boolean) =>
      `Reinicia el ordenador que ejecuta Klipper y Moonraker en ${nome}. La máquina desaparece del panel durante un minuto y vuelve sola.${
        imprimindo ? ' Se perderá la impresión en curso.' : ''
      }`,
    confirmaDesligar: (nome: string, imprimindo: boolean) =>
      `Apaga el ordenador que ejecuta Klipper y Moonraker en ${nome}. Solo vuelve si alguien enciende la máquina en persona.${
        imprimindo ? ' Se perderá la impresión en curso.' : ''
      }`,
    falhaEnergia: 'No se pudo enviar el comando.',
    fechar: 'Cerrar el panel',
    trabalho: 'TRABAJO',
    camada: (c: string) => `CAPA ${c}`,
    pausar: 'Pausar la impresión',
    continuar: 'Reanudar la impresión',
    cancelar: 'Cancelar la impresión',
    confirmaCancelar: (nome: string, job: string, pct: number) =>
      `Interrumpe ${job} en ${nome}, ahora al ${pct}%. No se puede retomar donde quedó: la pieza se pierde y la impresión empieza de cero.`,
    temperaturas: 'TEMPERATURAS',
    bico: 'Boquilla',
    mesa: 'Cama',
    alvoDe: (nome: string) => `Objetivo de ${nome} en grados Celsius`,
    faixa: (min: number, max: number) => `entre ${min} y ${max} °C`,
    desligarAquecedores: 'Apagar todos los calentadores',
    confirmaDesligarAquecedores: (nome: string, imprimindo: boolean) =>
      `Pone a cero el objetivo de todos los calentadores de ${nome} a la vez: boquilla, cama y lo demás que caliente.${
        imprimindo ? ' La impresión en curso sigue avanzando con la boquilla fría y se perderá.' : ''
      }`,
    falhaAlvo: 'No se pudo cambiar el objetivo.',
    cabeca: 'CABEZAL DE IMPRESIÓN',
    passo: 'PASO (MM)',
    passoGrupo: 'Paso del desplazamiento en milímetros',
    moverYTras: 'Mover Y hacia atrás',
    moverYFrente: 'Mover Y hacia adelante',
    moverXEsq: 'Mover X a la izquierda',
    moverXDir: 'Mover X a la derecha',
    subirZ: 'Subir Z',
    descerZ: 'Bajar Z',
    home: 'Origen en todos los ejes',
    posicaoDesconhecida: 'POSICIÓN DESCONOCIDA',
    macros: 'MACROS',
    fila: 'COLA DE ESTA IMPRESORA',
    filaVazia: 'nada en la cola de esta máquina',
    daFazenda: 'de la granja',
    iniciar: (arquivo: string) => `Autorizar e iniciar ${arquivo}`,
    iniciarOcupada: 'la impresora debe estar inactiva para empezar',
    iniciando: 'Iniciando…',
    aguardandoAutorizacao: 'ESPERANDO AUTORIZACIÓN',
    concluida: 'LA ÚLTIMA PIEZA SALIÓ ENTERA',
    reimprimir: (arquivo: string) => `Reimprimir ${arquivo}`,
    retirarPeca: 'Retira la pieza de la cama antes de empezar la siguiente.',
    falhaIniciar: 'No se pudo iniciar.'
  },

  cameras: {
    nenhuma: 'NINGUNA CÁMARA DISPONIBLE',
    verNoQuadrante: (nome: string) => `Ver ${nome} en el cuadrante`,
    semSinal: 'SIN SEÑAL',
    semCamera: 'SIN CÁMARA'
  },

  arquivos: {
    biblioteca: (n: number) => `BIBLIOTECA — ${n} ARCHIVOS`,
    agrupadoPor: 'AGRUPADO POR IMPRESORA',
    destinoGrupo: 'la impresora del grupo',
    semArquivos: 'ningún G-code en esta impresora',
    impressoraOffline: 'impresora desconectada — no se puede listar',
    recolher: (nome: string) => `Contraer ${nome}`,
    expandir: (nome: string) => `Expandir ${nome}`,
    contagem: (n: number) => `${n} ${n === 1 ? 'archivo' : 'archivos'}`,
    enviarPara: 'ENVIAR A',
    carregando: 'CARGANDO LA BIBLIOTECA…',
    erro: 'NO SE PUDIERON LISTAR LOS ARCHIVOS.',
    vazio: 'NO SE ENCONTRÓ NINGÚN G-CODE EN LAS IMPRESORAS DE LA GRANJA.',
    enfileirar: (nome: string) => `Enviar ${nome} a la cola`,
    enfileirarSemPermissao: 'Enviar a la cola (sin permiso)',
    previaDe: (nome: string) => `Vista previa de ${nome}`,
    enviado: (arquivo: string, destino: string) => `${arquivo} enviado a la cola (${destino}).`,
    falhaEnfileirar: 'No se pudo poner en cola.'
  },

  backups: {
    rotina: 'PROGRAMACIÓN',
    ultimoCiclo: 'ÚLTIMO CICLO',
    armazenado: 'ALMACENADO',
    falhas: 'FALLOS',
    diario: (hora: string) => `diario ${hora} · y al reconectar`,
    nunca: 'nunca',
    rodarTodas: 'Copiar toda la granja ahora',
    rodarSemPermissao: 'Copiar ahora (sin permiso)',
    rodarUma: (nome: string) => `Copiar ${nome} ahora`,
    restaurarDe: (nome: string) => `Restaurar una copia de ${nome} en otra impresora`,
    perfis: 'PERFILES',
    firmware: 'FIRMWARE/CALIB.',
    gcode: 'G-CODE',
    naFila: 'EN COLA — ESPERANDO A QUE LA IMPRESORA QUEDE INACTIVA',
    estados: { OK: 'OK', PARCIAL: 'PARCIAL', FALHOU: 'FALLÓ', NUNCA: 'NUNCA' },
    resultado: (iniciados: number, adiados: number, offline: number) => {
      const partes = [`${iniciados} en curso`];
      if (adiados > 0) partes.push(`${adiados} imprimiendo (se copiarán al quedar inactivas)`);
      if (offline > 0) partes.push(`${offline} desconectadas`);
      return `Copia: ${partes.join(' · ')}.`;
    },
    adiado: (nome: string) => `${nome} está imprimiendo — la copia se hará en cuanto quede inactiva.`,
    iniciado: (nome: string) => `Copia de ${nome} iniciada.`,
    falha: 'No se pudo iniciar la copia.',
    restaurarTitulo: 'RESTAURAR LA CONFIGURACIÓN',
    snapshotOrigem: 'COPIA DE ORIGEN',
    semSnapshot: 'ninguna copia guardada',
    destino: 'IMPRESORA DE DESTINO',
    mesmaMaquina: ' (la misma máquina)',
    restaurar: 'Restaurar',
    restaurando: 'Restaurando…',
    confirmaTitulo: 'Sobrescribir la configuración',
    confirmaTexto: (nome: string) =>
      `Los archivos de configuración de ${nome} se reemplazarán por los de la copia elegida. Lo que haya ahora y no esté en la copia se pierde. La máquina necesita un FIRMWARE_RESTART después.`,
    sobrescrever: 'Sobrescribir',
    restaurado: (n: number) => `Restauración completada: ${n} archivos de configuración enviados.`,
    falhaRestaurar: 'Falló la restauración.',
    plano: 'PLAN',
    resumoPlano: (secoes: string, horas: number, copias: number) =>
      `${secoes} · ${horas} h · ${copias} copias`,
    semSecao: 'nada seleccionado',
    secoes: {
      config: 'Configuración (printer.cfg, macros)',
      banco: 'Perfiles de Mainsail/Fluidd',
      sistema: 'Firmware y calibración',
      gcode: 'Biblioteca de G-code'
    },
    secoesCurtas: { config: 'config', banco: 'perfiles', sistema: 'firmware', gcode: 'G-code' },
    configurar: (nome: string) => `Configurar la copia de ${nome}`,
    configTitulo: 'CONFIGURACIÓN DE LA COPIA',
    oQueCopiar: 'QUÉ COPIAR',
    arquivosDeConfig: 'ARCHIVOS DE CONFIGURACIÓN',
    arquivosDica: 'Desmarca lo que no debe entrar. Un archivo nuevo en la impresora entra solo.',
    arquivosOffline: 'La impresora tiene que estar en la red para listar los archivos.',
    arquivosVazio: 'No hay archivos de configuración en la impresora.',
    intervalo: 'CADA CUÁNTAS HORAS',
    retencaoLabel: 'COPIAS GUARDADAS',
    padraoGlobal: (v: number) => `predeterminado (${v})`,
    retencaoAviso: (n: number) =>
      n === 1
        ? 'Guarda solo la copia más reciente; las anteriores se borran.'
        : `Guarda las ${n} más recientes; las anteriores se borran.`,
    salvar: 'Guardar',
    salvando: 'Guardando…',
    salvo: (nome: string) => `Configuración de copia de ${nome} guardada.`,
    falhaSalvar: 'No se pudo guardar la configuración.',
    copias: (nome: string) => `Copias guardadas de ${nome}`,
    copiasTitulo: 'COPIAS GUARDADAS',
    copiasVazio: 'Todavía no hay copias guardadas.',
    baixar: 'Descargar .zip',
    baixarComGcode: 'Descargar con el G-code',
    comGcode: (n: number) => `+ ${n} G-code`,
    fechar: 'Cerrar'
  },

  alertas: {
    carregando: 'CARGANDO…',
    nenhum: 'NINGUNA ALERTA ABIERTA.',
    selecione: 'ELIGE UNA ALERTA A LA IZQUIERDA.',
    severidade: (s: string) => `GRAVEDAD ${s.toUpperCase()}`,
    sevNomes: { critica: 'crítica', alta: 'alta', media: 'media', baixa: 'baja' },
    resolver: 'Marcar la alerta como resuelta',
    resolverSemPermissao: 'Resolver la alerta (sin permiso)',
    abrirImpressora: 'Abrir la impresora en el panel',
    semImagem: 'SIN IMAGEN DE ESE MOMENTO',
    frameDe: (nome: string) => `Imagen de la cámara en el momento de la alerta en ${nome}`,
    critico: 'CRÍTICO',
    bannerCritico: 'LA MÁQUINA ESTÁ DETENIDA — ACTÚE YA',
    titulos: {
      klipper_parado: 'Klipper detenido',
      erro_impressao: 'Impresión detenida por un error',
      impressora_offline: 'Impresora inaccesible',
      impressao_concluida: 'Impresión terminada',
      impressao_pausada: 'Impresión pausada',
      filamento_acabando: 'Se está acabando el filamento',
      camera_offline: 'Cámara desconectada',
      camera_muda: 'La cámara dejó de responder',
      backup_falhou: 'Falló la copia de seguridad',
      backup_recuperacao: 'Copia de recuperación realizada',
      backup_esperando: 'Copia esperando a que la impresora quede inactiva'
    } as Record<string, string>
  },

  notificacoes: {
    titulo: 'NOTIFICACIONES',
    subtitulo: 'Telegram',
    configurar: 'Configurar las notificaciones',
    ligadas: 'activas',
    desligadas: 'desactivadas',
    semToken: 'sin token del bot',
    paraChat: (c: string) => `al chat ${c}`,
    ultimoEnvio: (q: string) => `último envío ${q}`,
    nenhumEnvio: 'nada enviado todavía',
    ultimaFalha: (m: string) => `último fallo: ${m}`,
    ligar: 'Enviar alertas a Telegram',
    token: 'TOKEN DEL BOT',
    tokenDica: 'Crea el bot con @BotFather. El token nunca sale del servidor.',
    tokenGuardado: 'guardado — déjalo así para mantenerlo',
    chat: 'CHAT',
    chatDica: 'Habla con el bot y lee chat.id en /getUpdates. Un grupo empieza por -100.',
    quais: 'QUÉ AVISAR',
    resolucao: 'Avisar también cuando la alerta se resuelve sola',
    comandos: 'Responder a /status en el chat',
    comandosDica: 'Solo se atiende al chat de arriba. Es solo lectura: pausar o cancelar sigue exigiendo entrar en la app.',
    idioma: 'Los mensajes salen en portugués, el idioma en que el servidor escribe las alertas.',
    testar: 'Enviar prueba',
    testando: 'Enviando…',
    testeOk: 'mensaje enviado',
    salvar: 'Guardar',
    salvando: 'Guardando…',
    salvo: 'Notificaciones guardadas.',
    falhaSalvar: 'No se pudo guardar.',
    semPermissao: 'Solo un administrador configura las notificaciones.'
  },
  gestao: {
    titulo: (n: number) => `IMPRESORAS DE LA GRANJA — ${n}`,
    nova: 'Añadir una impresora',
    vazio: 'Todavía no hay impresoras. Añade la dirección de Moonraker de cada máquina — normalmente',
    camera: 'CÁMARA',
    semCamera: 'sin configurar',
    backupLigado: 'activada',
    backupDesligado: 'desactivada',
    backup: 'COPIA',
    chave: 'CLAVE',
    chaveDefinida: 'definida',
    chaveNenhuma: 'ninguna',
    remover: (nome: string) => `Quitar ${nome} de la granja`,
    removerTitulo: 'Quitar la impresora',
    removerTexto: (nome: string) =>
      `${nome} sale del panel, del muro de cámaras y del ciclo de copias. Las copias ya guardadas de esta máquina también se borran. La impresora en sí no se toca.`,
    editando: (id: string) => `EDITANDO ${id}`,
    novaKicker: 'NUEVA IMPRESORA',
    cadastrar: 'Añadir impresora',
    nome: 'NOMBRE',
    nomePlaceholder: 'Ender 3 V2 — A',
    url: 'URL DE MOONRAKER',
    urlPlaceholder: 'http://ender-a.local:7125',
    urlDica: 'Acepta un nombre .local (mDNS) o una IP. El puerto de Moonraker es 7125.',
    apiKey: 'API KEY (OPCIONAL)',
    apiKeyPlaceholder: 'déjalo vacío si Moonraker no la exige',
    cameraUrl: 'URL DE LA CÁMARA (OPCIONAL)',
    cameraPlaceholder: 'se detecta sola al probar la conexión',
    incluirBackup: 'Incluir en la copia diaria',
    testar: 'Probar conexión',
    testando: 'Probando…',
    testeOk: (host: string, versao: string) => `Conectado a ${host}, con ${versao}.`,
    testeCameraOk: ' La cámara respondió.',
    testeCameraFalhou: (erro: string) => ` La impresora respondió, pero la cámara no: ${erro}`,
    testeFalhou: (erro: string) => `Sin conexión: ${erro}`,
    testeErro: 'Falló la prueba.',
    naoSalvou: 'No se pudo guardar.',
    cameraDescoberta: (nome: string) => `Cámara detectada automáticamente (${nome}).`,
    cameraSemDeteccao: ' No se detectó ninguna cámara — puedes escribir la URL a mano.',
    previaCamera: 'Vista previa de la cámara'
  },

  erros: {
    semServidor: 'No se pudo contactar con el servidor.',
    generico: (n: number) => `Error ${n}`
  }
};
