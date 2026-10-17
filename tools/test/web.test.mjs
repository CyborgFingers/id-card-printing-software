// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// Unit tests for the screens' own logic (CSV import, card dates):   node --test tools/test/
// The service's logic is tested in C#: dotnet test desktop/tests/IdCard.Tests
import test from 'node:test';
import assert from 'node:assert/strict';

const { readPeople, isoDate, parseCSV, buildPhotoIndex, matchPhoto } = await import('../../web/js/csv.js');
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

test('CSV: a people export imports straight back', () => {
  const exported = '\ufeffFirst Name,Last Name,Staff ID Number,Position,Title,Address,Card Status,Notes,ID Photo,Times Printed,Last Printed\r\n'
    + "Lena,'=SUM(1+1),KH-006,Volunteer,Ms,,Active,,,0,\r\n"
    + 'Aroha,Ngata,KH-003,"Manager, Ward 4",Ms,,Active,,aroha.jpg,0,\r\n'
    + 'Mere,Tūhoe,KH-001,Kaiāwhina,Ms,"12 Example Street, Thorndon",Active,,mere.jpg,0,\r\n';
  const { people, warning } = readPeople(exported);
  assert.equal(warning, '');
  assert.deepEqual(people.map(p => [p.firstName, p.lastName, p.staffId, p.position, p.address, p.photoFile]), [
    ['Lena', '=SUM(1+1)', 'KH-006', 'Volunteer', '', ''],
    ['Aroha', 'Ngata', 'KH-003', 'Manager, Ward 4', '', 'aroha.jpg'],
    ['Mere', 'Tūhoe', 'KH-001', 'Kaiāwhina', '12 Example Street, Thorndon', 'mere.jpg']]);
});

test('ID photos match by file name, path, missing extension or the person\'s name', () => {
  const files = ['mere.jpg', 'sam-lee.png', 'aroha.jpg', 'ben_smith.jpg'].map(name => ({ name }));
  const idx = buildPhotoIndex(files);
  const m = (photoFile, firstName = 'X', lastName = 'Y') => matchPhoto(idx, { photoFile, firstName, lastName })?.name || null;
  assert.equal(m('mere.jpg'), 'mere.jpg');
  assert.equal(m('C:\\Photos\\SAM-LEE.PNG'), 'sam-lee.png');
  assert.equal(m('aroha'), 'aroha.jpg');
  assert.equal(m('', 'Ben', 'Smith'), 'ben_smith.jpg');
  assert.equal(m('missing.jpg', 'Mere', 'X'), null);   // a named file that isn't there never falls back to a name match
});

test('card dates in each format', () => {
  assert.equal(formatDate('2027-03-31', 'DD/MM/YYYY'), '31/03/2027');
  assert.equal(formatDate('2027-03-31', 'D MMM YYYY'), '31 Mar 2027');
  assert.equal(formatDate('2027-03-01', 'MMM YYYY'), 'Mar 2027');
  assert.equal(formatDate('2027-03-31', 'MM/YY'), '03/27');
  assert.equal(formatDate('2027-03-31'), '31/03/2027');
  assert.equal(formatDate('not a date', 'MM/YY'), 'not a date');
});
