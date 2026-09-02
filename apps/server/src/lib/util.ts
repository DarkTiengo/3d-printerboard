import { farm } from '../services/farm.js';
import { acharPrinter } from '../services/printers.repo.js';

/** Nome da impressora para textos de alerta, com o id como último recurso. */
export function farmPrinterNome(id: string): string {
  return farm.printer(id)?.nome ?? acharPrinter(id)?.nome ?? id;
}
