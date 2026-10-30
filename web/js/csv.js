// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// CSV reading for bulk print: handles quotes, BOM, comma / semicolon / tab, and loose header names.
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;   // a quote only opens a quoted field at its start (12" Pipe Rd stays literal)
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const FIRST = ['firstname', 'first', 'givenname', 'given', 'forename', 'fname', 'preferredname'];
const LAST = ['lastname', 'last', 'surname', 'familyname', 'lname'];
const STAFF = ['staffidnumber', 'staffid', 'staffno', 'staffnumber', 'idnumber', 'employeeid', 'employeenumber', 'employeeno', 'reference', 'ref'];
const POSITION = ['position', 'jobtitle', 'role', 'jobrole', 'designation'];
const TITLE = ['title', 'salutation', 'honorific', 'prefix'];
const ADDRESS = ['address', 'streetaddress', 'homeaddress', 'postaladdress'];
const PHOTO = ['idphoto', 'photo', 'photofile', 'photofilename', 'image', 'imagefile', 'picture', 'pic', 'filename', 'file', 'photoname', 'idphotofile'];

// Dates as NZ spreadsheets write them (31/03/2027, 31-3-27) or YYYY-MM-DD; anything else is left for the service to reject.
export function isoDate(v) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(v || '');
  if (!m) return v;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// `custom`: the person fields added in Settings; their columns are matched by name.
export function readPeople(text, custom = []) {
  const rows = parseCSV(text);
  if (!rows.length) return { people: [], warning: 'The CSV file is empty.' };
  const head = rows[0].map(norm);
  let fi = head.findIndex(h => FIRST.includes(h));
  let li = head.findIndex(h => LAST.includes(h));
  let pi = head.findIndex(h => PHOTO.includes(h));
  const col = (list) => head.findIndex(h => list.includes(h));
  const si = col(STAFF), poi = col(POSITION), ti = col(TITLE), ai = col(ADDRESS);
  const ci = custom.map(f => [f, head.indexOf(norm(f.label))]).filter(([, i]) => i >= 0);
  let body = rows.slice(1); let warning = '';
  if (fi < 0 && li < 0) {
    // No recognised header row: assume First Name, Last Name, ID Photo order.
    fi = 0; li = 1; pi = 2; body = rows; warning = 'No header row found, so columns were read as First Name, Last Name, ID Photo.';
  }
  // Exports put ' in front of values starting with = + - or @ (so spreadsheets don't run them): take it off again.
  const cell = (r, i) => i >= 0 ? (r[i] || '').trim().replace(/^'(?=[=+\-@])/, '') : '';
  const people = body.map((r, i) => ({
    row: i + 1,
    firstName: cell(r, fi),
    lastName: cell(r, li),
    photoFile: cell(r, pi),
    staffId: cell(r, si),
    position: cell(r, poi),
    title: cell(r, ti),
    address: cell(r, ai),
    ...Object.fromEntries(ci.map(([f, i]) => { const v = cell(r, i); return [f.key, f.type === 'date' ? isoDate(v) : v]; })),
  }));
  return { people, warning };
}

// A name as a photo name: letters and numbers only, any case, macrons and accents dropped
// ("John Smith", "JOHN_SMITH" and "johnsmith" are the same; "Tūhoe" matches "Tuhoe").
export const nameKey = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Matches a CSV photo reference (file name or full path) against the chosen photo files.
export function buildPhotoIndex(files) {
  const map = new Map();
  for (const f of files) {
    const n = f.name.toLowerCase(), base = n.replace(/\.[^.]+$/, '');
    map.set(n, f);
    map.set(base, f);
    if (!map.has(nameKey(base))) map.set(nameKey(base), f);
  }
  return map;
}
export function matchPhoto(index, person) {
  const ref = (person.photoFile || '').split(/[\\/]/).pop().toLowerCase().trim();
  if (ref) return index.get(ref) || index.get(ref.replace(/\.[^.]+$/, '')) || null;
  // No file named: the photo is named after the person, first name then last name (or last name first).
  const f = person.firstName, l = person.lastName;
  return (nameKey(f + l) && index.get(nameKey(f + l))) || (nameKey(l + f) && index.get(nameKey(l + f))) || null;
}

// Bulk update: what a CSV and/or a set of photos would change for the people already in a client. Rows and photos
// are matched to people by name (first name then last name, as for photos). A blank cell leaves that detail as it is,
// and names are never changed (they're how people are found). `fields`: the detail keys a CSV can set (built-in and
// custom); `value(person, key)` reads a person's current value. Each entry:
//   { person, row, file, changes, problem }   problem: null (ready), 'noChange', 'notFound' (a row matching nobody),
//   'sameName' (more than one person has that name, so it's not clear whose it is) or 'twice' (in the CSV twice).
// `unusedFiles`: photos that matched nobody.
export function planUpdate(existing, rows, files, fields, value) {
  const people = new Map();
  for (const p of existing) { const k = nameKey(p.firstName + p.lastName); if (k) people.set(k, [...(people.get(k) || []), p]); }
  const index = buildPhotoIndex(files), used = new Set(), byName = new Map(), entries = [];
  const photo = (who) => { const f = matchPhoto(index, who); if (f) used.add(f); return f; };
  const add = (e) => { entries.push(e); return e; };
  for (const row of rows) {
    const k = nameKey(row.firstName + row.lastName), found = people.get(k) || [];
    if (!found.length) { add({ person: null, row, file: null, changes: {}, problem: 'notFound' }); continue; }
    if (byName.has(k)) { for (const e of byName.get(k)) if (e.problem !== 'sameName') Object.assign(e, { problem: 'twice', changes: {}, file: null }); add({ person: found[0], row, file: null, changes: {}, problem: 'twice' }); continue; }
    if (found.length > 1) { photo(row); byName.set(k, found.map(person => add({ person, row, file: null, changes: {}, problem: 'sameName' }))); continue; }
    const person = found[0], changes = {};
    for (const f of fields) if (row[f] && row[f] !== (value(person, f) || '')) changes[f] = row[f];
    byName.set(k, [add({ person, row, file: photo(row.photoFile ? row : person), changes, problem: null })]);
  }
  // Photos for people the CSV didn't list (or with no CSV at all).
  if (files.length) for (const [k, found] of people) {
    if (byName.has(k)) continue;
    const file = photo(found[0]);
    if (file) for (const person of found) add({ person, row: null, file: found.length > 1 ? null : file, changes: {}, problem: found.length > 1 ? 'sameName' : null });
  }
  for (const e of entries) if (!e.problem && !e.file && !Object.keys(e.changes).length) e.problem = 'noChange';
  return { entries, unusedFiles: files.filter(f => !used.has(f)) };
}
