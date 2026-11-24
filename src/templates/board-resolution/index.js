// Board resolution (docs/DISCOVERY.md A8 §11): certified extract of a board resolution with director lists and a
// three-column certification block (src/render/boardResolutionTemplate.js).
import { boardResolutionModule } from '../../render/boardResolutionTemplate.js';

export const { computed, blocks, renderPdf } = boardResolutionModule;
