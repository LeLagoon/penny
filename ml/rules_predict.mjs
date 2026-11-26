// stdin: json array of texts, stdout: rule predictions (used by classifier.py for the baseline)
import { predictByRules } from '../lib/rules.js';

let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  const texts = JSON.parse(input);
  process.stdout.write(JSON.stringify(texts.map(t => predictByRules(t, {}))));
});
