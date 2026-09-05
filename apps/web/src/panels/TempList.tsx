import { useEffect, useRef, useState } from 'react';
import { Fan, Power, Thermometer } from 'lucide-react';
import type { Temperatura } from '@3dfarm/shared';
import { nomeBonito } from '@3dfarm/shared';
import type { Dicionario } from '../i18n/pt';
import { Confirm } from '../components/Confirm';
import { IconButton } from '../components/IconButton';
import { useT } from '../i18n';
import { useFormato } from '../i18n/formato';
import { api } from '../lib/api';

/** extruder1 é a segunda extrusora: o Klipper conta do zero, a tela conta do um. */
const EXTRUSORA_EXTRA = /^extruder(\d+)$/;

/**
 * Quanto o rascunho sobrevive sem confirmação do Klipper.
 *
 * Um alvo aceito volta pelo SSE em menos de um segundo. Este prazo é para o
 * caso contrário — comando recusado, impressora que sumiu no meio: passado
 * ele, o campo volta a mostrar o alvo real em vez do que foi pedido.
 */
const TTL_RASCUNHO_MS = 8_000;

/**
 * Nome do sensor na tela.
 *
 * Bico e mesa toda impressora tem, e ganham o rótulo do idioma. O resto foi
 * batizado por quem escreveu o printer.cfg — "chamber", "MCU", "raspberry_pi" —
 * e é esse nome que aparece: traduzir o que a pessoa nomeou seria inventar.
 * Só a forma muda, para não destoar dos rótulos ao lado: `nomeBonito`.
 */
export function rotuloDoSensor(temp: Temperatura, t: Dicionario): string {
  if (temp.chave === 'extruder') return t.impressora.bico;
  if (temp.chave === 'heater_bed') return t.impressora.mesa;
  const extra = EXTRUSORA_EXTRA.exec(temp.chave);
  if (extra) return `${t.impressora.bico} ${Number(extra[1]) + 1}`;
  return nomeBonito(temp.rotulo ?? temp.chave);
}

/**
 * Campo de alvo de um aquecedor.
 *
 * Enquanto a pessoa digita — e até o Klipper confirmar — vale o rascunho: o
 * Moonraker leva um instante para devolver o novo alvo, e um campo que volta
 * sozinho ao valor antigo no meio da digitação é impossível de usar.
 */
function CampoAlvo({
  printerId,
  temp,
  desabilitado,
  aoFalhar
}: {
  printerId: string;
  temp: Temperatura;
  desabilitado: boolean;
  aoFalhar: (msg: string) => void;
}) {
  const t = useT();
  const doKlipper = String(Math.round(temp.alvo && temp.alvo > 0 ? temp.alvo : 0));
  const [rascunho, setRascunho] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Esc desfaz, e o blur que vem logo depois não pode reenviar o que foi desfeito. */
  const desfeito = useRef(false);

  const soltar = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRascunho(null);
  };

  // o Klipper confirmou o que pedimos: o rascunho já não tem o que segurar
  useEffect(() => {
    if (rascunho !== null && rascunho === doKlipper) soltar();
    // de propósito só `doKlipper`: reagir ao próprio rascunho apagaria a
    // digitação a cada tecla
  }, [doKlipper]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const enviar = () => {
    if (rascunho === null) return;
    // vírgula decimal é o que sai do teclado em pt/es/fr/it
    const bruto = rascunho.replace(',', '.').trim();
    const n = Number(bruto);
    if (bruto === '' || !Number.isFinite(n) || n < 0) return soltar();

    const alvo = Math.round(n);
    if (String(alvo) === doKlipper) return soltar();

    setRascunho(String(alvo));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(soltar, TTL_RASCUNHO_MS);
    void api.definirAlvo(printerId, temp.chave, alvo).catch((err) => {
      aoFalhar(err instanceof Error ? err.message : t.impressora.falhaAlvo);
      soltar();
    });
  };

  const faixa = temp.max != null ? t.impressora.faixa(temp.min ?? 0, temp.max) : undefined;

  return (
    <input
      type="text"
      inputMode="decimal"
      value={rascunho ?? doKlipper}
      disabled={desabilitado}
      title={faixa}
      aria-label={t.impressora.alvoDe(rotuloDoSensor(temp, t))}
      onChange={(e) => setRascunho(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        if (desfeito.current) {
          desfeito.current = false;
          return;
        }
        enviar();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          desfeito.current = true;
          soltar();
          e.currentTarget.blur();
        }
      }}
      style={{
        width: 46,
        padding: '2px 5px',
        textAlign: 'right',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        background: 'transparent',
        border: `1px solid var(--color-neutral-${desabilitado ? '800' : '700'})`,
        color: `var(--color-${desabilitado ? 'neutral-700' : 'bg'})`,
        cursor: desabilitado ? 'not-allowed' : 'text'
      }}
    />
  );
}

