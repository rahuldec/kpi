// Google Apps Script — auto-populates the Leaves Sheet from the daily Drive PDF.
//
// HOW TO SET UP (one-time):
//   1. Create a Google Sheet with two columns:  Date | Name
//      (header row, then leave rows below — no other columns needed)
//   2. File → Share → Publish to web → Sheet1 → CSV → Publish.
//      Copy the published URL and add it as LEAVES_CSV_URL in Vercel.
//   3. Open the Sheet → Extensions → Apps Script → paste this code.
//   4. Run processNewLeaves() once manually to backfill all existing PDFs.
//   5. Add a Time-driven trigger: Triggers → Add trigger → processNewLeaves
//      → Time-driven → Day timer → 5am–6am (IST is UTC+5:30, so 5am IST = 11:30pm UTC
//        the previous day — pick "23:00 to 00:00" UTC).
//
// WHAT IT DOES:
//   Each run lists every PDF in the Drive folder. For each date not already in
//   the Sheet it converts the PDF to a temporary Google Doc (which lets Apps
//   Script read the text), parses employee names and statuses, writes one row
//   per non-cancelled leave entry, then deletes the temporary Doc.
//
// CONFIG — update these two constants:
var FOLDER_ID  = '15WPsMyE1FoP-yXc5xvbiXgAC7rDbZ4Xb';
var SHEET_NAME = 'Sheet1';   // tab name in your Leaves Sheet

function processNewLeaves() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  // Build a set of dates already recorded so we skip them.
  var existingDates = new Set();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var d = data[i][0];
    if (d) existingDates.add(String(d).trim());
  }

  var folder = DriveApp.getFolderById(FOLDER_ID);
  var files  = folder.getFilesByType('application/pdf');
  var newRows = [];

  while (files.hasNext()) {
    var file = files.next();
    var text = extractPDFText(file);
    if (!text) continue;

    // Parse the date line: "Date : 2026-10-05"
    var dateMatch = text.match(/Date\s*:\s*(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    var date = dateMatch[1];
    if (existingDates.has(date)) continue;   // already processed

    // Each leave line contains an @okiedokiepay.com address.
    var lines = text.split('\n');
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (!/@okiedokiepay\.com/.test(line)) continue;

      // Skip Cancelled entries.
      if (/\bCancelled\b/i.test(line)) continue;

      // Extract the employee name: text between the OD-number and the email.
      var nameMatch = line.match(/OD\d+\s+(.+?)\s+[\w.]+@okiedokiepay\.com/);
      if (!nameMatch) continue;
      var name = nameMatch[1].trim();
      if (!name) continue;

      newRows.push([date, name]);
    }
    existingDates.add(date);   // prevent double-adding from two runs in one day
  }

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 2).setValues(newRows);
  }
}

// Converts a PDF file to a temporary Google Doc, reads its text, then
// deletes the Doc. Works for text-based (non-scanned) PDFs.
function extractPDFText(file) {
  var tempDoc = null;
  try {
    var resource = {
      title: '_leaves_extract_temp',
      mimeType: 'application/vnd.google-apps.document',
    };
    tempDoc = Drive.Files.insert(resource, file.getBlob(), { convert: true });
    var text = DocumentApp.openById(tempDoc.id).getBody().getText();
    return text;
  } catch (e) {
    Logger.log('extractPDFText error for ' + file.getName() + ': ' + e);
    return null;
  } finally {
    if (tempDoc) {
      try { Drive.Files.remove(tempDoc.id); } catch (e2) { /* ignore cleanup failure */ }
    }
  }
}
