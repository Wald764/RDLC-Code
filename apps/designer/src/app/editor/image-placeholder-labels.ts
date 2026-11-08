/**
 * Placeholder wording lives with the reasons in `@rdlc/report-model/images`, where an
 * exhaustive map makes a new reason fail type checking until it has text.
 */
export {
  imageReasonLabel,
  imageReasonLabels as imagePlaceholderLabels,
  type ImagePlaceholderReason,
} from '@rdlc/report-model/images';

/** Shown while a referenced picture's asset has not arrived or is still decoding. */
export const imagePendingLabel = 'Loading image…';
