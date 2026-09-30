(function (root) {
  'use strict';
  const empty = () => ({schemaVersion: 1, projectOverrides: {}, modelOverrides: {}, newApplications: {}});
  function newApplicationFeatures(collection, additions) {
    const usedIds = new Set(), projectNumbers = new Set();
    for (const feature of collection.features) {
      projectNumbers.add(feature.properties?.PROJECT_NO);
      for (const value of [feature.id, feature.properties?.OBJECTID]) {
        if (value !== undefined && value !== null && Number.isSafeInteger(Number(value))) usedIds.add(Number(value));
      }
    }
    return Object.keys(additions).sort().filter(key => !projectNumbers.has(key)).map(key => {
      const record = additions[key];
      // Encode two- and four-digit year formats in disjoint ranges. Collision
      // steps preserve each application's identity as other additions change.
      let id = (key.split('-')[0].length === 2 ? 1_000_000_000 : 2_000_000_000) + Number(key.replaceAll('-', ''));
      while (usedIds.has(id)) id += 20_000_000_000;
      usedIds.add(id);
      return {type: 'Feature', id, geometry: {type: 'Point', coordinates: [record.longitude, record.latitude]}, properties: {
        OBJECTID: id, PROJECT_NO: key, DISPLAY_NAME: record.display_name, DESCRIPTION: record.description,
        STATUS: record.status, WEBLINK: record.source_url, STAFF_ADDED: 'Local staff-added application',
        LOCATION_BASIS: record.location_basis || 'Staff-entered point; location not City verified.',
        STAFF_EDITED: 'Local staff revision'
      }};
    });
  }
  function apply(collection, filename, overlay) {
    if (!collection?.features || !overlay) return collection;
    const projects = overlay.projectOverrides || {}, models = overlay.modelOverrides || {};
    const features = collection.features.map(feature => {
      const p = {...feature.properties};
      if (filename.endsWith('/developments.geojson')) {
        const change = projects[p.PROJECT_NO];
        if (change) {
          if (change.display_name !== undefined) p.DISPLAY_NAME = change.display_name;
          if (change.description !== undefined) p.DESCRIPTION = change.description;
          if (change.status !== undefined) p.STATUS = change.status;
          if (change.source_url !== undefined) p.WEBLINK = change.source_url;
          p.STAFF_EDITED = 'Local staff revision';
        }
      } else if (filename.endsWith('/proposed-buildings.geojson')) {
        const change = models[String(p.model_id)];
        if (change) {
          p.height_m = change.height_m;
          p.height_basis = change.height_basis;
          p.model_note = 'Height changed in the local staff workspace; not City verified. ' + (p.model_note || '');
          p.is_production_verified = false;
        }
      }
      return {...feature, properties: p};
    });
    if (filename.endsWith('/developments.geojson')) {
      features.push(...newApplicationFeatures(collection, overlay.newApplications || {}));
    }
    return {...collection, features};
  }
  if (typeof module === 'object' && module.exports) {module.exports = {apply, empty}; return;}
  let state = {revision: 0, data: empty(), mode: 'snapshot'};
  root.SurreyPublishing = {
    async load() {
      if (root.__SURREY_DATA || location.protocol === 'file:') return state;
      const draft = new URLSearchParams(location.search).get('preview') === 'draft';
      const result = await root.SurreyWorkspaceTransport.published(draft);
      if (!result) return state;
      if (result.data?.schemaVersion !== 1) throw Error('The saved dataset format is unsupported.');
      state = result;
      return state;
    },
    apply(collection, filename) {return apply(collection, filename, state.data);},
    get state() {return state;},
    describe() {
      if (root.SurreyWorkspaceTransport?.browserOnly) {
        if (state.mode === 'draft') return 'Your browser draft · Not published';
        if (state.mode === 'published') return 'Your browser preview · Shared map unchanged';
        return 'Independent demonstration · Public-source snapshot';
      }
      if (state.mode === 'draft') return 'STAFF DRAFT · Not published · revision ' + state.revision;
      if (state.mode === 'snapshot') return 'Public-source snapshot · Local preview';
      return 'Published local revision ' + state.revision + ' · Not a City website';
    }
  };
})(typeof window === 'object' ? window : this);
