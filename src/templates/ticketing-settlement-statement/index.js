// Ticketing & settlement statement (docs/DISCOVERY.md A8 §7): ticket sales, platform charges with GST, final
// settlement and acknowledgement, title and meta repeated on every page (src/render/statementTemplate.js).
import { ticketingModule } from '../../render/statementTemplate.js';

export const { computed, blocks, renderPdf } = ticketingModule;
