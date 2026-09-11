/** Serialize saves for each mutable editor draft without replacing edits made in flight. */
export function createAutomationAutosaver({ save, onSaved = () => {}, onState = () => {}, validate = () => {}, delay = 700 }) {
  const entries = new Map();
  let disposed = false;
  const dirty = draft => Boolean(draft.isNew || draft.name !== draft.savedName || draft.source !== draft.savedSource || draft.enabled !== draft.savedEnabled);
  const entryFor = draft => {
    if (!entries.has(draft)) entries.set(draft, { timer: null, flight: null, requested: false, drain: false });
    return entries.get(draft);
  };
  const clearTimer = entry => { clearTimeout(entry.timer); entry.timer = null; };
  const report = (draft, status, error) => { if (!disposed) onState(draft, status, error); };
  const check = draft => {
    if (draft.conflict) {
      const error = new Error(draft.error || '事件已在其他位置修改，请重新加载后再编辑');
      error.status = 409;
      throw error;
    }
    const message = validate(draft);
    if (typeof message === 'string' && message) throw new Error(message);
  };
  const fail = (draft, entry, error, status) => {
    clearTimer(entry);
    entry.requested = false;
    entry.drain = false;
    draft.error = error.message || String(error);
    if (Number(error.status ?? error.statusCode) === 409) draft.conflict = true;
    report(draft, status, error);
  };

  function start(draft, entry, drain = false) {
    entry.requested = true;
    entry.drain ||= drain;
    if (entry.flight) return entry.flight;
    entry.flight = Promise.resolve().then(async () => {
      while (!disposed && entry.requested) {
        entry.requested = false;
        if (!dirty(draft)) { draft.error = ''; report(draft, 'saved'); break; }
        try { check(draft); } catch (error) { fail(draft, entry, error, draft.conflict ? 'error' : 'invalid'); throw error; }
        const submitted = { name: draft.name, source: draft.source, enabled: draft.enabled };
        const payload = { name: draft.name.trim(), source: draft.source, enabled: draft.enabled, revision: draft.revision };
        draft.error = '';
        report(draft, 'saving');
        let saved;
        try { saved = await save(draft, payload); }
        catch (error) { fail(draft, entry, error, 'error'); throw error; }

        // Acknowledgements always advance the revision, including after navigation.
        // Only normalize fields which still equal the values actually submitted.
        for (const field of ['name', 'source', 'enabled']) {
          if (draft[field] === submitted[field]) draft[field] = saved[field];
        }
        Object.assign(draft, {
          id: saved.id, revision: saved.revision, isNew: false,
          savedName: saved.name, savedSource: saved.source, savedEnabled: saved.enabled,
          error: '', conflict: false,
        });
        onSaved(draft, saved);
        if (disposed) break;
        if (entry.drain && dirty(draft)) entry.requested = true;
        if (dirty(draft)) {
          try { check(draft); }
          catch (error) { fail(draft, entry, error, draft.conflict ? 'error' : 'invalid'); throw error; }
          report(draft, 'pending');
        } else report(draft, 'saved');
      }
    }).finally(() => { entry.flight = null; entry.drain = false; });
    return entry.flight;
  }

  function schedule(draft) {
    if (disposed) return;
    const entry = entryFor(draft);
    clearTimer(entry);
    if (!dirty(draft)) { draft.error = ''; report(draft, 'saved'); return; }
    try { check(draft); }
    catch (error) { fail(draft, entry, error, draft.conflict ? 'error' : 'invalid'); return; }
    draft.error = '';
    report(draft, 'pending');
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!disposed) void start(draft, entry).catch(() => {});
    }, delay);
  }

  async function flush(draft) {
    if (disposed) return;
    const entry = entryFor(draft);
    clearTimer(entry);
    await start(draft, entry, true);
  }

  function cancel(draft) {
    const entry = entries.get(draft);
    if (!entry) return;
    clearTimer(entry);
    entry.requested = false;
    entry.drain = false;
  }

  async function idle(draft) {
    // A barrier for deletion / disabling: an invalid unsaved draft must not block
    // those operations. flush() is the operation that requires a successful save.
    try { await entries.get(draft)?.flight; } catch {}
  }

  function dispose() {
    disposed = true;
    for (const entry of entries.values()) {
      clearTimer(entry);
      entry.requested = false;
      entry.drain = false;
    }
  }

  return { schedule, flush, cancel, idle, dispose };
}
