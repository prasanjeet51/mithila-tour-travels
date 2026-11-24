const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const INLINE_IMAGES = {
  LOGO: 'assets/logo.jpg',
  CAB_WAGONR: 'assets/cab-mini.jpg',
  CAB_DZIRE: 'assets/cab-sedan.jpg',
  CAB_INNOVA: 'assets/cab-suv.jpg',
};

function dataUri(file) {
  return 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, file)).toString('base64');
}

function checkEndpoint(url) {
  if (!url) return '';
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('bookingEndpoint must be an https URL, got: ' + url);
  return parsed.href;
}

function build(options = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const outDir = options.outDir || path.join(ROOT, 'dist');
  const endpoint = checkEndpoint(
    options.bookingEndpoint !== undefined ? options.bookingEndpoint : config.bookingEndpoint
  );

  const values = { BOOKING_ENDPOINT: endpoint };
  for (const [key, file] of Object.entries(INLINE_IMAGES)) values[key] = dataUri(file);

  const template = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');
  const html = template.replace(/%%([A-Z_]+)%%/g, (match, key) => {
    if (!(key in values)) throw new Error('template.html uses an unknown placeholder: ' + match);
    return values[key];
  });

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.cpSync(path.join(ROOT, 'assets'), path.join(outDir, 'assets'), {
    recursive: true,
    filter: (src) => !Object.values(INLINE_IMAGES).some((f) => src === path.join(ROOT, f)),
  });
  return { outDir, bytes: Buffer.byteLength(html), endpoint };
}

module.exports = { build };

if (require.main === module) {
  const result = build();
  console.log('Built ' + path.relative(ROOT, result.outDir) + '/index.html (' + result.bytes + ' bytes)');
  console.log(result.endpoint ? 'Booking log: on' : 'Booking log: off (bookingEndpoint is empty in site.config.json)');
}