/**
 * Temperaturas — design/README.md § 2.4.
 *
 * Bico e mesa primeiro, depois o que a máquina tiver: a câmara aquecida, a
 * ventoinha por temperatura e, no fim, os sensores de leitura — MCU, host,
 * termistor da caixa. Quem aquece traz o alvo editável ao lado; quem só mede
 * mostra o número e nada mais.
 */
export function TempList({
  printerId,
  nomeDaImpressora,
  imprimindo,
  temperaturas,
  desabilitado
}: {
  printerId: string;
  nomeDaImpressora: string;
  imprimindo: boolean;
  temperaturas: Temperatura[];
  desabilitado: boolean;
}) {
  const t = useT();
  const f = useFormato();
  const [erro, setErro] = useState<string | null>(null);
  /*
   * Zerar tudo é um clique só, ao lado de campos que se mexem o dia inteiro, e
   * não tem desfazer: com uma impressão em curso ele a mata. Daí a pergunta.
   */
  const [confirmando, setConfirmando] = useState(false);
  if (temperaturas.length === 0) return null;

  const desligarTudo = () => {
    setConfirmando(false);
    setErro(null);
    void api.desligarAquecedores(printerId).catch((err) => {
      setErro(err instanceof Error ? err.message : t.impressora.falhaAlvo);
    });
  };

  const temAquecedor = temperaturas.some((temp) => temp.tipo === 'aquecedor');

  return (
    <>
      <section style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="mono">{t.impressora.temperaturas}</div>
          {temAquecedor && (
            <IconButton
              rotulo={t.impressora.desligarAquecedores}
              variante="secundaria"
              pequeno
              disabled={desabilitado}
              style={{ marginLeft: 'auto' }}
              onClick={() => setConfirmando(true)}
              icone={<Power size={14} strokeWidth={2} aria-hidden />}
            />
          )}
        </div>

        {temperaturas.map((temp) => {
          const soLeitura = temp.tipo === 'sensor';
          const Icone = temp.tipo === 'ventoinha' ? Fan : Thermometer;
          const nome = rotuloDoSensor(temp, t);
          return (
            <div key={temp.chave} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icone size={14} strokeWidth={2} aria-hidden style={{ color: 'var(--color-neutral-400)', flex: 'none' }} />
              <span
                title={nome}
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  fontFamily: 'var(--font-heading)',
                  /* o que só mede fica um tom abaixo do que se pode comandar */
                  color: soLeitura ? 'var(--color-neutral-300)' : 'var(--color-bg)',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {nome}
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  flex: 'none',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12
                }}
              >
                {f.temperatura(temp.atual)}
                {!soLeitura && (
                  <>
                    <span style={{ color: 'var(--color-neutral-500)' }}>/</span>
                    <CampoAlvo printerId={printerId} temp={temp} desabilitado={desabilitado} aoFalhar={setErro} />
                    <span style={{ color: 'var(--color-neutral-500)' }}>°C</span>
                  </>
                )}
              </span>
            </div>
          );
        })}

        {erro && (
          <div role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-accent-400)' }}>
            {erro}
          </div>
        )}
      </section>

      <Confirm
        aberto={confirmando}
        titulo={t.impressora.desligarAquecedores}
        descricao={t.impressora.confirmaDesligarAquecedores(nomeDaImpressora, imprimindo)}
        rotuloConfirmar={t.impressora.desligarCurto}
        onConfirmar={desligarTudo}
        onCancelar={() => setConfirmando(false)}
      />
    </>
  );
}
