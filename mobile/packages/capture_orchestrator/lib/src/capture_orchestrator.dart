import 'capture_config.dart';
import 'capture_result.dart';
import 'photo_type.dart';

/// Camera capture pipeline for BAMUL cattle enrollment and claim filing.
///
/// Exposes a [captureSequence] stream that guides the Field Officer through
/// each required photo in order, applying the on-device TFLite quality gate
/// before emitting each [CaptureResult].
///
/// Full implementation in Epic 2, Story 2.6.
abstract class CaptureOrchestrator {
  /// Starts a guided capture sequence for the given [sequence] of photo types.
  ///
  /// Emits one [CaptureResult] per accepted capture.
  /// Replays the same slot on quality failure until the threshold is met.
  /// GPS is embedded at capture time — [CaptureResult.gpsCoordinate] is always set.
  Stream<CaptureResult> captureSequence({
    required List<PhotoType> sequence,
    required CaptureConfig config,
  });
}
