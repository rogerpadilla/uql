declare namespace Express {
  export interface Request {
    identity?: {
      readonly company: number;
      readonly user: number;
    };
  }
}
