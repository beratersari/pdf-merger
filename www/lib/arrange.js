export function normalizeRotation(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const quarter = Math.round(number / 90) * 90;
  return ((quarter % 360) + 360) % 360;
}

function clonePage(page) {
  return {
    uid: page.uid,
    docId: page.docId,
    pageIndex: page.pageIndex,
    rotation: normalizeRotation(page.rotation || 0),
  };
}

function asSet(value) {
  if (value instanceof Set) return value;
  return new Set(value);
}

export function moveEarlier(pages, selected) {
  const chosen = asSet(selected);
  const next = pages.map(clonePage);
  for (let index = 1; index < next.length; index += 1) {
    if (chosen.has(next[index].uid) && !chosen.has(next[index - 1].uid)) {
      const previous = next[index - 1];
      next[index - 1] = next[index];
      next[index] = previous;
    }
  }
  return next;
}

export function moveLater(pages, selected) {
  const chosen = asSet(selected);
  const next = pages.map(clonePage);
  for (let index = next.length - 2; index >= 0; index -= 1) {
    if (chosen.has(next[index].uid) && !chosen.has(next[index + 1].uid)) {
      const following = next[index + 1];
      next[index + 1] = next[index];
      next[index] = following;
    }
  }
  return next;
}

export function reorder(pages, movingUids, insertBeforeIndex) {
  const moving = asSet(movingUids);
  const block = [];
  const rest = [];
  for (const page of pages) {
    if (moving.has(page.uid)) block.push(clonePage(page));
    else rest.push(clonePage(page));
  }
  const end = Number.isInteger(insertBeforeIndex)
    ? Math.max(0, Math.min(insertBeforeIndex, pages.length))
    : pages.length;
  let destination = 0;
  for (let index = 0; index < end; index += 1) {
    if (!moving.has(pages[index].uid)) destination += 1;
  }
  rest.splice(destination, 0, ...block);
  return rest;
}

export function removeUids(pages, uids) {
  const drop = asSet(uids);
  return pages.filter((page) => !drop.has(page.uid)).map(clonePage);
}

export function rotateUids(pages, uids, delta = 90) {
  const targets = asSet(uids);
  return pages.map((page) => {
    const copy = clonePage(page);
    if (!targets.has(page.uid)) return copy;
    return { ...copy, rotation: normalizeRotation((page.rotation || 0) + delta) };
  });
}

export function missingSourcePages(docId, pageCount, pages) {
  const present = new Set();
  for (const page of pages) {
    if (page.docId === docId) present.add(page.pageIndex);
  }
  const missing = [];
  for (let index = 0; index < pageCount; index += 1) {
    if (!present.has(index)) missing.push(index);
  }
  return missing;
}
