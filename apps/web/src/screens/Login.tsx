import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Check, LoaderCircle } from 'lucide-react';
import type { User } from '@3dfarm/shared';
import { ApiError, api } from '../lib/api';
import { Ponto } from '../components/Tag';
import s from './Login.module.css';

type Estatistica = { rotulo: string; valor: string };

const CHAVE_USUARIO = 'printerboard.usuario';

export function Login({ aoEntrar }: { aoEntrar: (u: User) => void }) {
  const [usuario, setUsuario] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_USUARIO) ?? '';
    } catch {
      return '';
    }
  });
  const [senha, setSenha] = useState('');
  const [lembrar, setLembrar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [campoRuim, setCampoRuim] = useState<'usuario' | 'senha' | null>(null);

  const [servidorOk, setServidorOk] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Estatistica[]>([
    { rotulo: 'IMPRESSORAS', valor: '—' },
    { rotulo: 'ARQUIVOS', valor: '—' },
    { rotulo: 'ÚLTIMO BACKUP', valor: '—' }
  ]);

  /**
   * Pulso do servidor para o rodapé. É a mesma origem desta página, então isto
   * responde à pergunta que importa: o agregador está de pé por trás do front,
   * ou só o arquivo estático sobreviveu?
   */
  useEffect(() => {
    let cancelado = false;

    const bater = async () => {
      try {
        const res = await fetch('/api/saude', { credentials: 'include' });
        if (!cancelado) setServidorOk(res.ok);
      } catch {
        if (!cancelado) setServidorOk(false);
      }
    };

    void bater();
    const timer = setInterval(bater, 15_000);
    return () => {
      cancelado = true;
      clearInterval(timer);
    };
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setCampoRuim(null);

    if (!usuario.trim()) {
      setCampoRuim('usuario');
      setErro('Informe o usuário.');
      return;
    }
    if (!senha) {
      setCampoRuim('senha');
      setErro('Informe a senha.');
      return;
    }

    setEnviando(true);
    try {
      const { usuario: user } = await api.login(usuario.trim(), senha, lembrar);
      try {
        if (lembrar) localStorage.setItem(CHAVE_USUARIO, usuario.trim());
        else localStorage.removeItem(CHAVE_USUARIO);
      } catch {
        /* sem storage, seguimos assim mesmo */
      }
      aoEntrar(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setErro('O servidor não respondeu. Verifique se o container ainda está no ar.');
      } else if (err instanceof ApiError && err.status === 401) {
        setCampoRuim('senha');
        setErro('Usuário ou senha inválidos.');
      } else {
        setErro(err instanceof Error ? err.message : 'Não foi possível entrar.');
      }
      setEnviando(false);
    }
  }

  return (
    <div className={s.tela}>
      <div className={s.foto}>
        <img className={s.fotoFundo} src="/login.jpg" alt="" aria-hidden />
        <div className={s.fotoVeu} aria-hidden />

        <div className={`${s.camada} ${s.marca}`}>
          <span className={s.marcaQuadrado} aria-hidden />
          <span className={s.marcaTexto}>3D PRINTERBOARD</span>
        </div>

        <div className={`${s.camada} ${s.chamadaBloco}`}>
          <h1 className={s.chamada}>Toda a fazenda em uma tela só.</h1>
          <p className={s.subChamada}>
            Câmeras ao vivo, controle de impressão, biblioteca de arquivos e backup diário das configurações de cada
            máquina.
          </p>
        </div>

        <div className={`${s.camada} ${s.numeros}`}>
          {stats.map((e) => (
            <div key={e.rotulo} className={s.numero}>
              <div className={s.numeroRotulo}>{e.rotulo}</div>
              <div className={s.numeroValor}>{e.valor}</div>
            </div>
          ))}
        </div>
      </div>

      <form className={s.form} onSubmit={enviar} noValidate>
        <div>
          <div className={s.kicker}>ACESSO AO SERVIDOR</div>
          <h2 className={s.titulo}>Entrar</h2>
        </div>

        <div className={s.campos}>
          <label className={s.campo}>
            <span className={s.campoRotulo}>USUÁRIO</span>
            <input
              className={`${s.entrada} ${campoRuim === 'usuario' ? s.entradaErro : ''}`}
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="operador"
              autoComplete="username"
              autoFocus={!usuario}
              aria-invalid={campoRuim === 'usuario'}
            />
          </label>

          <label className={s.campo}>
            <span className={s.campoRotulo}>SENHA</span>
            <input
              className={`${s.entrada} ${campoRuim === 'senha' ? s.entradaErro : ''}`}
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              autoFocus={!!usuario}
              aria-invalid={campoRuim === 'senha'}
            />
          </label>
        </div>

        <div className={s.linhaOpcoes}>
          <button type="button" className={s.lembrar} onClick={() => setLembrar((v) => !v)} aria-pressed={lembrar}>
            <span className={`${s.check} ${lembrar ? s.checkMarcado : ''}`}>
              {lembrar && <Check size={12} strokeWidth={3} aria-hidden />}
            </span>
            <span>Manter conectado</span>
          </button>
          <a href="#recuperar" onClick={(e) => e.preventDefault()} style={{ fontSize: 13 }}>
            Esqueci a senha
          </a>
        </div>

        {erro && (
          <div className={s.erro} role="alert">
            {erro}
          </div>
        )}

        <button type="submit" className={s.entrar} disabled={enviando}>
          {enviando ? (
            <>
              <LoaderCircle size={17} strokeWidth={2} aria-hidden style={{ animation: 'girar 900ms linear infinite' }} />
              <span>Entrando…</span>
            </>
          ) : (
            <>
              <span>Entrar</span>
              <ArrowRight size={17} strokeWidth={2} aria-hidden />
            </>
          )}
        </button>

        <div className={s.rodape}>
          <Ponto
            cor={
              servidorOk === null
                ? 'var(--color-neutral-600)'
                : servidorOk
                  ? 'var(--color-accent)'
                  : 'var(--color-accent-700)'
            }
          />
          <span>
            {servidorOk === null
              ? 'verificando servidor…'
              : servidorOk
                ? `servidor respondendo · ${window.location.host}`
                : 'servidor fora do ar'}
          </span>
        </div>
      </form>

      <style>{`@keyframes girar { to { transform: rotate(360deg); } }`}</style>
      <EstatisticasDoServidor pronto={servidorOk === true} aoCarregar={setStats} />
    </div>
  );
}

/**
 * A faixa de números do design mostra dados da fazenda, que só existem depois do
 * login. Antes disso ficam em "—" — mentir números na tela de acesso seria pior
 * do que mostrar que ainda não sabemos.
 */
function EstatisticasDoServidor({
  pronto,
  aoCarregar
}: {
  pronto: boolean;
  aoCarregar: (e: Estatistica[]) => void;
}) {
  useEffect(() => {
    if (!pronto) return;
    let cancelado = false;

    (async () => {
      try {
        const [printers, arquivos, backups] = await Promise.all([
          fetch('/api/printers', { credentials: 'include' }),
          fetch('/api/arquivos', { credentials: 'include' }),
          fetch('/api/backups', { credentials: 'include' })
        ]);
        // 401 é o normal aqui: ainda não há sessão
        if (!printers.ok || cancelado) return;

        const lista = await printers.json();
        const arqs = arquivos.ok ? await arquivos.json() : [];
        const bk = backups.ok ? await backups.json() : null;

        aoCarregar([
          { rotulo: 'IMPRESSORAS', valor: String(lista.length) },
          { rotulo: 'ARQUIVOS', valor: String(arqs.length) },
          { rotulo: 'ÚLTIMO BACKUP', valor: bk?.resumo?.ultimoCiclo ?? '—' }
        ]);
      } catch {
        /* sem sessão ainda: mantém os travessões */
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [pronto, aoCarregar]);

  return null;
}
