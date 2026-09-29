/* Read-only public snapshot; no editor or server dependency. */
window.SurreyPublishing = {
  state: {mode: 'snapshot'},
  async load() { return this.state; },
  apply(collection) { return collection; },
  describe() { return 'Independent demonstration · Public-source snapshot'; }
};
