'use strict';
(async () => {
  const $ = id => document.getElementById(id), data = {}, query = new URLSearchParams(location.search);
  let projects = [], profiles = {}, placeCoverage = {}, limit = 20, profileUnavailable = false;
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const link = (text, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return el('span', 'Source unavailable');
      const anchor = el('a', text); anchor.href = parsed.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.setAttribute('aria-label', text.replace(/\s*↗$/, '') + ', opens in a new tab'); return anchor;
    } catch (_) { return el('span', 'Source unavailable'); }
  };
  const models = feature => data['proposed-buildings'].features.filter(model => model.properties.project_no === feature.properties.PROJECT_NO);
  const sourceLabel = profile => profile.source_label || (profile.source_kind === 'application' ? 'Application record' : 'Planning report');
  const reportDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || 'Date not published';
    return new Date(value + 'T12:00:00').toLocaleDateString('en-CA', {year: 'numeric', month: 'short', day: 'numeric'});
  };
  const excerpt = value => { const text = String(value || ''); return text.length <= 270 ? text : text.slice(0, 267).replace(/\s+\S*$/, '') + '…'; };
  function presentation(feature) {
    const record = feature.properties, profile = profiles[record.PROJECT_NO] || {};
    return {profile, title: record.DISPLAY_NAME || profile.title || 'Application ' + record.PROJECT_NO,
      summary: record.STAFF_EDITED ? record.DESCRIPTION || '' : profile.summary || record.DESCRIPTION || ''};
  }
  function mapLink(number) {
    const params = new URLSearchParams({project: number});
    if (query.get('preview') === 'draft') params.set('preview', 'draft');
    const anchor = el('a', 'View on map ↗', 'map-link'); anchor.href = './?' + params;
    anchor.setAttribute('aria-label', 'View application ' + number + ' on the map'); return anchor;
  }
  function detailSection(title) {
    const details = el('details'), content = el('div', undefined, 'detail-content');
    details.append(el('summary', title), content); return {details, content};
  }
  function projectDetails(feature, profile) {
    const record = feature.properties, section = detailSection('Project details & sources');
    section.content.append(el('h3', 'Current application record'), el('p', record.DESCRIPTION || 'No description published.'));
    if (record.STAFF_ADDED) section.content.append(el('p', 'Staff-added location pin. No site footprint or 3D model is supplied.', 'muted'));
    if (record.LOCATION_BASIS) section.content.append(el('p', 'Location basis: ' + record.LOCATION_BASIS, 'muted'));
    const sources = el('div', undefined, 'source-links');
    sources.append(link(record.STAFF_EDITED ? 'Staff-supplied project link ↗' : 'Official application record ↗', record.WEBLINK));
    if (record.APPLICATION_DOCUMENTS_WEBLINK && record.APPLICATION_DOCUMENTS_WEBLINK !== profile.source_url) sources.append(link('Application documents ↗', record.APPLICATION_DOCUMENTS_WEBLINK));
    section.content.append(sources);
    if (profile.source_url) {
      section.content.append(el('h3', sourceLabel(profile) + (profile.source_date ? ' · ' + reportDate(profile.source_date) : '')));
      if (profile.status_note) section.content.append(el('p', profile.status_note));
      section.content.append(link('Read source ↗', profile.source_url));
    }
    return section.details;
  }
  function buildingDetails(items) {
    const section = detailSection('Building examples · ' + items.length + (items.length === 1 ? ' model part' : ' model parts')), list = el('ul', undefined, 'model-list');
    section.content.append(el('p', 'Approximate public-source massing. Floor areas below are proposed project totals, not available leasing space.', 'model-caveat'));
    for (const feature of items) {
      const model = feature.properties, item = el('li');
      item.append(el('strong', model.name), el('p', (model.storeys ? model.storeys + ' storeys · ' : '') + model.height_m + ' m model height', 'model-stat'));
      if (model.height_basis) item.append(el('p', model.height_basis));
      if (model.footprint_basis) item.append(el('p', model.footprint_basis, 'muted'));
      if (model.area) item.append(el('p', 'Pilot area: ' + model.area, 'muted'));
      for (const [field, label] of [['commercial_size_m2', 'Commercial floor area'], ['industrial_size_m2', 'Industrial floor area'], ['total_floor_area_m2', 'Total floor area']]) {
        if (Number.isFinite(model[field]) && model[field] > 0) item.append(el('p', label + ': ' + model[field].toLocaleString('en-CA') + ' m² · proposed project total, not available space'));
      }
      if (model.area_basis) item.append(el('p', model.area_basis, 'muted'));
      if (model.model_note) item.append(el('p', model.model_note, 'model-caveat'));
      item.append(link('Planning source ↗', model.source_url)); list.append(item);
    }
    section.content.append(list); return section.details;
  }
  function publishedFlag(value) {
    const clean = String(value ?? '').trim();
    if (!clean || /^(null|none|n\/a)$/i.test(clean)) return 'Not published';
    if (/^(yes|y|true|1)$/i.test(clean)) return 'Yes';
    if (/^(no|n|false|0)$/i.test(clean)) return 'No';
    return 'Unknown · published value: ' + clean;
  }
  function nearbyDetails(feature) {
    const section = detailSection('Nearby places & directions'); let built = false;
    section.content.append(el('p', 'Straight-line distances between approximate reference points. Commercial chains use a regional map snapshot supplemented with official Surrey listings; coverage and current operation are not guaranteed. Google Maps provides route distances and times; confirm entrances there.', 'route-caveat'));
    section.details.addEventListener('toggle', () => {
      if (!section.details.open || built) return;
      built = true;
      const nearby = el('ul', undefined, 'nearby-list'), origin = SurreyNearby.point(feature);
      const picker=el('select'), pickerLabel=el('label','Category'), more=el('button','Show more');
      picker.setAttribute('aria-label','Nearby category');
      const categories=[...new Set((data.destinations?.features||[]).map(f=>f.properties.CATEGORY))].sort();
      for(const category of categories){const option=el('option',placeCoverage[category]?.label||category);option.value=category;picker.append(option);}
      pickerLabel.append(picker);section.content.append(pickerLabel,nearby,more);
      let ranked=[],shown=0;
      function append(focusNew=false){
      const previous=nearby.children.length,end=Math.min(shown+12,ranked.length);
      for (const place of ranked.slice(shown,end)) {
        const item = el('li'); item.append(el('strong', place.category + ': ' + place.name), el('p', SurreyNearby.format(place.metres) + ' straight line', 'muted'));
        if (place.feature.properties.SERVICE_NOTE) item.append(el('p',place.feature.properties.SERVICE_NOTE,'route-caveat'));
        if(place.feature.properties.SOURCE_URL)item.append(link('Operator / source details ↗',place.feature.properties.SOURCE_URL));
        if (place.category === 'Bus stop') {
          const record = place.feature.properties, flags = el('dl', undefined, 'bus-flags');
          const routes = String(record.TRANSIT_ROUTES ?? '').trim();
          flags.append(el('dt', 'Published accessible flag'), el('dd', publishedFlag(record.ACCESSIBLE)),
            el('dt', 'Published bus routes'), el('dd', routes && !/^(null|none|n\/a)$/i.test(routes) ? routes : 'Not published'));
          item.append(flags, el('p', 'This stop flag does not establish an accessible route to the stop. Check the actual path and service before travel.', 'route-caveat'));
        }
        const directions = el('div', undefined, 'directions');
        for (const [mode, title] of [['walking', 'Walk'], ['transit', 'Transit'], ['driving', 'Drive']]) {
          const anchor = link(title + ' ↗', SurreyTravel.build(origin, place, mode));
          anchor.setAttribute('aria-label', title + ' directions to ' + place.name + ' in Google Maps, opens a new tab'); directions.append(anchor);
        }
        item.append(directions); nearby.append(item);
      }
      shown=end;more.hidden=shown>=ranked.length;more.textContent='Show more';
      if(focusNew){const first=nearby.children[previous]?.querySelector('strong');if(first){first.tabIndex=-1;first.focus();}}
      }
      function refresh(){ranked=SurreyNearby.venues(origin,data,picker.value);shown=0;nearby.replaceChildren();append();}
      picker.addEventListener('change',refresh);more.addEventListener('click',()=>append(true));refresh();
    });
    return section.details;
  }
  function render(append=false) {
    const term = $('search').value.trim().toLowerCase();
    const matches = projects.filter(feature => {
      const record = feature.properties, {profile, title, summary} = presentation(feature);
      return ($('filter').value === 'all' || profile.featured === true || models(feature).length || record.STAFF_ADDED) && (!term || [record.PROJECT_NO, title, summary, record.DESCRIPTION, profile.address, profile.use, profile.area, ...models(feature).map(model => model.properties.area)].join(' ').toLowerCase().includes(term));
    });
    if ($('filter').value !== 'all') matches.sort((a,b) => (profiles[b.properties.PROJECT_NO]?.residential_units || 0) - (profiles[a.properties.PROJECT_NO]?.residential_units || 0));
    $('result-count').textContent = matches.length.toLocaleString() + ' matching projects';
    const previous=append?$('project-list').children.length:0;
    if(!append)$('project-list').replaceChildren(); $('more').hidden = limit >= matches.length;
    for (const feature of matches.slice(previous, limit)) {
      const record = feature.properties, {profile, title, summary} = presentation(feature), items = models(feature);
      const card = el('article', undefined, 'project-card'), intro = el('div', undefined, 'card-intro'), heading = el('div', undefined, 'card-heading');
      const titleNode = el('h2', title); titleNode.id = 'project-' + record.PROJECT_NO; titleNode.tabIndex=-1; card.setAttribute('aria-labelledby', titleNode.id);
      heading.append(titleNode, mapLink(record.PROJECT_NO)); intro.append(heading);
      const recordLine = el('div', undefined, 'record-line');
      recordLine.append(el('span', record.PROJECT_NO), el('span', 'Status: ' + (record.STATUS || 'Not published'), 'status'));
      if (record.STAFF_ADDED) recordLine.append(el('span', 'Staff-added location pin', 'staff-label'));
      else if (record.STAFF_EDITED) recordLine.append(el('span', 'Local staff revision', 'staff-label'));
      intro.append(recordLine, el('p', excerpt(record.STAFF_EDITED ? summary : profile.headline || summary) || 'No description published.', 'project-summary'));
      const meta = el('div', undefined, 'profile-meta');
      if (profile.address) meta.append(el('p', profile.address, 'address'));
      if (profile.area || profile.use) meta.append(el('p', [profile.area, profile.use].filter(Boolean).join(' · ')));
      if (profile.source_date) meta.append(el('p', (profile.source_date_label || sourceLabel(profile)) + ' · ' + reportDate(profile.source_date)));
      if (meta.childElementCount) intro.append(meta);
      card.append(intro, projectDetails(feature, profile));
      if (items.length) card.append(buildingDetails(items));
      card.append(nearbyDetails(feature)); $('project-list').append(card);
    }
    if (!matches.length) $('project-list').append(el('p', 'No matches. Try a different search or show all 3D projects.', 'empty'));
    $('project-list').setAttribute('aria-busy', 'false');
    if(append)$('project-list').children[previous]?.querySelector('h2')?.focus();
  }
  async function fetchData(path) {
    if (window.__SURREY_DATA?.[path]) return window.__SURREY_DATA[path];
    const response = await fetch(path,{cache:'no-cache'}); if (!response.ok) throw Error('Could not load ' + path); return response.json();
  }
  try {
    await SurreyPublishing.load();
    await Promise.all([
      ...['developments', 'proposed-buildings', 'skytrain-stations', 'bus-stops', 'parks', 'outdoor-recreation', 'destinations'].map(async key => {
        const path = 'data/' + key + '.geojson'; data[key] = SurreyPublishing.apply(await fetchData(path), path);
      }),
      fetchData('data/destinations-sources.json').then(result=>{placeCoverage=result.category_coverage||{};}),
      fetchData('data/project-profiles.json').then(result => { profiles = result.profiles || {}; }).catch(() => { profileUnavailable = true; })
    ]);
    const visibleParks=new Set(SurreyNearby.venues({lon:-122.85,lat:49.19},data,'Park').flatMap(place=>(place.members||[place]).map(item=>item.feature)));
    data.destinations.features=data.destinations.features.filter(feature=>feature.properties.CATEGORY!=='Park'||visibleParks.has(feature));
    data.parks.features=data.parks.features.filter(SurreyNearby.eligiblePark);
    placeCoverage.Park={...placeCoverage.Park,label:'Parks'};
    $('revision').textContent = SurreyPublishing.describe() + (profileUnavailable ? ' · Showing application records; project summaries are unavailable.' : '');
    if (query.get('preview') === 'draft') {
      document.querySelectorAll('[data-map-link]').forEach(anchor => { anchor.href = './?preview=draft'; });
      document.querySelector('[aria-current="page"]').href = 'accessible.html?preview=draft';
    }
    projects = data.developments.features.filter(feature => models(feature).length > 0 || feature.properties.STAFF_ADDED);
    if (query.get('project')) { $('search').value = query.get('project'); $('filter').value = 'all'; }
    $('search').addEventListener('input', () => { limit = 20; render(); }); $('filter').addEventListener('change', () => { limit = 20; render(); });
    $('more').addEventListener('click', () => { limit += 20; render(true); }); render();
  } catch (error) {
    $('revision').textContent = 'Could not load the list: ' + error.message; $('revision').classList.add('error'); $('revision').setAttribute('role', 'alert'); $('project-list').setAttribute('aria-busy', 'false');
  }
})();
