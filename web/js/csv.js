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
    const n = f.name.toLowerCase();
    map.set(n, f);
    map.set(n.replace(/\.[^.]+$/, ''), f);
  }
  return map;
}
export function matchPhoto(index, person) {
  const ref = (person.photoFile || '').split(/[\\/]/).pop().toLowerCase().trim();
  return ref ? index.get(ref) || index.get(ref.replace(/\.[^.]+$/, '')) || null : null;
}

// Photos named after people: a photo is a person's when its name has their first and last name next to each other,
// either way round, with or without other words ("Jane Doe ID Photo Good.jpg", "DOE Jane 2026.heic", "JaneDoe.jpg").
// A photo named just the name beats one with other words. Each person gets { file } (null when none), or
// { problem, files } and no photo: 'several' (more than one photo is theirs) or 'shared' (a photo is just as much
// someone else's: two people with the same name, or two names in one photo name). A photo that's one person's whole
// name isn't anyone else's ("Mary Jane Doe.jpg" isn't Jane Doe's).
const words = (s) => s.replace(/\.[^.]+$/, '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export function photosByName(files, people) {
  const runs = new Map();   // every run of neighbouring words in a photo name, joined → [{ file, exact }]
  for (const file of files) {
    const w = words(file.name);
    for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= w.length; j++) {
      const k = w.slice(i, j).join(''); runs.set(k, [...(runs.get(k) || []), { file, exact: i === 0 && j === w.length }]);
    }
  }
  const claims = new Map(), best = new Map();   // person → { exact, files };  file → { exact, people } with the best claim on it
  for (const p of people) {
    const hits = [...new Set([nameKey(p.firstName + p.lastName), nameKey(p.lastName + p.firstName)])].filter(Boolean).flatMap(k => runs.get(k) || []);
    const exact = hits.some(h => h.exact), mine = [...new Set(hits.filter(h => h.exact === exact).map(h => h.file))];
    claims.set(p, { exact, files: mine });
    for (const f of mine) { const b = best.get(f); if (!b || (exact && !b.exact)) best.set(f, { exact, people: [p] }); else if (b.exact === exact) b.people.push(p); }
  }
  const out = new Map();
  for (const [p, c] of claims) {
    const files = c.files.filter(f => best.get(f).people.includes(p));
    out.set(p, files.length > 1 ? { problem: 'several', files } : files.length && best.get(files[0]).people.length > 1 ? { problem: 'shared', files } : { file: files[0] || null });
  }
  return out;
}

// Bulk update: what a CSV and/or a set of photos would change for the people already in a client. Rows are matched
// to people by name, and photos as photosByName. A blank cell leaves that detail as it is, and names are never changed
// (they're how people are found). `fields`: the detail keys a CSV can set (built-in and custom); `value(person, key)`
// reads a person's current value. Each entry:
//   { person, row, file, files, changes, problem, photoProblem }   problem: null (ready), 'noChange', 'notFound' (a row
//   matching nobody), 'sameName' (more than one person has that name, so it's not clear whose it is), 'twice' (in the
//   CSV twice), or a photo's 'several' / 'shared' when that was all there was to change. photoProblem: the photo's
//   problem when there are other changes (the photo is then left as it is); `files`: the photos it's about.
// `unusedFiles`: photos that matched nobody.
export function planUpdate(existing, rows, files, fields, value) {
  const people = new Map();
  for (const p of existing) { const k = nameKey(p.firstName + p.lastName); if (k) people.set(k, [...(people.get(k) || []), p]); }
  const index = buildPhotoIndex(files), named = photosByName(files, existing), used = new Set(), byName = new Map(), entries = [];
  // A person's photo: the file their CSV row names, else the one named after them.
  const photo = (person, row) => { const m = row?.photoFile ? { file: matchPhoto(index, row) } : named.get(person); for (const f of m.files || [m.file]) if (f) used.add(f); return m; };
  const add = (e) => { entries.push(e); return e; };
  for (const row of rows) {
    const k = nameKey(row.firstName + row.lastName), found = people.get(k) || [];
    if (!found.length) { add({ person: null, row, file: null, changes: {}, problem: 'notFound' }); continue; }
    if (byName.has(k)) { for (const e of byName.get(k)) if (e.problem !== 'sameName') Object.assign(e, { problem: 'twice', changes: {}, file: null, photoProblem: null }); add({ person: found[0], row, file: null, changes: {}, problem: 'twice' }); continue; }
    if (found.length > 1) { photo(found[0], row); byName.set(k, found.map(person => add({ person, row, file: null, changes: {}, problem: 'sameName' }))); continue; }
    const person = found[0], changes = {}, m = photo(person, row);
    for (const f of fields) if (row[f] && row[f] !== (value(person, f) || '')) changes[f] = row[f];
    byName.set(k, [add({ person, row, file: m.file || null, files: m.files, changes, problem: null, photoProblem: m.problem || null })]);
  }
  // Photos for people the CSV didn't list (or with no CSV at all).
  if (files.length) for (const [k, found] of people) {
    if (byName.has(k)) continue;
    for (const person of found) { const m = photo(person); if (m.file || m.problem) add({ person, row: null, file: found.length > 1 ? null : m.file || null, files: m.files, changes: {}, problem: found.length > 1 ? 'sameName' : m.problem || null }); }
  }
  for (const e of entries) if (!e.problem && !e.file && !Object.keys(e.changes).length) [e.problem, e.photoProblem] = [e.photoProblem || 'noChange', null];
  return { entries, unusedFiles: files.filter(f => !used.has(f)) };
}
