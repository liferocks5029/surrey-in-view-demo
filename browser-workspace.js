(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SurreyBrowserWorkspace = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const HEIGHT_PREFIX = 'Staff-edited / unverified — ';
  const MAX_NEW_APPLICATIONS = 100;
  const MAX_IMPORT_BYTES = 990000;
  const MAX_STORAGE_BYTES = 3 * 1024 * 1024;
  const HISTORY_LIMIT = 10;
  const APPLICATION_NUMBER = /^(?:[0-9]{2}|[0-9]{4})-[0-9]{4}-[0-9]{2}(?![\s\S])/;
  const CONFLICT = 'This workspace changed in another tab. Export your unsaved work, then reload before saving.';
  const empty = () => ({schemaVersion: 1, projectOverrides: {}, modelOverrides: {}, newApplications: {}});
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length;
  const keysAre = (value, required, optional = []) => object(value) &&
    required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
  const put = (object, key, value) => Object.defineProperty(object, key, {value, enumerable: true, writable: true, configurable: true});

  class StoreError extends Error {
    constructor(message, status = 400) { super(message); this.name = 'StoreError'; this.status = status; }
  }
  function text(value, name, minimum, maximum) {
    if (typeof value !== 'string') throw new StoreError(name + ' must be text.');
    value = value.trim();
    const length = Array.from(value).length;
    if (length < minimum || length > maximum || /[\u0000-\u0008\u000b-\u001f]/.test(value))
      throw new StoreError(name + ' must contain ' + minimum + '–' + maximum + ' characters without control characters.');
    return value;
  }
  function sourceURL(value) {
    value = text(value, 'Source link', 1, 2048);
    try {
      const url = new URL(value);
      const authority = value.split('/')[2];
      if (!/^https:\/\//i.test(value) || url.protocol !== 'https:' || !url.hostname ||
          url.username || url.password || authority.includes('@') || /[\s\\]/.test(value) ||
          (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))) throw Error();
    } catch { throw new StoreError('Source link must be an HTTPS URL without credentials or spaces.'); }
    return value;
  }

  // JSON.parse alone accepts repeated object keys and overflowing numbers. Check
  // the original import text before its field values can be discarded/coerced.
  function parseJSON(raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES)
      throw new StoreError('Choose a JSON file smaller than 990 KB.', 413);
    let value;
    try { value = JSON.parse(raw); } catch { throw new StoreError('Use a valid JSON file or request.'); }
    let offset = 0;
    const whitespace = () => { while (/\s/.test(raw[offset] || '') && offset < raw.length) offset++; };
    const string = () => {
      const start = offset++;
      while (offset < raw.length) {
        if (raw[offset++] === '"') break;
        if (raw[offset - 1] === '\\') offset++;
      }
      return JSON.parse(raw.slice(start, offset));
    };
    const scan = depth => {
      if (depth > 50) throw new StoreError('The JSON file is nested too deeply.');
      whitespace();
      if (raw[offset] === '{') {
        const keys = new Set(); offset++; whitespace();
        if (raw[offset] === '}') { offset++; return; }
        while (offset < raw.length) {
          whitespace(); const key = string();
          if (keys.has(key)) throw new StoreError('Duplicate JSON keys are not allowed.');
          keys.add(key); whitespace(); offset++; scan(depth + 1); whitespace();
          if (raw[offset++] === '}') return;
        }
      } else if (raw[offset] === '[') {
        offset++; whitespace();
        if (raw[offset] === ']') { offset++; return; }
        while (offset < raw.length) {
          scan(depth + 1); whitespace(); if (raw[offset++] === ']') return;
        }
      } else if (raw[offset] === '"') string();
      else {
        const start = offset;
        while (offset < raw.length && !/[\s,\]}]/.test(raw[offset])) offset++;
        const primitive = JSON.parse(raw.slice(start, offset));
        if (typeof primitive === 'number' && !Number.isFinite(primitive)) throw new StoreError('JSON numbers must be finite.');
      }
    };
    scan(0);
    return value;
  }

  function storageKey(pathname = '/') {
    const path = typeof pathname === 'string' && pathname.startsWith('/') ? pathname.split(/[?#]/)[0] : '/';
    return 'surrey-browser-workspace:v1:' + path.slice(0, path.lastIndexOf('/') + 1);
  }

  function createWorkspace(options = {}) {
    const key = storageKey(options.pathname === undefined ? root.location?.pathname : options.pathname);
    const clock = options.now || (() => new Date().toISOString());
    const locks = options.locks === undefined ? root.navigator?.locks : options.locks;
    const fetchData = options.fetch || (root.fetch && root.fetch.bind(root));
    let baselinePromise, initialState, queue = Promise.resolve();
    const storage = () => {
      try {
        const value = options.storage === undefined ? root.localStorage : options.storage;
        if (!value || typeof value.getItem !== 'function' || typeof value.setItem !== 'function') throw Error();
        return value;
      } catch { throw new StoreError('Browser storage is unavailable. Allow site storage to save this workspace.', 503); }
    };
    async function baseline() {
      if (!baselinePromise) {
        baselinePromise = (async () => {
          if (typeof fetchData !== 'function') throw new StoreError('The public application data could not be loaded.', 503);
          const collections = await Promise.all(['data/developments.geojson', 'data/proposed-buildings.geojson'].map(async file => {
            let response;
            try { response = await fetchData(file, {credentials: 'same-origin', cache: 'no-cache'}); }
            catch { throw new StoreError('The public application data could not be loaded. Reload and try again.', 503); }
            if (!response.ok) throw new StoreError('The public application data could not be loaded. Reload and try again.', 503);
            let data;
            try { data = await response.json(); } catch { throw new StoreError('The public application data is invalid.', 503); }
            if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new StoreError('The public application data is invalid.', 503);
            return data;
          }));
          const projects = new Map(), models = new Map();
          for (const feature of collections[0].features) {
            const p = feature.properties || {}, id = p.PROJECT_NO;
            if (typeof id === 'string' && id) projects.set(id, {project_no: id, display_name: p.DISPLAY_NAME || 'Application ' + id,
              description: p.DESCRIPTION || '', status: p.STATUS || '', source_url: p.WEBLINK || ''});
          }
          for (const feature of collections[1].features) {
            const p = feature.properties || {};
            if (p.model_id === undefined || p.model_id === null) throw new StoreError('The public building data is invalid.', 503);
            const id = String(p.model_id);
            models.set(id, {model_id: id, project_no: p.project_no, name: p.name, height_m: p.height_m, height_basis: p.height_basis});
          }
          if (!projects.size) throw new StoreError('The public application data is empty.', 503);
          return {projects, models, statuses: [...new Set([...projects.values()].map(p => p.status).filter(Boolean))].sort()};
        })().catch(error => { baselinePromise = undefined; throw error; });
      }
      return baselinePromise;
    }
    function validate(overlay, catalog) {
      if (!keysAre(overlay, ['schemaVersion', 'projectOverrides', 'modelOverrides'], ['newApplications']) || overlay.schemaVersion !== 1)
        throw new StoreError('Use schemaVersion 1 with projectOverrides, modelOverrides, and optional newApplications only.');
      const projects = overlay.projectOverrides, models = overlay.modelOverrides, additions = overlay.newApplications === undefined ? {} : overlay.newApplications;
      if (![projects, models, additions].every(object)) throw new StoreError('Project overrides, model overrides, and new applications must be JSON objects.');
      if (Object.keys(additions).length > MAX_NEW_APPLICATIONS) throw new StoreError('Add at most ' + MAX_NEW_APPLICATIONS + ' local applications.');
      const result = empty();
      const status = value => {
        if (typeof value !== 'string' || !catalog.statuses.includes(value)) throw new StoreError('Choose a status from the existing application status list.');
        return value;
      };
      for (const [id, values] of Object.entries(additions)) {
        if (!APPLICATION_NUMBER.test(id)) throw new StoreError('Application numbers must use YY-NNNN-NN or YYYY-NNNN-NN.');
        if (catalog.projects.has(id)) throw new StoreError('Application ' + id + ' already exists in the public data. Edit it instead.');
        if (Object.hasOwn(projects, id)) throw new StoreError('Keep all edits to new application ' + id + ' in newApplications.');
        if (!keysAre(values, ['display_name', 'description', 'status', 'source_url', 'longitude', 'latitude'], ['location_basis']))
          throw new StoreError('New application ' + id + ' requires a name, description, status, source link, longitude, and latitude.');
        const clean = {display_name: text(values.display_name, 'Application name', 1, 160),
          description: text(values.description, 'Description', 0, 6000), source_url: sourceURL(values.source_url), status: status(values.status)};
        for (const [name, low, high] of [['longitude', -123, -122.5], ['latitude', 48.99, 49.25]]) {
          const coordinate = values[name];
          if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || coordinate < low || coordinate > high)
            throw new StoreError('Application ' + name + ' must be a finite number between ' + low + ' and ' + high + '.');
          clean[name] = coordinate;
        }
        if (Object.hasOwn(values, 'location_basis')) clean.location_basis = text(values.location_basis, 'Location basis', 0, 1000);
        put(result.newApplications, id, clean);
      }
      for (const [id, values] of Object.entries(projects)) {
        if (!catalog.projects.has(id)) throw new StoreError('Unknown application: ' + id + '.');
        if (!keysAre(values, [], ['display_name', 'description', 'status', 'source_url'])) throw new StoreError('Unsupported fields for application ' + id + '.');
        const clean = {};
        for (const [name, value] of Object.entries(values)) {
          if (name === 'display_name') clean[name] = text(value, 'Application name', 1, 160);
          else if (name === 'description') clean[name] = text(value, 'Description', 0, 6000);
          else if (name === 'status') clean[name] = status(value);
          else clean[name] = sourceURL(value);
        }
        if (Object.keys(clean).length) put(result.projectOverrides, id, clean);
      }
      for (const [id, values] of Object.entries(models)) {
        if (!catalog.models.has(id)) throw new StoreError('Unknown building model: ' + id + '.');
        if (!keysAre(values, ['height_m', 'height_basis'])) throw new StoreError('A model edit must include only height_m and height_basis (the reason).');
        const height = values.height_m;
        if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0 || height > 600)
          throw new StoreError('Model height must be greater than 0 and at most 600 metres.');
        let basis = text(values.height_basis, 'Height edit reason', 1, 1500);
        if (basis.startsWith(HEIGHT_PREFIX.trimEnd())) basis = basis.slice(HEIGHT_PREFIX.trimEnd().length).trim();
        basis = text(basis, 'Height edit reason', 8, 1400);
        put(result.modelOverrides, id, {height_m: height, height_basis: HEIGHT_PREFIX + basis});
      }
      return result;
    }
    function fresh() {
      if (!initialState) initialState = {storageVersion: 1, revision: 0, draft: empty(),
        published: {revision: 0, publishedAt: null, data: empty()},
        history: [{id: 'v0', revision: 0, createdAt: clock(), action: 'baseline', summary: 'Original public data (no staff overrides)', data: empty()}]};
      return clone(initialState);
    }
    function readRaw() {
      try { return storage().getItem(key); }
      catch (error) {
        if (error instanceof StoreError) throw error;
        throw new StoreError('Browser storage could not be read. Your saved work has not been changed.', 503);
      }
    }
    function read(catalog) {
      const raw = readRaw();
      if (raw === null) return {state: fresh(), raw};
      try {
        if (typeof raw !== 'string' || raw.length * 2 > MAX_STORAGE_BYTES) throw Error();
        const state = JSON.parse(raw);
        if (!keysAre(state, ['storageVersion', 'revision', 'draft', 'published', 'history']) || state.storageVersion !== 1 ||
            !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.history) ||
            !state.history.length || state.history.length > HISTORY_LIMIT + 1) throw Error();
        state.draft = validate(state.draft, catalog);
        if (!keysAre(state.published, ['revision', 'publishedAt', 'data']) || !Number.isSafeInteger(state.published.revision) ||
            state.published.revision < 0 || state.published.revision > state.revision ||
            (state.published.revision === 0 ? state.published.publishedAt !== null : !validDate(state.published.publishedAt))) throw Error();
        state.published.data = validate(state.published.data, catalog);
        let previousRevision = -1;
        for (const [index, version] of state.history.entries()) {
          if (!keysAre(version, ['id', 'revision', 'createdAt', 'action', 'summary', 'data']) ||
              !Number.isSafeInteger(version.revision) || version.revision <= previousRevision || version.revision > state.revision ||
              version.id !== 'v' + version.revision || !validDate(version.createdAt) || typeof version.summary !== 'string' ||
              (index === 0 ? version.revision !== 0 || version.action !== 'baseline' : version.action !== 'publish')) throw Error();
          previousRevision = version.revision;
          version.data = validate(version.data, catalog);
        }
        if (JSON.stringify(state.history[0].data) !== JSON.stringify(empty())) throw Error();
        const latest = state.history[state.history.length - 1];
        if (latest.revision !== state.published.revision || JSON.stringify(latest.data) !== JSON.stringify(state.published.data) ||
            (latest.revision > 0 && latest.createdAt !== state.published.publishedAt)) throw Error();
        return {state, raw};
      } catch { throw new StoreError('Saved browser data is invalid. It has not been changed. Export any unsaved work before clearing site storage.', 500); }
    }
    const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    function view(state, catalog) {
      return clone({revision: state.revision, draft: state.draft, published: state.published,
        history: [...state.history].reverse().map(({data, ...version}) => version),
        projects: [...catalog.projects.values()].sort((a, b) => a.project_no.localeCompare(b.project_no)),
        models: [...catalog.models.values()], statuses: catalog.statuses});
    }
    async function getState() {
      const catalog = await baseline();
      return view(read(catalog).state, catalog);
    }
    async function published(draft = false) {
      if (typeof draft !== 'boolean') throw new StoreError('Choose the draft or published workspace.');
      const state = read(await baseline()).state;
      return clone(draft ? {revision: state.revision, data: state.draft, mode: 'draft'} :
        {...state.published, mode: state.published.publishedAt === null ? 'snapshot' : 'published'});
    }
    async function action(request) {
      const allowed = {save: ['action', 'revision', 'data'], import: ['action', 'revision', 'data'],
        publish: ['action', 'revision'], restore: ['action', 'revision', 'versionId']};
      if (!object(request) || typeof request.action !== 'string' || !Object.hasOwn(allowed, request.action) || !keysAre(request, allowed[request.action]))
        throw new StoreError('Use save, import, publish, or restore with the required fields.');
      // Capture the action and revision before awaiting the baseline. Overlay
      // validation creates a new value before a mutation lock is requested.
      const operation = request.action, revision = request.revision, versionId = request.versionId;
      const catalog = await baseline();
      const data = ['save', 'import'].includes(operation) ? validate(request.data, catalog) : undefined;
      const commit = () => {
        const {state, raw} = read(catalog);
        if (!Number.isSafeInteger(revision) || revision !== state.revision) throw new StoreError(CONFLICT, 409);
        if (revision === Number.MAX_SAFE_INTEGER) throw new StoreError('This workspace has reached its revision limit.', 507);
        const updated = clone(state); updated.revision++;
        if (data) updated.draft = data;
        else if (operation === 'restore') {
          const version = updated.history.find(item => typeof versionId === 'string' && item.id === versionId);
          if (!version) throw new StoreError('That published version does not exist.');
          updated.draft = clone(version.data);
        } else {
          const stamp = clock(), overlay = validate(updated.draft, catalog);
          if (!validDate(stamp)) throw new StoreError('The current publication date is invalid.');
          updated.published = {revision: updated.revision, publishedAt: stamp, data: overlay};
          updated.history.push({id: 'v' + updated.revision, revision: updated.revision, createdAt: stamp, action: 'publish',
            summary: Object.keys(overlay.projectOverrides).length + ' application edits · ' + Object.keys(overlay.newApplications).length +
              ' new applications · ' + Object.keys(overlay.modelOverrides).length + ' model edits', data: overlay});
          updated.history = [updated.history[0], ...updated.history.slice(1).slice(-HISTORY_LIMIT)];
        }
        const serialized = JSON.stringify(updated);
        if (serialized.length * 2 > MAX_STORAGE_BYTES) throw new StoreError('This browser workspace is full. Export your draft, then reduce its size before saving.', 507);
        // Web Locks serializes writers across tabs. The immediate comparison also
        // catches stale writers on browsers without Web Locks; no await separates
        // this comparison and the single atomic localStorage replacement.
        if (readRaw() !== raw) throw new StoreError(CONFLICT, 409);
        try { storage().setItem(key, serialized); }
        catch (error) {
          if (error instanceof StoreError) throw error;
          throw new StoreError('Browser storage is full or unavailable. Your changes were not saved. Export your draft before continuing.', 507);
        }
        if (readRaw() !== serialized) throw new StoreError(CONFLICT, 409);
        return view(updated, catalog);
      };
      const run = () => locks && typeof locks.request === 'function' ? locks.request(key, {mode: 'exclusive'}, commit) : commit();
      const pending = queue.then(run, run);
      queue = pending.catch(() => {});
      return pending;
    }
    return {getState, action, published, storageKey: key};
  }
  let defaultWorkspace;
  const instance = () => defaultWorkspace || (defaultWorkspace = createWorkspace());
  return {createWorkspace, StoreError, empty, parseJSON, storageKey, HEIGHT_PREFIX, HISTORY_LIMIT, MAX_STORAGE_BYTES,
    getState: () => instance().getState(), action: request => instance().action(request), published: draft => instance().published(draft)};
});
