// Prints the built-in keyword lexicon as JSON ({category: [keywords]}); used as weak training data.
import { STUDENT_LEXICON } from '../lib/lexicon.js';
process.stdout.write(JSON.stringify(STUDENT_LEXICON));
