import { isEciaFormat, parseEciaFields } from './src/parsers/EciaParser';

const text = '[)>\x1E06\x1D1PLM358\x1DQ100\x1D';
console.log('isEciaFormat:', isEciaFormat(text));
const fields = parseEciaFields(text);
console.log('fields:', Array.from(fields.entries()));
