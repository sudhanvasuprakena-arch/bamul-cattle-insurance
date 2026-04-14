/// Typed error codes for all BAMUL BLoC states.
/// Kannada strings are mapped from these codes via ARB — never hardcoded.
enum BamulError {
  networkTimeout,
  serverUnavailable,
  uidaiOtpFailed,
  uidaiOtpRateLimited,
  duplicateEarTag,
  muzzleQualityFailed,
  muzzleLivenessRejected,
  enrollmentQueued,
  uaidGenerationFailed,
  policyNotFound,
  claimDuplicate,
  claimSubmissionConflict,
  biometricMatchFailed,
  unauthorized,
  forbidden,
  validationError,
  unknown,
}

/// BLoC status — used across all feature BLoCs for consistency.
enum BamulStatus {
  initial,
  loading,
  success,
  failure,
  queued,
}
