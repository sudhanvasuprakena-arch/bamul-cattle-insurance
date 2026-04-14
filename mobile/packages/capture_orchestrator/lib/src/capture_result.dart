import 'dart:typed_data';
import 'package:equatable/equatable.dart';
import 'photo_type.dart';

/// GPS coordinate embedded at capture time — non-editable by user.
class GpsCoordinate extends Equatable {
  const GpsCoordinate({required this.latitude, required this.longitude, required this.accuracy});

  final double latitude;
  final double longitude;
  final double accuracy; // metres

  @override
  List<Object?> get props => [latitude, longitude, accuracy];
}

/// Result of a single photo capture from [CaptureOrchestrator.captureSequence].
/// All fields are set by the system — none are user-editable.
class CaptureResult extends Equatable {
  const CaptureResult({
    required this.type,
    required this.imageBytes,
    required this.qualityScore,
    required this.gpsCoordinate,
    required this.capturedAt,
    required this.deviceId,
  });

  final PhotoType type;
  final Uint8List imageBytes;
  final double qualityScore; // 0.0–1.0 from on-device TFLite model
  final GpsCoordinate gpsCoordinate;
  final DateTime capturedAt; // system timestamp — non-editable
  final String deviceId;    // IMEI or OS device fingerprint

  @override
  List<Object?> get props => [type, capturedAt, qualityScore, deviceId];
}
