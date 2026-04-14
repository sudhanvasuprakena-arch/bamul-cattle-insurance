/// Standalone Dart package for camera capture pipeline.
/// Public API: [CaptureOrchestrator.captureSequence] returns Stream<CaptureResult>.
/// Internally manages TFLite quality gate, burst capture, and GPS embedding.
/// Implementation completed in Epic 2 (Story 2.6).
library capture_orchestrator;

export 'src/capture_orchestrator.dart';
export 'src/capture_result.dart';
export 'src/capture_config.dart';
export 'src/photo_type.dart';
