export class RouteError extends Error {
  details?: string;
  constructor(message: string, details?: string) {
    super(message);
    this.name = 'RouteError';
    this.details = details;
  }
}
