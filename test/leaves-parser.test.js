// node --test test/leaves-parser.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseLeavePDF } = require('../lib/leaves-parser');

// Real decoded-text pattern from the live Zoho Daily Leave Status PDFs.
// CID decoding produces: header text + rows of OD<id><Name><email><details><status>
// Name and email are concatenated without a separator.
function makeText(date, rows) {
  const header = ` :${date}Employee IdEmployee NameEmailLeave type nameLeave TypeReasonApproval Status`;
  return header + rows.map(r =>
    `OD${r.id}${r.fullName}${r.email}Annual VacationPaidAnnualVacation${r.status || 'Approved'}`
  ).join('');
}

// ── parseLeavePDF: name extraction ───────────────────────────────────────────

describe('parseLeavePDF — date extraction', () => {
  test('returns [] when no YYYY-MM-DD date in text', () => {
    assert.deepEqual(parseLeavePDF('no date here OD001 Foo foofoo@okiedokiepay.com Approved'), []);
  });

  test('extracts date correctly', () => {
    const text = makeText('2026-10-24', [{ id: '2302', fullName: 'Sukhmeet Singh', email: 'sukhmeet.singh@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    assert.equal(result[0]?.date, '2026-10-24');
  });
});

describe('parseLeavePDF — name extraction from concatenated text', () => {
  test('two-part name: Sukhmeet Singh', () => {
    const text = makeText('2026-10-23', [{ id: '2302', fullName: 'Sukhmeet Singh', email: 'sukhmeet.singh@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Sukhmeet Singh');
  });

  test('two-part name: Aanchal Dhiman', () => {
    const text = makeText('2026-10-24', [{ id: '1234', fullName: 'Aanchal Dhiman', email: 'aanchal.dhiman@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    assert.equal(result[0]?.name, 'Aanchal Dhiman');
  });

  test('two-part name: Mansi Rana', () => {
    const text = makeText('2026-10-14', [{ id: '1111', fullName: 'Mansi Rana', email: 'mansi.rana@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    assert.equal(result[0]?.name, 'Mansi Rana');
  });

  test('two-part name: Bhavey Saluja', () => {
    const text = makeText('2026-10-22', [{ id: '5555', fullName: 'Bhavey Saluja', email: 'bhavey.saluja@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    assert.equal(result[0]?.name, 'Bhavey Saluja');
  });

  test('two-part name: Sneha Garg', () => {
    const text = makeText('2026-10-21', [{ id: '2222', fullName: 'Sneha Garg', email: 'sneha.garg@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    assert.equal(result[0]?.name, 'Sneha Garg');
  });

  test('two-part name: Sudha Yadav', () => {
    const text = makeText('2026-10-10', [{ id: '3333', fullName: 'Sudha Yadav', email: 'sudha.yadav@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    assert.equal(result[0]?.name, 'Sudha Yadav');
  });

  test('two-part name: Akshat Wahi', () => {
    const text = makeText('2026-10-10', [{ id: '4444', fullName: 'Akshat Wahi', email: 'akshat.wahi@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    assert.equal(result[0]?.name, 'Akshat Wahi');
  });

  test('three-part name with three-part email: Amar Kumar Pandit', () => {
    const text = makeText('2026-10-15', [{ id: '9999', fullName: 'Amar Kumar Pandit', email: 'amar.kumar.pandit@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    assert.equal(result[0]?.name, 'Amar Kumar Pandit');
  });

  test('three-part name with two-part email degrades gracefully', () => {
    // Email only has first.last; name has an extra component.
    const text = makeText('2026-10-15', [{ id: '9999', fullName: 'Amar Kumar Pandit', email: 'amar.kumar@okiedokiepay.com' }]);
    const result = parseLeavePDF(text);
    // "Kumar" is found → name = "Amar Kumar" (partial, but usable with prefix merge)
    assert.equal(result[0]?.name, 'Amar Kumar');
  });
});

describe('parseLeavePDF — status filtering', () => {
  test('excludes Cancelled leaves', () => {
    const text = makeText('2026-10-20', [
      { id: '0001', fullName: 'Sukhmeet Singh', email: 'sukhmeet.singh@okiedokiepay.com', status: 'Cancelled' },
    ]);
    assert.equal(parseLeavePDF(text).length, 0);
  });

  test('includes Approved leaves', () => {
    const text = makeText('2026-10-20', [
      { id: '0001', fullName: 'Sukhmeet Singh', email: 'sukhmeet.singh@okiedokiepay.com', status: 'Approved' },
    ]);
    assert.equal(parseLeavePDF(text).length, 1);
  });

  test('includes Pending leaves', () => {
    const text = makeText('2026-10-20', [
      { id: '0001', fullName: 'Sukhmeet Singh', email: 'sukhmeet.singh@okiedokiepay.com', status: 'Pending' },
    ]);
    assert.equal(parseLeavePDF(text).length, 1);
  });

  test('mixed: keeps Approved, drops Cancelled', () => {
    const text = makeText('2026-10-20', [
      { id: '0001', fullName: 'Sukhmeet Singh', email: 'sukhmeet.singh@okiedokiepay.com', status: 'Approved' },
      { id: '0002', fullName: 'Aanchal Dhiman', email: 'aanchal.dhiman@okiedokiepay.com', status: 'Cancelled' },
      { id: '0003', fullName: 'Mansi Rana', email: 'mansi.rana@okiedokiepay.com', status: 'Pending' },
    ]);
    const result = parseLeavePDF(text);
    assert.equal(result.length, 2);
    assert.ok(result.some(e => e.name === 'Sukhmeet Singh'));
    assert.ok(result.some(e => e.name === 'Mansi Rana'));
    assert.ok(!result.some(e => e.name === 'Aanchal Dhiman'));
  });
});

describe('parseLeavePDF — multiple employees', () => {
  test('returns one entry per non-cancelled employee', () => {
    const text = makeText('2026-10-21', [
      { id: '2302', fullName: 'Sukhmeet Singh', email: 'sukhmeet.singh@okiedokiepay.com' },
      { id: '1234', fullName: 'Aanchal Dhiman', email: 'aanchal.dhiman@okiedokiepay.com' },
      { id: '5678', fullName: 'Bhavey Saluja', email: 'bhavey.saluja@okiedokiepay.com' },
    ]);
    const result = parseLeavePDF(text);
    assert.equal(result.length, 3);
    assert.deepEqual(result.map(e => e.name).sort(), ['Aanchal Dhiman', 'Bhavey Saluja', 'Sukhmeet Singh']);
    assert.ok(result.every(e => e.date === '2026-10-21'));
  });
});
