// Engine refusals the backend maps to HTTP statuses. Kept apart from
// signalEngineService so code that mocks the engine client still sees the
// real classes.

/** The engine refused to start a scrape: the org already has one in progress. */
export class ScrapeAlreadyRunningError extends Error {
  constructor() {
    super('A scrape is already running for this organization.');
    this.name = 'ScrapeAlreadyRunningError';
  }
}

/** The engine has no such scrape run for this org (or it belongs to another). */
export class ScrapeRunNotFoundError extends Error {
  constructor() {
    super('Scrape run not found');
    this.name = 'ScrapeRunNotFoundError';
  }
}
