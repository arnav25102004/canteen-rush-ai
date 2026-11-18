/** Domain error whose message is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Stable machine-readable code the apps can switch on, e.g. ALREADY_REVIEWED. */
    public readonly code?: string,
    /** Extra safe fields merged into the JSON body, e.g. { feedbackId }. */
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
