/* Public demo: browser storage only; no server writes or credentials. */
window.SurreyWorkspaceTransport = {
  browserOnly: true,
  getState: () => window.SurreyBrowserWorkspace.getState(),
  published: draft => window.SurreyBrowserWorkspace.published(draft),
  action: (request, rawImport) => window.SurreyBrowserWorkspace.action(rawImport === undefined
    ? request : {...request, data: window.SurreyBrowserWorkspace.parseJSON(rawImport)})
};
