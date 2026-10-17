// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// Unit tests for the screens' own logic (CSV import, card dates):   node --test tools/test/
// The service's logic is tested in C#: dotnet test desktop/tests/IdCard.Tests
import test from 'node:test';
import assert from 'node:assert/strict';

const { readPeople, isoDate, parseCSV } = await import('../../web/js/csv.js');
const { formatDate } = await import('../../web/js/render.js');

test('CSV: NZ day-first dates and custom columns', () => {
  assert.equal(isoDate('31/03/2027'), '2027-03-31');
  assert.equal(isoDate('1-4-27'), '2027-04-01');
  assert.equal(isoDate('2027-03-31'), '2027-03-31');
  assert.equal(isoDate('next year'), 'next year');
  const custom = [{ key: 'cf_exp', label: 'Expiry date', type: 'date' }, { key: 'cf_dep', label: 'Department', type: 'text' }];
  const { people } = readPeople('First Name,Last Name,Expiry Date,Department\nMere,Tūhoe,31/03/2028,Kaitiaki\n', custom);
  assert.equal(people[0].cf_exp, '2028-03-31'); assert.equal(people[0].cf_dep, 'Kaitiaki'); assert.equal(people[0].lastName, 'Tūhoe');
  assert.deepEqual(parseCSV('a,b\n12" Pipe Rd,x\n'), [['a', 'b'], ['12" Pipe Rd', 'x']]);
});

test('card dates in each format', () => {
  assert.equal(formatDate('2027-03-31', 'DD/MM/YYYY'), '31/03/2027');
  assert.equal(formatDate('2027-03-31', 'D MMM YYYY'), '31 Mar 2027');
  assert.equal(formatDate('2027-03-01', 'MMM YYYY'), 'Mar 2027');
  assert.equal(formatDate('2027-03-31', 'MM/YY'), '03/27');
  assert.equal(formatDate('2027-03-31'), '31/03/2027');
  assert.equal(formatDate('not a date', 'MM/YY'), 'not a date');
});
