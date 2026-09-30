'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const prefix = 'Staff-edited / unverified — ';
  const normalizeOverlay = value => ({...value, newApplications: value.newApplications || {}});
  const transport = window.SurreyWorkspaceTransport;
  const browserOnly = !!transport.browserOnly;
  const mapName = browserOnly ? 'your browser preview' : 'your browser preview';
  let state, working, projectId, modelId, busy = false, stale = false, creating = false, pendingNew;
  let locationResults = [], locationActive = -1, locationVersion = 0, locationTimer, locationAbort;
  const baselineProject = () => state.projects.find(project => project.project_no === projectId);
  const baselineModel = () => state.models.find(model => model.model_id === modelId);
  const added = () => !creating && !!working.newApplications[projectId];
  const allProjects = () => [...Object.entries(working.newApplications).map(([project_no, record]) => ({...record, project_no, added: true})), ...state.projects];
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const dirty = () => !!state && (creating || !same(working, state.draft));
  const inSurrey = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) && lon >= -123 && lon <= -122.5 && lat >= 48.99 && lat <= 49.25;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function message(text, error = false) {
    $('feedback').setAttribute('aria-live', error ? 'assertive' : 'polite');
    $('feedback').textContent = text;
    $('feedback').classList.toggle('error', error);
  }
  const date = value => value ? new Date(value).toLocaleString() : 'Not yet published';
  function refresh() {
    if (!state) return;
    const unsaved = dirty(), pending = !same(state.draft, state.published.data);
    $('workspace').setAttribute('aria-busy', String(busy));
    $('revision').textContent = state.revision;
    $('dirty-label').textContent = unsaved ? 'Unsaved' : 'Saved';
    $('dirty-label').classList.toggle('unsaved', unsaved);
    $('draft-state').textContent = unsaved ? 'Save your changes to preview or publish.' : pending ? 'Draft saved. Preview it before publishing.' : 'Your saved draft matches the published map.';
    $('published-at').textContent = state.published.publishedAt ? 'Published ' + date(state.published.publishedAt) : 'Original public data · no browser changes published';
    document.querySelectorAll('#workspace button, #workspace input, #workspace select, #workspace textarea').forEach(node => { node.disabled = busy; });
    document.querySelectorAll('#model-fields input, #model-fields textarea, #model-fields select, #model-fields button').forEach(node => { node.disabled = busy || $('model-fields').hidden; });
    document.querySelectorAll('#location-section input').forEach(node => { node.disabled = busy || $('location-section').hidden; });
    $('project-filter').disabled = $('project-select').disabled = busy || creating;
    $('add-application').disabled = busy || stale || creating;
    $('save-draft').disabled = busy || stale || !unsaved;
    $('publish').disabled = busy || stale || unsaved || !pending;
    $('import-file').disabled = busy || stale;
    $('preview').setAttribute('aria-disabled', String(busy || unsaved));
    $('preview').href = './?preview=draft' + (projectId ? '&project=' + encodeURIComponent(projectId) : '');
    $('preview').title = unsaved ? 'Save your draft first' : 'Open saved draft on the map';
    $('cancel-add').hidden = !creating;
    $('reset-project').hidden = creating || added();
    $('remove-application').hidden = creating || !added();
  }
  function fillProjectOptions() {
    const term = $('project-filter').value.trim().toLowerCase(), projects = allProjects();
    const matches = projects.filter(project => [project.project_no, project.display_name, project.description,
      working.projectOverrides[project.project_no]?.display_name].join(' ').toLowerCase().includes(term));
    const options = [...matches], current = projects.find(project => project.project_no === projectId);
    if (current && !options.some(project => project.project_no === projectId)) options.unshift(current);
    $('project-select').replaceChildren(...options.map(project => {
      const name = working.projectOverrides[project.project_no]?.display_name || project.display_name;
      return new Option(project.project_no + ' · ' + name + (project.added ? ' · Added' : ''), project.project_no);
    }));
    $('project-select').value = projectId || '';
    $('project-count').textContent = matches.length.toLocaleString() + (matches.length === 1 ? ' application' : ' applications') + (current && !matches.some(p => p.project_no === projectId) ? ' · current selection retained' : '');
  }
  function fillModel() {
    const model = baselineModel();
    if (!model) return;
    const override = working.modelOverrides[modelId];
    $('height').value = override ? override.height_m : model.height_m;
    $('height-reason').value = override ? override.height_basis.replace(/^Staff-edited \/ unverified — /, '') : '';
    $('height-reason').required = !!override;
    $('baseline-height').textContent = 'Original height: ' + model.height_m + ' m. ' + model.height_basis;
  }
  function showLocation() {
    const lon = $('longitude').value === '' ? null : Number($('longitude').value);
    const lat = $('latitude').value === '' ? null : Number($('latitude').value);
    $('location-selected').hidden = !inSurrey(lon, lat);
    if (inSurrey(lon, lat)) $('location-selected').textContent = ($('location-basis').value || 'Staff-supplied coordinates') + ' · ' + lat.toFixed(6) + ', ' + lon.toFixed(6);
  }
  function fillEditor() {
    stopLocationSearch();
    $('editor-form').querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
    const project = creating ? pendingNew : added() ? {...working.newApplications[projectId], project_no: projectId} : baselineProject();
    if (!project) return;
    const effective = creating || added() ? project : {...project, ...working.projectOverrides[projectId]};
    $('edit-heading').textContent = creating ? 'New application' : 'Application details';
    $('record-kind').textContent = creating ? 'A new location pin for the map.' : added() ? 'Staff-added application · location pin' : 'Original public record';
    $('project-number').value = effective.project_no || '';
    $('project-number').readOnly = !creating;
    $('project-number').setCustomValidity('');
    $('number-help').hidden = !creating;
    $('display-name').value = effective.display_name;
    $('project-status').value = effective.status;
    $('description').value = effective.description;
    $('source-url').value = effective.source_url;
    $('location-section').hidden = !creating && !added();
    $('longitude').value = effective.longitude ?? '';
    $('latitude').value = effective.latitude ?? '';
    $('location-basis').value = effective.location_basis || '';
    $('longitude').required = $('latitude').required = !$('location-section').hidden;
    $('location-search').value = '';
    $('location-status').textContent = 'Choose a result, or enter known coordinates below.';
    $('coordinate-details').open = false;
    showLocation();
    const models = creating || added() ? [] : state.models.filter(model => model.project_no === projectId);
    $('model-details').hidden = !models.length;
    $('no-model').hidden = models.length > 0;
    $('model-fields').hidden = !models.length;
    $('model-select').replaceChildren(...models.map(model => new Option(model.name, model.model_id)));
    if (!models.some(model => model.model_id === modelId)) modelId = models[0]?.model_id;
    $('model-select').value = modelId || '';
    fillModel(); refresh();
  }
  function captureModel() {
    const model = baselineModel();
    if (!model || creating || added()) return;
    const height = Number($('height').value), reason = $('height-reason').value.trim();
    const changed = height !== model.height_m || !!reason;
    $('height-reason').required = changed;
    if (changed) working.modelOverrides[modelId] = {height_m: height, height_basis: reason ? prefix + reason : ''};
    else delete working.modelOverrides[modelId];
  }
  function recordFields() {
    return {display_name: $('display-name').value.trim(), status: $('project-status').value,
      description: $('description').value.trim(), source_url: $('source-url').value.trim()};
  }
  function locationFields() {
    return {longitude: $('longitude').value === '' ? null : Number($('longitude').value),
      latitude: $('latitude').value === '' ? null : Number($('latitude').value),
      location_basis: $('location-basis').value.trim() || 'Coordinates supplied by local staff'};
  }
  function capture() {
    if (!state) return;
    if (creating) {
      pendingNew = {project_no: $('project-number').value.trim(), ...recordFields(), ...locationFields()};
      $('project-number').setCustomValidity('');
    } else if (added()) working.newApplications[projectId] = {...recordFields(), ...locationFields()};
    else {
      const project = baselineProject();
      if (!project) return;
      const override = Object.fromEntries(Object.entries(recordFields()).filter(([key, value]) => value !== String(project[key]).trim()));
      if (Object.keys(override).length) working.projectOverrides[projectId] = override;
      else delete working.projectOverrides[projectId];
      captureModel();
    }
    refresh();
  }
  function fillHistory() {
    $('history').replaceChildren(...state.history.map(version => {
      const item = element('li'), text = element('div');
      text.append(element('strong', version.action === 'baseline' ? 'Original public data' : 'Revision ' + version.revision),
        element('span', date(version.createdAt)), element('span', version.summary));
      const restore = element('button', 'Restore draft', 'secondary');
      restore.type = 'button';
      restore.setAttribute('aria-label', version.action === 'baseline' ? 'Restore original public data to draft' : 'Restore revision ' + version.revision + ' to draft');
      restore.addEventListener('click', () => {
        if (dirty() && !window.confirm('Replace unsaved edits with this version? Export first if you want to keep them.')) return;
        perform('restore', {versionId: version.id}, 'Version restored to the draft. Review it before publishing.');
      });
      item.append(text, restore); return item;
    }));
  }
  function acceptState(next, selectId) {
    next.draft = normalizeOverlay(next.draft); next.published.data = normalizeOverlay(next.published.data);
    state = next; working = clone(state.draft); stale = false; creating = false; pendingNew = undefined;
    if (selectId) projectId = selectId;
    if (!allProjects().some(project => project.project_no === projectId)) projectId = Object.keys(working.newApplications)[0] || state.models[0]?.project_no || state.projects[0]?.project_no;
    $('project-status').replaceChildren(...state.statuses.map(status => new Option(status, status)));
    fillProjectOptions(); fillEditor(); fillHistory(); $('workspace').hidden = false;
  }
  function requestError(error) {
    if (error.status === 409 || error.status === 403) stale = true;
    message(error.message, true);
  }
  async function load() {
    busy = true; refresh();
    try {
      acceptState(await transport.getState());
      message('Ready. Changes stay in the draft until you publish.');
    } catch (error) { message(error.message, true); }
    finally { busy = false; refresh(); }
  }
  async function perform(action, extra, success, selectId) {
    if (busy) return;
    let completed = false;
    stopLocationSearch(); busy = true; refresh(); message('Saving…');
    try {
      acceptState(await transport.action({action, revision: state.revision, ...extra}), selectId);
      message(success); completed = true;
    } catch (error) { requestError(error); }
    finally {
      busy = false; refresh();
      if (completed) $(action === 'save' ? 'preview' : action === 'restore' ? 'project-select' : 'preview').focus();
    }
  }
  function closeLocationResults() {
    $('location-results').hidden = true; $('location-search').setAttribute('aria-expanded', 'false');
    $('location-search').removeAttribute('aria-activedescendant'); locationActive = -1;
  }
  function stopLocationSearch() {
    clearTimeout(locationTimer); locationVersion++; locationAbort?.abort(); closeLocationResults();
  }
  function chooseLocation(result) {
    stopLocationSearch(); $('longitude').value = result.lon; $('latitude').value = result.lat;
    $('location-basis').value = (result.label + ' · ' + result.source + ' · ' + result.locationType).slice(0, 1000);
    $('location-search').value = result.label; $('location-status').textContent = 'Location selected. Check the pin in your saved preview.';
    showLocation(); capture();
  }
  function showLocationResults(results) {
    locationResults = results; locationActive = -1;
    $('location-results').replaceChildren(...results.map((result, index) => {
      const item = element('li'); item.id = 'location-option-' + index;
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', 'false');
      item.append(element('strong', result.label), element('small', result.locationType + ' · ' + result.source));
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', () => chooseLocation(result)); return item;
    }));
    $('location-results').hidden = !results.length; $('location-search').setAttribute('aria-expanded', String(!!results.length));
  }
  async function findLocation() {
    const query = $('location-search').value.trim(); if (query.length < 4) return;
    const version = locationVersion; locationAbort = new AbortController(); const controller = locationAbort;
    const timeout = setTimeout(() => { if (version === locationVersion) { controller.abort(); $('location-status').textContent = 'Search timed out. Try again or enter known coordinates.'; } }, 10000);
    $('location-status').textContent = 'Finding locations…';
    try {
      const results = await SurreyAddressSearch.search(query, {signal: controller.signal});
      if (version !== locationVersion) return;
      const local = results.filter(result => inSurrey(result.lon, result.lat)); showLocationResults(local);
      $('location-status').textContent = local.length ? 'Choose a location. Arrow keys and Enter also work.' : 'No Surrey-area result. Add the city or enter known coordinates.';
    } catch (error) { if (error.name !== 'AbortError' && version === locationVersion) $('location-status').textContent = 'Address search is unavailable. Enter known coordinates below.'; }
    finally { clearTimeout(timeout); }
  }
  $('add-application').addEventListener('click', () => {
    capture(); creating = true;
    pendingNew = {project_no: '', display_name: '', description: '', source_url: '', status: state.statuses.includes('Initial Review') ? 'Initial Review' : state.statuses[0], longitude: null, latitude: null, location_basis: ''};
    fillEditor(); message('Add the application details and choose its location.'); $('project-number').focus();
  });
  $('cancel-add').addEventListener('click', () => { creating = false; pendingNew = undefined; fillEditor(); message('New application cancelled. Your other draft edits are kept.'); $('add-application').focus(); });
  $('project-filter').addEventListener('input', fillProjectOptions);
  $('project-select').addEventListener('change', () => { capture(); projectId = $('project-select').value; fillEditor(); });
  $('model-select').addEventListener('change', () => { captureModel(); modelId = $('model-select').value; fillModel(); refresh(); });
  $('editor-form').addEventListener('input', event => {
    capture();
    if (event.target.validity?.valid) event.target.removeAttribute('aria-invalid');
  });
  $('project-status').addEventListener('change', capture);
  $('editor-form').addEventListener('submit', event => {
    event.preventDefault(); capture();
    if (creating && allProjects().some(project => project.project_no === pendingNew.project_no)) $('project-number').setCustomValidity('That application number already exists. Choose it from the application list.');
    if ((creating || added()) && (!$('longitude').checkValidity() || !$('latitude').checkValidity())) $('coordinate-details').open = true;
    if (!$('model-fields').hidden && (!$('height').checkValidity() || !$('height-reason').checkValidity())) $('model-details').open = true;
    if (!$('editor-form').reportValidity()) {
      const invalid = $('editor-form').querySelector(':invalid');
      $('editor-form').querySelectorAll('input, select, textarea').forEach(node => {
        if (node.willValidate && !node.validity.valid) node.setAttribute('aria-invalid', 'true');
        else node.removeAttribute('aria-invalid');
      });
      if (invalid) message((invalid.labels?.[0]?.textContent || 'Field') + ': ' + invalid.validationMessage, true);
      return;
    }
    const data = clone(working); let selectId;
    if (creating) { const {project_no, ...record} = pendingNew; selectId = project_no; data.newApplications[project_no] = record; }
    perform('save', {data}, creating ? 'Application added to the draft. Preview the pin, then publish.' : 'Draft saved. Preview your changes before publishing.', selectId);
  });
  $('preview').addEventListener('click', event => { if (busy || dirty()) { event.preventDefault(); message('Save the draft first, then open Preview.'); } });
  $('reset-project').addEventListener('click', () => { delete working.projectOverrides[projectId]; fillEditor(); });
  $('reset-model').addEventListener('click', () => { delete working.modelOverrides[modelId]; fillModel(); refresh(); });
  $('remove-application').addEventListener('click', () => {
    if (!added() || !window.confirm('Remove this staff-added application from the draft? It stays on the published map until you save and publish.')) return;
    delete working.newApplications[projectId]; projectId = state.projects[0]?.project_no;
    fillProjectOptions(); fillEditor(); message('Removed from your edits. Save and publish to remove it from your browser preview.'); $('project-select').focus();
  });
  $('publish').addEventListener('click', () => perform('publish', {}, 'Published. Open or refresh ' + mapName + ' to see your changes.'));
  $('reload').addEventListener('click', () => { if (!dirty() || window.confirm('Discard unsaved edits and reload the saved workspace? Export first to keep a copy.')) load(); });
  $('export').addEventListener('click', () => {
    capture(); const data = clone(working);
    if (creating) {
      if (!pendingNew.project_no || allProjects().some(project => project.project_no === pendingNew.project_no)) { message('Use a unique application number before exporting the new application.', true); return; }
      const {project_no, ...record} = pendingNew; data.newApplications[project_no] = record;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], {type: 'application/json'})), link = element('a');
    link.href = url; link.download = 'surrey-staff-draft-r' + state.revision + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); message('Exported your current draft, including unsaved edits.');
  });
  $('import-file').addEventListener('change', async () => {
    const file = $('import-file').files[0]; if (!file) return;
    try {
      if (file.size > 990000) throw Error('Choose a JSON file smaller than 990 KB.');
      const raw = await file.text(); JSON.parse(raw);
      if (dirty() && !window.confirm('Import replaces the saved draft and unsaved edits. Export first if you want to keep them. Continue?')) return;
      if (busy) return;
      stopLocationSearch(); busy = true; refresh(); message('Validating imported draft…');
      acceptState(await transport.action({action: 'import', revision: state.revision}, raw));
      message('Imported and saved to the draft. The published map is unchanged.');
    } catch (error) {
      if (error instanceof SyntaxError) message('Invalid JSON. Your saved draft and published map are unchanged.', true);
      else requestError(error);
    }
    finally { busy = false; $('import-file').value = ''; refresh(); }
  });
  $('location-search').addEventListener('input', () => {
    stopLocationSearch(); $('longitude').value = ''; $('latitude').value = ''; $('location-basis').value = ''; showLocation();
    if ($('location-search').value.trim().length < 4) { $('location-status').textContent = 'Type at least 4 characters.'; return; }
    $('location-status').textContent = 'Searching after you finish typing…'; locationTimer = setTimeout(findLocation, 700);
  });
  $('location-search').addEventListener('blur', closeLocationResults);
  $('location-search').addEventListener('keydown', event => {
    if (event.key === 'Escape') { stopLocationSearch(); return; }
    if (event.key === 'Enter') { event.preventDefault(); if (!$('location-results').hidden && locationResults.length) chooseLocation(locationResults[Math.max(0, locationActive)]); else { stopLocationSearch(); findLocation(); } return; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && !$('location-results').hidden && locationResults.length) {
      event.preventDefault(); locationActive = locationActive < 0 ? (event.key === 'ArrowDown' ? 0 : locationResults.length - 1) : (locationActive + (event.key === 'ArrowDown' ? 1 : -1) + locationResults.length) % locationResults.length;
      for (const [index, item] of Array.from($('location-results').children).entries()) item.setAttribute('aria-selected', String(index === locationActive));
      const id = 'location-option-' + locationActive; $('location-search').setAttribute('aria-activedescendant', id); $(id).scrollIntoView({block: 'nearest'});
    }
  });
  for (const id of ['longitude', 'latitude']) $(id).addEventListener('input', () => { stopLocationSearch(); $('location-search').value = ''; $('location-basis').value = 'Coordinates supplied by local staff'; $('location-status').textContent = 'Coordinates entered manually.'; showLocation(); });
  $('location-basis').addEventListener('input', showLocation);
  document.addEventListener('click', event => { if (!event.target.closest('.address-search')) closeLocationResults(); });
  window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  load();
})();
