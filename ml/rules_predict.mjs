// Reads a JSON array of texts on stdin, prints the rule engine's predictions as JSON.
// Used by ml/classifier.py to compare the ML model with the keyword rules on the same hold-out set.
import { predictByRules } from '../lib/rules.js';

let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  const texts = JSON.parse(input);
  process.stdout.write(JSON.stringify(texts.map(t => predictByRules(t, {}))));
});
