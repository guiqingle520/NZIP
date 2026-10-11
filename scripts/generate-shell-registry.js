// Keep the MSI's existing registry templates in sync with the native format catalog.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = fs.readFileSync(path.join(root, 'native/ArchiveFormats.cs'), 'utf8');
const declaration = catalog.match(/ReadExtensions=\{([^}]+)\}/);
if (!declaration) throw Error('Native read-format catalog not found');
const extensions = [...declaration[1].matchAll(/"([a-z0-9]+)"/g)].map(m => m[1]);
if (new Set(extensions).size !== extensions.length || !extensions.includes('zip')) throw Error('Invalid read-format catalog');
const filename = path.join(root, 'installer/shell-registry.json');
const current = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
const keyFormat = /^(Software\\Classes\\)\.([a-z0-9]+)(\\OpenWithProgids)$/i;
const contextFormat = /^(Software\\Classes\\SystemFileAssociations\\)\.([a-z0-9]+)(\\shell\\NZIP(?:\\.*)?)$/i;
function extensionOf(row) {
  const matched = row.key.match(keyFormat) || row.key.match(contextFormat);
  if (matched) return matched[2];
  if (['Software\\Classes\\Applications\\NZIP.exe\\SupportedTypes', 'Software\\NZIP\\Capabilities\\FileAssociations'].includes(row.key)) return row.name.slice(1);
  return null;
}
const templates = current.filter(row => extensionOf(row) === 'zip');
if (templates.length !== 16) throw Error(`Expected 16 ZIP registry templates; got ${templates.length}`);
const updated = current.filter(row => extensionOf(row) === null);
for (const ext of extensions) for (const template of templates) {
  const row = { ...template };
  if (keyFormat.test(row.key) || contextFormat.test(row.key)) row.key = row.key.replace(/\.zip(?=\\)/i, '.' + ext);
  else row.name = '.' + ext;
  updated.push(row);
}
fs.writeFileSync(filename, JSON.stringify(updated));
console.log(`Shell registry catalog: ${extensions.length} extensions, ${updated.length} values.`);
