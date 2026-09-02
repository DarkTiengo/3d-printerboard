import { useState } from 'react';
import { Archive, Clock, FileText, LayoutGrid, LogOut, OctagonX, SlidersHorizontal, Video } from 'lucide-react';
import type { User } from '@3dfarm/shared';
import { pode } from '@3dfarm/shared';
import { useUi, type Tela } from '../store/ui';
import { IDIOMAS, codigoDoIdioma, nomeDoIdioma, useIdioma, useT } from '../i18n';
import { usePrinters, usePrintersVisiveis } from '../store/printers';
import { IconButton } from './IconButton';
import { Confirm } from './Confirm';
import { Tooltip } from './Tooltip';
import { api } from '../lib/api';

const ABAS: { tela: Tela; Icone: typeof LayoutGrid }[] = [
  { tela: 'dash', Icone: LayoutGrid },
  { tela: 'cams', Icone: Video },
  { tela: 'files', Icone: FileText },
  { tela: 'backup', Icone: Archive },
  { tela: 'alerts', Icone: Clock }
];

const ROTULO_ABA: Record<Tela, keyof ReturnType<typeof useT>['barra']> = {
  dash: 'painel',
  cams: 'cameras',
  files: 'arquivos',
  backup: 'backups',
  alerts: 'alertas',
  config: 'gerir'
};

/**
 * Barra superior — design/README.md § 2.
 *
 * As cinco abas primárias são o grupo do design. Gestão e sair entram como
 * botões secundários à direita, para não diluir esse grupo.
 */
export function TopBar({ usuario, aoSair }: { usuario: User; aoSair: () => void }) {
  const t = useT();
  const idioma = useIdioma((s) => s.idioma);
  const definirIdioma = useIdioma((s) => s.definirIdioma);
  const tela = useUi((s) => s.tela);
  const irPara = useUi((s) => s.irPara);
  const printers = usePrintersVisiveis();
  const alertas = usePrinters((s) => s.alertas);
  const fila = usePrinters((s) => s.fila);
  const conectado = usePrinters((s) => s.conectado);

  const [confirmarParada, setConfirmarParada] = useState(false);
  const [resultadoParada, setResultadoParada] = useState<string | null>(null);

  const ativas = printers.filter((p) => p.status === 'imprimindo' || p.status === 'atenção').length;
  const atencao = printers.filter((p) => p.status === 'atenção').length;
  const podeParar = pode(usuario.role, 'pararEmergencia');

  async function dispararParada() {
    setConfirmarParada(false);
    try {
      const r = await api.paradaEmergencia();
      setResultadoParada(
        r.ok ? t.barra.paradaEnviada(r.total) : t.barra.paradaFalhou(r.falhas.join(', '))
      );
    } catch (err) {
      setResultadoParada(err instanceof Error ? err.message : t.barra.paradaErro);
    }
  }

  return (
    <>
      <header
        style={{
          minHeight: 'var(--barra-altura)',
          borderBottom: '2px solid var(--color-neutral-700)',
          padding: '16px 22px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          flex: 'none'
        }}
      >
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 19, letterSpacing: '0.02em' }}>
          3D PRINTERBOARD
        </span>

        <nav aria-label={t.barra.painel} style={{ display: 'flex', gap: 4 }}>
          {ABAS.map(({ tela: alvo, Icone }) => (
            <IconButton
              key={alvo}
              rotulo={t.barra[ROTULO_ABA[alvo]] as string}
              variante={tela === alvo ? 'abaAtiva' : 'abaInativa'}
              aria-current={tela === alvo ? 'page' : undefined}
              onClick={() => irPara(alvo)}
              icone={<Icone size={17} strokeWidth={2} aria-hidden />}
            />
          ))}
        </nav>

        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-neutral-400)',
            marginRight: 'auto'
          }}
        >
          {t.barra.resumo(ativas, fila.length, atencao)}
          {alertas.length > 0 && t.barra.alertas_n(alertas.length)}
          {!conectado && t.barra.semConexao}
        </span>

        <SeletorDeIdioma
          idioma={idioma}
          aoTrocar={definirIdioma}
          rotulo={t.idioma.trocar}
        />

        {pode(usuario.role, 'gerirImpressoras') && (
          <IconButton
            rotulo={t.barra.gerir}
            variante={tela === 'config' ? 'abaAtiva' : 'secundaria'}
            onClick={() => irPara('config')}
            icone={<SlidersHorizontal size={16} strokeWidth={2} aria-hidden />}
          />
        )}

        <IconButton
          rotulo={t.barra.sairCom(usuario.username)}
          variante="secundaria"
          onClick={aoSair}
          icone={<LogOut size={16} strokeWidth={2} aria-hidden />}
        />

        <IconButton
          rotulo={podeParar ? t.barra.paradaEmergencia : t.barra.paradaSemPermissao}
          variante="primaria"
          disabled={!podeParar}
          onClick={() => setConfirmarParada(true)}
          icone={<OctagonX size={19} strokeWidth={2} aria-hidden />}
        />
      </header>

      <Confirm
        aberto={confirmarParada}
        titulo={t.barra.paradaEmergencia}
        descricao={t.barra.confirmaParada(printers.length)}
        rotuloConfirmar={t.barra.pararTudo}
        onConfirmar={dispararParada}
        onCancelar={() => setConfirmarParada(false)}
      />

      <Confirm
        aberto={!!resultadoParada}
        titulo={t.barra.paradaEmergencia}
        descricao={resultadoParada}
        rotuloConfirmar={t.comum.entendi}
        perigoso={false}
        semCancelar
        onConfirmar={() => setResultadoParada(null)}
        onCancelar={() => setResultadoParada(null)}
      />
    </>
  );
}

/**
 * Troca de idioma. Com dois idiomas um botão que alterna é mais direto que um
 * menu, e o código visível ("PT"/"EN") já diz onde se está.
 */
function SeletorDeIdioma({
  idioma,
  aoTrocar,
  rotulo
}: {
  idioma: (typeof IDIOMAS)[number];
  aoTrocar: (i: (typeof IDIOMAS)[number]) => void;
  rotulo: string;
}) {
  const proximo = IDIOMAS[(IDIOMAS.indexOf(idioma) + 1) % IDIOMAS.length];

  return (
    <Tooltip texto={`${rotulo} — ${nomeDoIdioma(proximo)}`}>
      <button
        type="button"
        onClick={() => aoTrocar(proximo)}
        aria-label={`${rotulo} — ${nomeDoIdioma(proximo)}`}
        style={{
          width: 40,
          height: 40,
          flex: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 999,
          border: '1px solid var(--color-neutral-700)',
          background: 'transparent',
          color: 'var(--color-neutral-300)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.06em',
          cursor: 'pointer'
        }}
      >
        {codigoDoIdioma(idioma)}
      </button>
    </Tooltip>
  );
}
