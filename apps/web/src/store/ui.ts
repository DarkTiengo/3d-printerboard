import { create } from 'zustand';

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

  irPara: (tela: Tela) => void;
  selecionar: (id: string | null) => void;
  focarCamera: (id: string | null) => void;
  abrirAlerta: (id: number | null) => void;
  definirPasso: (p: string) => void;
  definirPassoExtrusao: (mm: number) => void;
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

  irPara: (tela) => set({ tela }),
  selecionar: (sel) => set({ sel }),
  focarCamera: (camFoco) => set({ camFoco }),
  abrirAlerta: (alertaSel) => set({ alertaSel }),
  definirPasso: (passo) => set({ passo }),
  definirPassoExtrusao: (passoExtrusao) => set({ passoExtrusao }),
  abrirImpressora: (id) => set({ tela: 'dash', sel: id })
}));
