/**
 * Drift Detection Module
 *
 * Detects schema drift between expected and actual database schemas.
 */

export {
  createDriftDetector,
  DriftDetector,
  type DriftDetectorOptions,
  detectDrift,
} from './driftDetector.js';
