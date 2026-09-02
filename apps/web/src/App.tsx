import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@3dfarm/shared';
import { api } from './lib/api';
import { useStream } from './lib/stream';
import { usePrinters } from './store/printers';
import { useUi } from './store/ui';
import { TopBar } from './components/TopBar';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { Cameras } from './screens/Cameras';
import { Files } from './screens/Files';
import { Backups } from './screens/Backups';
import { Alerts } from './screens/Alerts';
import { Settings } from './screens/Settings';

export function App() {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [verificando, setVerificando] = useState(true);
  const tela = useUi((s) => s.tela);
  const irPara = useUi((s) => s.irPara);
  const definirPrinters = usePrinters((s) => s.definirPrinters);
  const definirFila = usePrinters((s) => s.definirFila);
  const definirAlertas = usePrinters((s) => s.definirAlertas);

  // sessão em cookie httpOnly: só o servidor sabe se ela vale
  useEffect(() => {
    let cancelado = false;
    api
      .eu()
      .then(({ usuario: u }) => !cancelado && setUsuario(u))
      .catch(() => {})
      .finally(() => !cancelado && setVerificando(false));
    return () => {
      cancelado = true;
    };
  }, []);

  useStream(!!usuario);

  // carga inicial dos recursos que o SSE só atualiza depois
  const { data: printers } = useQuery({ queryKey: ['printers'], queryFn: api.printers, enabled: !!usuario });
  const { data: fila } = useQuery({ queryKey: ['fila'], queryFn: api.fila, enabled: !!usuario });
  const { data: alertas } = useQuery({ queryKey: ['alertas'], queryFn: api.alertas, enabled: !!usuario });

  useEffect(() => {
    if (printers) definirPrinters(printers);
  }, [printers, definirPrinters]);
  useEffect(() => {
    if (fila) definirFila(fila);
  }, [fila, definirFila]);
  useEffect(() => {
    if (alertas) definirAlertas(alertas);
  }, [alertas, definirAlertas]);

  const sair = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUsuario(null);
      irPara('dash');
    }
  }, [irPara]);

  if (verificando) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <span className="mono">CARREGANDO…</span>
      </div>
    );
  }

  if (!usuario) return <Login aoEntrar={setUsuario} />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar usuario={usuario} aoSair={() => void sair()} />
      {tela === 'dash' && <Dashboard usuario={usuario} />}
      {tela === 'cams' && <Cameras usuario={usuario} />}
      {tela === 'files' && <Files usuario={usuario} />}
      {tela === 'backup' && <Backups usuario={usuario} />}
      {tela === 'alerts' && <Alerts usuario={usuario} />}
      {tela === 'config' && <Settings />}
    </div>
  );
}
