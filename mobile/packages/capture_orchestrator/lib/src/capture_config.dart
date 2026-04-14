import 'package:equatable/equatable.dart';

/// Configuration for a capture session — quality thresholds and distance range.
class CaptureConfig extends Equatable {
  const CaptureConfig({
    this.minQualityScore = 0.7,
    this.minDistanceCm = 20,
    this.maxDistanceCm = 80,
    this.requireGps = true,
  });

  final double minQualityScore;
  final int minDistanceCm;
  final int maxDistanceCm;
  final bool requireGps;

  @override
  List<Object?> get props => [minQualityScore, minDistanceCm, maxDistanceCm, requireGps];
}
