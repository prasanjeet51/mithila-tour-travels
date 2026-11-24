const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

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
  if (/^\/[\w\-/]*$/.test(url)) return url;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('bookingEndpoint must be a site path or an https URL, got: ' + url);
  return parsed.href;
}

function build() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const values = { BOOKING_ENDPOINT: checkEndpoint(config.bookingEndpoint) };
  for (const [key, file] of Object.entries(INLINE_IMAGES)) values[key] = dataUri(file);

  const template = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');
  const html = template.replace(/%%([A-Z_]+)%%/g, (match, key) => {
    if (!(key in values)) throw new Error('template.html uses an unknown placeholder: ' + match);
    return values[key];
  });

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  fs.cpSync(path.join(ROOT, 'admin'), path.join(OUT, 'admin'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'assets'), path.join(OUT, 'assets'), {
    recursive: true,
    filter: (src) => !Object.values(INLINE_IMAGES).some((f) => src === path.join(ROOT, f)),
  });

  console.log('Built dist/ (index.html ' + Buffer.byteLength(html) + ' bytes, admin panel, assets)');
  console.log(values.BOOKING_ENDPOINT ? 'Bookings are saved to ' + values.BOOKING_ENDPOINT : 'Bookings are not saved (bookingEndpoint is empty)');
}

build();
