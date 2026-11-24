// Booking log for the MTT website. Paste into Extensions > Apps Script of the bookings Google Sheet,
// then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).

const SHEET_NAME = 'Bookings';
const NOTIFY_EMAIL = ''; // optional: an address to email on every new booking

const HEADERS = ['Received', 'Ref', 'Status', 'Trip', 'Pickup', 'Drop', 'Cab', 'Travel date', 'Pickup time', 'Phone', 'Distance (km)', 'Route map'];
const FIELDS = ['trip', 'pickup', 'drop', 'cab', 'date', 'time', 'phone', 'km', 'route'];

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: 'bad request' });
  }
  if (!/^\d{10}$/.test(String(data.phone || ''))) return reply_({ ok: false, error: 'bad phone' });

  const row = [new Date(), clean_(data.ref), 'New'].concat(FIELDS.map(function (f) { return clean_(data[f]); }));

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_().appendRow(row);
  } finally {
    lock.releaseLock();
  }

  if (NOTIFY_EMAIL) {
    MailApp.sendEmail(NOTIFY_EMAIL, 'New cab booking ' + row[1],
      HEADERS.map(function (h, i) { return h + ': ' + row[i]; }).join('\n'));
  }
  return reply_({ ok: true });
}

function sheet_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

// The endpoint is public: cap length and stop a value from being read as a spreadsheet formula.
function clean_(value) {
  const text = String(value === undefined || value === null ? '' : value).slice(0, 300);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
