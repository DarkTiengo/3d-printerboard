import { create } from 'zustand';
import { EXTRUSAO_MM_S_PADRAO } from '@gridfarm/shared';

export type Tela = 'dash' | 'cams' | 'files' | 'backup' | 'alerts' | 'config';

type UiState = {
  tela: Tela;
  /** id da impressora selecionada no painel, ou null */
  sel: string | null;
  /** id da câmera em foco na tela de Câmeras */
  camFoco: string | null;
  /** alerta aberto na coluna de detalhe */
  alertaSel: number | null;
  /** passo do jog em mm — 0.1 / 1 / 10 / 100 */
  passo: string;
  /** quanto filamento cada clique da extrusora move, em mm */
  passoExtrusao: number;
  /** com que rapidez ele move, em mm/s */
  velocidadeExtrusao: number;
  /*
   * As duas seções compridas do painel. Ficam abertas por padrão — quem pediu
   * um console e um gráfico quer vê-los, não procurá-los — mas quem fecha uma
   * não a encontra aberta de novo ao trocar de impressora.
   */
  graficoAberto: boolean;
  consoleAberto: boolean;

  irPara: (tela: Tela) => void;
  selecionar: (id: string | null) => void;
  focarCamera: (id: string | null) => void;
  abrirAlerta: (id: number | null) => void;
  definirPasso: (p: string) => void;
  definirPassoExtrusao: (mm: number) => void;
  definirVelocidadeExtrusao: (mms: number) => void;
  alternarGrafico: () => void;
  alternarConsole: () => void;
  /** vem da tela de Alertas: "abrir impressora" leva ao painel já selecionado */
  abrirImpressora: (id: string) => void;
};

export const useUi = create<UiState>((set) => ({
  tela: 'dash',
  sel: null,
  camFoco: null,
  alertaSel: null,
  passo: '1',
  passoExtrusao: 10,
  velocidadeExtrusao: EXTRUSAO_MM_S_PADRAO,
  graficoAberto: true,
  consoleAberto: true,

  irPara: (tela) => set({ tela }),
  selecionar: (sel) => set({ sel }),
  focarCamera: (camFoco) => set({ camFoco }),
  abrirAlerta: (alertaSel) => set({ alertaSel }),
  definirPasso: (passo) => set({ passo }),
  definirPassoExtrusao: (passoExtrusao) => set({ passoExtrusao }),
  definirVelocidadeExtrusao: (velocidadeExtrusao) => set({ velocidadeExtrusao }),
  alternarGrafico: () => set((s) => ({ graficoAberto: !s.graficoAberto })),
  alternarConsole: () => set((s) => ({ consoleAberto: !s.consoleAberto })),
  abrirImpressora: (id) => set({ tela: 'dash', sel: id })
}));
