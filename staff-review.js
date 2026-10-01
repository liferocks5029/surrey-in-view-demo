(function(root) {
  'use strict';
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
  }
  const same = (a,b) => JSON.stringify(stable(a || {})) === JSON.stringify(stable(b || {}));
  function changes(published, draft, projects = [], models = []) {
    const result = [];
    const before = published || {}, after = draft || {};
    for (const field of ['newApplications', 'projectOverrides', 'modelOverrides']) {
      const old = before[field] || {}, next = after[field] || {};
      for (const id of [...new Set([...Object.keys(old), ...Object.keys(next)])].sort()) {
        if (same(old[id], next[id])) continue;
        if (field === 'newApplications') {
          result.push((!next[id] ? 'Remove ' : !old[id] ? 'Add ' : 'Update ') + (next[id]?.display_name || old[id]?.display_name || id));
        } else if (field === 'projectOverrides') {
          const name = next[id]?.display_name || projects.find(p => p.project_no === id)?.display_name || id;
          result.push((next[id] ? 'Update ' : 'Restore original details for ') + name);
        } else {
          const model = models.find(m => m.model_id === id);
          result.push((next[id] ? 'Change building height for ' : 'Restore original height for ') + (model?.name || id));
        }
      }
    }
    return result;
  }
  const api = {changes};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SurreyStaffReview = api;
})(typeof window === 'object' ? window : globalThis);
