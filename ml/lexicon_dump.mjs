// dumps the lexicon as json for training
import { STUDENT_LEXICON } from '../lib/lexicon.js';
process.stdout.write(JSON.stringify(STUDENT_LEXICON));
